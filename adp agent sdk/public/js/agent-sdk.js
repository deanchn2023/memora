/**
 * ADP Agent Chat SDK — Frontend v1.0
 * 
 * 基于腾讯云 ADP V2 HTTP SSE 的可配置 AI 助手聊天组件
 * 
 * 使用方式：
 *   ADPAgent.init({
 *     containerId: 'my-agent',
 *     appName: '数据分析师',
 *     apiUrl: '/api/agent/chat',
 *   });
 */

const ADPAgent = (() => {
  // ============ Default Config ============
  let _config = {
    containerId: 'page-agent',
    appName: 'AI 助手',
    appDesc: '腾讯云 ADP 智能体 · 流式对话',
    apiUrl: '/api/agent/chat',
    fileProxyUrl: '/api/agent/file',
    storagePrefix: 'adp_agent',
    maxStoredConvs: 30,
    suggestions: [
      '帮我分析一下数据趋势',
      '生成一份对比报告',
      '列出最近的热门项目'
    ],
    toolIcons: {
      get_feature_rates: '\u{1F4CA}',  // 📊
      get_brand_summary: '\u{1F4CB}',   // 📋
      render_chart: '\u{1F4C8}',        // 📈
      write: '\u{1F4DD}',                // 📝
      FileToURL: '\u{1F517}',           // 🔗
      search: '\u{1F50D}',               // 🔍
      default: '\u{1F527}'              // 🔧
    },
    toolLabels: {
      get_feature_rates: '查询标配率',
      get_brand_summary: '查询概览',
      render_chart: '渲染图表',
      write: '生成报告',
      FileToURL: '获取文件链接',
      search: '搜索数据'
    }
  };

  // ============ Internal State ============
  let conversationId = '';
  let visitorId = '';
  let isStreaming = false;
  let abortController = null;
  let currentAssistantEl = null;
  let currentText = '';
  let thinkingText = '';
  let stepMap = {};
  let fileItems = [];
  let toolStepCount = 0;
  let _timerStart = 0;
  let _timerInterval = null;
  let _renderPending = false;

  // Conversation persistence state
  let conversations = [];
  let currentConvId = '';
  let sidebarOpen = false;

  // Derived keys
  function convStorageKey() { return _config.storagePrefix + '_conversations'; }
  function convDataPrefix() { return _config.storagePrefix + '_conv_'; }

  // ============ Public API ============

  /**
   * 初始化并渲染助手界面
   * @param {object} config - 配置选项（与默认配置合并）
   */
  function init(config) {
    if (config) Object.assign(_config, config);

    const container = document.getElementById(_config.containerId);
    if (!container) throw new Error(`Container #${_config.containerId} not found`);

    loadConversations();
    currentConvId = generateConvId();
    conversationId = generateUUID();
    visitorId = generateUUID();

    // Render UI
    render(container);
    bindEvents();
    updateSendButton();

    // Restore last conversation if available
    if (conversations.length > 0) {
      const lastConv = conversations[0];
      currentConvId = lastConv.id;
      conversationId = lastConv.conversationId;
      visitorId = lastConv.visitorId;
      loadConversation(lastConv.id);
    }

    renderConversationList();

    // Auto-save on visibility change and page unload
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) saveCurrentConversation();
    });
    window.addEventListener('beforeunload', () => {
      saveCurrentConversation();
    });
  }

  /** 暴露给外部调用的方法 */
  return {
    init,
    quickSend(text) {
      const textarea = document.getElementById('agentTextarea');
      textarea.value = text;
      updateSendButton();
      sendMessage();
    },
    startNewConversation,
    clearChat() { startNewConversation(); },
    // Expose config for debugging
    getConfig() { return { ..._config }; },
  };

  // ============ UUID / ID Generators ============

  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function generateConvId() {
    return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // ============ Render UI ============

  function render(container) {
    container.innerHTML = `
    <div class="agent-layout">
      <div class="agent-sidebar-overlay" id="agentSidebarOverlay" onclick="ADPAgent._toggleSidebar()"></div>
      <div class="agent-sidebar" id="agentSidebar">
        <div class="agent-sidebar-header">
          <h3>会话历史</h3>
          <button class="agent-sidebar-new-btn" onclick="ADPAgent.startNewConversation();ADPAgent._toggleSidebar()">+ 新对话</button>
        </div>
        <div class="agent-conv-list" id="agentConvList"></div>
      </div>
      <div class="agent-main">
        <div class="agent-header">
          <button class="agent-sidebar-toggle" id="agentSidebarToggle" title="会话历史">
            <svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
          </button>
          <div class="agent-header-icon">
            <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
          </div>
          <div class="agent-header-info">
            <h2>${escapeHtml(_config.appName)}</h2>
            <p>${escapeHtml(_config.appDesc)}</p>
          </div>
          <div style="flex:1"></div>
          <button class="agent-clear-btn" id="agentClearBtn">新对话</button>
        </div>
        <div class="agent-chat-area" id="agentChatArea">${renderEmptyState()}</div>
        <div class="agent-input-area">
          <div class="agent-status"><span class="agent-status-text" id="agentStatusText"></span></div>
          <div class="agent-input-wrapper">
            <textarea id="agentTextarea" class="agent-textarea" placeholder="输入你的问题..." rows="1"></textarea>
            <button class="agent-send-btn" id="agentSendBtn" disabled>
              <svg class="send-icon" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
              <svg class="stop-icon" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
            </button>
          </div>
        </div>
      </div>
      <div class="agent-preview-panel" id="agentPreviewPanel">
        <div class="agent-preview-header">
          <span class="agent-preview-title" id="agentPreviewTitle">预览</span>
          <button class="agent-preview-action-btn" id="agentPreviewOpenBtn" title="在浏览器中打开">
            <svg viewBox="0 0 24 24" width="14" height="14"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
          </button>
          <button class="agent-preview-action-btn" id="agentPreviewDownloadBtn" title="下载">
            <svg viewBox="0 0 24 24" width="14" height="14"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
          </button>
          <button class="agent-preview-close" id="agentPreviewClose">\u2715</button>
        </div>
        <iframe class="agent-preview-iframe" id="agentPreviewIframe" sandbox="allow-scripts allow-popups allow-forms"></iframe>
      </div>
    </div>`;
  }

  // ============ Event Binding ============

  function bindEvents() {
    const textarea = document.getElementById('agentTextarea');
    const sendBtn = document.getElementById('agentSendBtn');
    const clearBtn = document.getElementById('agentClearBtn');
    const sidebarToggle = document.getElementById('agentSidebarToggle');

    textarea.addEventListener('input', () => {
      autoResize(textarea);
      updateSendButton();
    });
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (isStreaming) stopStreaming();
        else if (textarea.value.trim()) sendMessage();
      }
    });
    sendBtn.addEventListener('click', () => {
      if (isStreaming) stopStreaming();
      else if (textarea.value.trim()) sendMessage();
    });
    clearBtn.addEventListener('click', () => startNewConversation());
    if (sidebarToggle) sidebarToggle.addEventListener('click', () => _toggleSidebar());
  }

  function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  }

  function updateSendButton() {
    const textarea = document.getElementById('agentTextarea');
    const sendBtn = document.getElementById('agentSendBtn');
    if (isStreaming) {
      sendBtn.disabled = false;
      sendBtn.classList.add('is-stop');
    } else {
      sendBtn.disabled = !textarea.value.trim();
      sendBtn.classList.remove('is-stop');
    }
  }

  function stopStreaming() {
    if (abortController) abortController.abort();
  }

  // ============ Sidebar ============

  function _toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    document.getElementById('agentSidebar')?.classList.toggle('open', sidebarOpen);
    document.getElementById('agentSidebarOverlay')?.classList.toggle('open', sidebarOpen);
  }

  // ============ Conversation Persistence ============

  function loadConversations() {
    try {
      const data = localStorage.getItem(convStorageKey());
      conversations = data ? JSON.parse(data) : [];
    } catch (e) { conversations = []; }
  }

  function saveConversations() {
    try {
      if (conversations.length > _config.maxStoredConvs) {
        const removed = conversations.splice(_config.maxStoredConvs);
        removed.forEach(c => localStorage.removeItem(convDataPrefix() + c.id));
      }
      localStorage.setItem(convStorageKey(), JSON.stringify(conversations));
    } catch (e) { /* storage full */ }
  }

  function saveCurrentConversation() {
    const chatArea = document.getElementById('agentChatArea');
    if (!chatArea) return;
    const emptyEl = chatArea.querySelector('.agent-empty');
    if (emptyEl && !chatArea.querySelector('.agent-message')) return;

    let meta = conversations.find(c => c.id === currentConvId);
    const isNew = !meta;
    if (isNew) {
      meta = {
        id: currentConvId,
        conversationId, visitorId,
        title: '', status: isStreaming ? 'streaming' : 'completed',
        messageCount: 0, createdAt: Date.now(), updatedAt: Date.now()
      };
      conversations.unshift(meta);
    }

    meta.conversationId = conversationId;
    meta.visitorId = visitorId;
    meta.status = isStreaming ? 'streaming' : 'completed';
    meta.updatedAt = Date.now();

    const userMsgs = chatArea.querySelectorAll('.agent-message-user');
    const assistantMsgs = chatArea.querySelectorAll('.agent-message-assistant');
    meta.messageCount = userMsgs.length + assistantMsgs.length;

    if (!meta.title && userMsgs.length > 0) {
      const firstBubble = userMsgs[0].querySelector('.agent-bubble-user');
      if (firstBubble) meta.title = firstBubble.textContent.substring(0, 50).trim();
    }

    try {
      localStorage.setItem(convDataPrefix() + currentConvId, JSON.stringify({
        id: currentConvId, chatHtml: chatArea.innerHTML,
        status: meta.status, updatedAt: Date.now(),
      }));
    } catch (e) {}

    saveConversations();
    renderConversationList();
  }

  function loadConversation(convId) {
    try {
      const data = localStorage.getItem(convDataPrefix() + convId);
      if (!data) return false;
      const convData = JSON.parse(data);
      const chatArea = document.getElementById('agentChatArea');
      if (chatArea && convData.chatHtml) chatArea.innerHTML = convData.chatHtml;

      const meta = conversations.find(c => c.id === convId);
      if (meta) {
        conversationId = meta.conversationId;
        visitorId = meta.visitorId;
        currentConvId = meta.id;
        if (meta.status === 'streaming') { meta.status = 'interrupted'; saveConversations(); }
      }
      return true;
    } catch (e) { return false; }
  }

  function deleteConversation(convId) {
    if (convId === currentConvId) return;
    conversations = conversations.filter(c => c.id !== convId);
    localStorage.removeItem(convDataPrefix() + convId);
    saveConversations();
    renderConversationList();
  }

  function switchConversation(convId) {
    if (convId === currentConvId) { _toggleSidebar(); return; }
    if (isStreaming) stopStreaming();
    saveCurrentConversation();
    currentConvId = convId;
    isStreaming = false; currentAssistantEl = null; currentText = '';
    thinkingText = ''; stepMap = {}; fileItems = []; toolStepCount = 0;
    stopTimer();

    if (!loadConversation(convId)) {
      const chatArea = document.getElementById('agentChatArea');
      if (chatArea) chatArea.innerHTML = renderEmptyState();
    }
    updateSendButton(); updateStatus('');
    renderConversationList();
    sidebarOpen = false;
    document.getElementById('agentSidebar')?.classList.remove('open');
    document.getElementById('agentSidebarOverlay')?.classList.remove('open');
    document.getElementById('agentPreviewPanel')?.classList.remove('open');
  }

  function startNewConversation() {
    if (isStreaming) stopStreaming();
    saveCurrentConversation();
    currentConvId = generateConvId();
    conversationId = generateUUID(); visitorId = generateUUID();
    isStreaming = false; currentAssistantEl = null; currentText = '';
    thinkingText = ''; stepMap = {}; fileItems = []; toolStepCount = 0;
    stopTimer();

    const chatArea = document.getElementById('agentChatArea');
    if (chatArea) chatArea.innerHTML = renderEmptyState();
    updateSendButton(); updateStatus('');
    document.getElementById('agentPreviewPanel')?.classList.remove('open');
    renderConversationList();
  }

  function renderConversationList() {
    const listEl = document.getElementById('agentConvList');
    if (!listEl) return;

    if (conversations.length === 0) {
      listEl.innerHTML = '<div class="agent-conv-empty">暂无会话历史</div>';
      return;
    }

    listEl.innerHTML = conversations.map(conv => {
      const isActive = conv.id === currentConvId;
      const statusMap = { streaming: '\u{1F504}', completed: '\u2705', stopped: '\u23F9', error: '\u26A0', interrupted: '\u23F8' };
      const timeStr = formatTime(conv.updatedAt);

      return `<div class="agent-conv-item${isActive ? ' active' : ''}" onclick="ADPAgent.switchConversation('${conv.id}')">
        <div class="agent-conv-status">${statusMap[conv.status] || '\u2705'}</div>
        <div class="agent-conv-info">
          <div class="agent-conv-title">${escapeHtml(conv.title || '新对话')}</div>
          <div class="agent-conv-meta">${timeStr}${conv.messageCount ? ' \u00B7 ' + conv.messageCount + '条' : ''}</div>
        </div>
        ${!isActive ? `<button class="agent-conv-delete" onclick="event.stopPropagation();ADPAgent.deleteConversation('${conv.id}')">\u2715</button>` : ''}
      </div>`;
    }).join('');
  }

  function formatTime(timestamp) {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
    const d = new Date(timestamp);
    return `${d.getMonth()+1}/${d.getDate()}`;
  }

  // ============ Empty State ============

  function renderEmptyState() {
    const suggestionsHtml = _config.suggestions.map(s =>
      `<button class="agent-suggestion" onclick="ADPAgent.quickSend('${escapeHtml(s)}')">${escapeHtml(s)}</button>`
    ).join('');

    return `
      <div class="agent-empty">
        <div class="agent-empty-icon">
          <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
        </div>
        <h3>${escapeHtml(_config.appName)}</h3>
        <p>${escapeHtml(_config.appDesc)}</p>
        <div class="agent-suggestions">${suggestionsHtml}</div>
      </div>`;
  }

  // ============ Messages ============

  function addUserMessage(text) {
    const chatArea = document.getElementById('agentChatArea');
    const emptyState = chatArea.querySelector('.agent-empty');
    if (emptyState) emptyState.remove();
    const msgEl = document.createElement('div');
    msgEl.className = 'agent-message agent-message-user';
    msgEl.innerHTML = `
      <div class="agent-avatar agent-avatar-user">U</div>
      <div class="agent-bubble agent-bubble-user">${escapeHtml(text)}</div>`;
    chatArea.appendChild(msgEl);
    scrollToBottom();
  }

  // ============ Progress Indicator ============

  function addProgressIndicator() {
    removeProgressIndicator();
    const chatArea = document.getElementById('agentChatArea');
    const el = document.createElement('div');
    el.className = 'agent-message agent-message-assistant';
    el.id = 'agentProgressMsg';
    el.innerHTML = `
      <div class="agent-avatar agent-avatar-assistant">AI</div>
      <div class="agent-bubble agent-bubble-assistant">
        <div class="agent-progress" id="agentProgress">
          <div class="agent-progress-header">
            <div class="agent-progress-spinner"></div>
            <span class="agent-progress-title">智能体处理中</span>
            <span class="agent-progress-timer" id="agentProgressTimer">0s</span>
          </div>
          <div class="agent-progress-steps" id="agentProgressSteps"></div>
        </div>
      </div>`;
    chatArea.appendChild(el);
    stepMap = {}; toolStepCount = 0;
    startTimer();
    scrollToBottom();
  }

  function startTimer() {
    _timerStart = Date.now();
    _timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - _timerStart) / 1000);
      const el = document.getElementById('agentProgressTimer');
      if (el) el.textContent = elapsed + 's';
    }, 1000);
  }

  function stopTimer() {
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
  }

  function addProgressStep(messageId, icon, text, status) {
    const stepsEl = document.getElementById('agentProgressSteps');
    if (!stepsEl) return;
    toolStepCount++;
    const progressEl = document.getElementById('agentProgress');
    if (progressEl && progressEl.classList.contains('collapsed')) {
      const titleEl = progressEl.querySelector('.agent-progress-title');
      if (titleEl) titleEl.textContent = `已完成 ${toolStepCount} 个步骤`;
    }
    const stepEl = document.createElement('div');
    stepEl.className = 'agent-progress-step' + (status === 'active' ? ' active' : status === 'done' ? ' done' : '');
    stepEl.dataset.msgId = messageId || '';
    stepEl.innerHTML = `
      <div class="agent-step-row" onclick="ADPAgent._toggleStepDetail(this.parentElement)">
        <span class="agent-step-icon">${icon}</span>
        <span class="agent-step-text">${escapeHtml(text)}</span>
        <span class="agent-step-status">${status === 'active' ? '<span class="agent-step-loading"></span>' : status === 'done' ? '\u2713' : ''}</span>
        <span class="agent-step-expand" style="display:none">&#9654;</span>
      </div>
      <div class="agent-step-detail"></div>`;
    stepsEl.appendChild(stepEl);
    if (messageId) stepMap[messageId] = { el: stepEl, detailEl: stepEl.querySelector('.agent-step-detail') };
    scrollToBottom();
  }

  function _toggleStepDetail(stepEl) {
    const detailEl = stepEl.querySelector('.agent-step-detail');
    const expandEl = stepEl.querySelector('.agent-step-expand');
    if (!detailEl || !detailEl.innerHTML.trim()) return;
    stepEl.classList.toggle('detail-expanded');
    if (expandEl) expandEl.textContent = stepEl.classList.contains('detail-expanded') ? '&#9660;' : '&#9654;';
  }

  function updateProgressStep(messageId, text, status) {
    const info = messageId ? stepMap[messageId] : null;
    const el = info?.el;
    if (el) {
      if (text) el.querySelector('.agent-step-text').textContent = text;
      const statusEl = el.querySelector('.agent-step-status');
      el.className = 'agent-progress-step' + (status === 'active' ? ' active' : status === 'done' ? ' done' : '');
      if (status === 'done') statusEl.innerHTML = '\u2713';
      else if (status === 'active') statusEl.innerHTML = '<span class="agent-step-loading"></span>';
    }
    scrollToBottom();
  }

  function addStepDetail(messageId, content, contentType) {
    const info = messageId ? stepMap[messageId] : null;
    if (!info || !info.detailEl) return;

    const detailEl = info.detailEl;
    const expandEl = info.el.querySelector('.agent-step-expand');
    if (expandEl) expandEl.style.display = 'inline';

    if (contentType === 'json') {
      let formatted = content;
      try {
        const parsed = JSON.parse(content);
        if (parsed.content && Array.isArray(parsed.content) && parsed.content[0]?.text) {
          try { formatted = JSON.parse(parsed.content[0].text); } catch {}
          formatted = typeof formatted === 'string' ? parsed.content[0].text : JSON.stringify(formatted, null, 2);
        } else {
          formatted = JSON.stringify(parsed, null, 2);
        }
      } catch (e) { formatted = content; }
      if (formatted.length > 2000) formatted = formatted.substring(0, 2000) + '\n... (已截断)';
      detailEl.innerHTML = `<div class="agent-step-detail-json"><pre><code>${escapeHtml(formatted)}</code></pre></div>`;
    } else if (contentType === 'file') {
      detailEl.innerHTML = content;
    } else {
      detailEl.innerHTML = `<div class="agent-step-detail-text">${escapeHtml(content).replace(/\n/g, '<br>')}</div>`;
    }

    info.el.classList.add('has-detail');
    if (contentType === 'file') { info.el.classList.add('detail-expanded'); if (expandEl) expandEl.textContent = '&#9660;'; }
    scrollToBottom();
  }

  function removeProgressIndicator() {
    stopTimer();
    const el = document.getElementById('agentProgressMsg');
    if (el) el.remove();
  }

  function collapseProgressIndicator() {
    stopTimer();
    const progressEl = document.getElementById('agentProgress');
    if (!progressEl) return;
    progressEl.classList.add('collapsed');
    const stepsEl = document.getElementById('agentProgressSteps');
    if (stepsEl) stepsEl.style.display = 'none';
    stepsEl?.querySelectorAll('.detail-expanded').forEach(el => {
      el.classList.remove('detail-expanded');
      const exp = el.querySelector('.agent-step-expand');
      if (exp) exp.textContent = '&#9654;';
    });
    const titleEl = progressEl.querySelector('.agent-progress-title');
    const actualStepCount = stepsEl?.querySelectorAll('.agent-progress-step').length ?? toolStepCount;
    if (titleEl) titleEl.textContent = `已完成 ${actualStepCount} 个步骤`;
    progressEl.querySelector('.agent-progress-spinner').style.display = 'none';
    const headerEl = progressEl.querySelector('.agent-progress-header');
    if (headerEl) {
      headerEl.style.cursor = 'pointer';
      headerEl.onclick = () => {
        progressEl.classList.toggle('collapsed');
        const collapsed = progressEl.classList.contains('collapsed');
        if (stepsEl) stepsEl.style.display = collapsed ? 'none' : 'flex';
        const tEl = progressEl.querySelector('.agent-progress-title');
        if (tEl) tEl.textContent = collapsed ? `已完成 ${(stepsEl?.querySelectorAll('.agent-progress-step').length ?? toolStepCount)} 个步骤` : '智能体处理中';
      };
    }
    const timerEl = document.getElementById('agentProgressTimer');
    if (timerEl) timerEl.textContent = `${Math.floor((Date.now() - _timerStart)/1000)}s`;
  }

  // ============ Assistant Message ============

  function startAssistantMessage() {
    const chatArea = document.getElementById('agentChatArea');
    const msgEl = document.createElement('div');
    msgEl.className = 'agent-message agent-message-assistant';
    msgEl.innerHTML = `
      <div class="agent-avatar agent-avatar-assistant">AI</div>
      <div class="agent-bubble agent-bubble-assistant streaming" id="agentCurrentBubble"></div>`;
    chatArea.appendChild(msgEl);
    currentAssistantEl = document.getElementById('agentCurrentBubble');
    currentText = ''; thinkingText = ''; fileItems = [];
    scrollToBottom();
  }

  function appendText(text) { currentText += text; renderBubble(); }
  function replaceText(text) { currentText = text; renderBubble(); }
  function appendThinking(text) { thinkingText += text; renderBubble(); }

  function renderBubble() {
    if (!currentAssistantEl) return;
    if (_renderPending) return;
    _renderPending = true;
    requestAnimationFrame(() => {
      if (currentAssistantEl) currentAssistantEl.innerHTML = renderMarkdown(currentText, thinkingText);
      _renderPending = false;
      scrollToBottom();
    });
  }

  function finishAssistantMessage() {
    collapseProgressIndicator();
    if (currentAssistantEl) {
      currentAssistantEl.classList.remove('streaming');
      currentAssistantEl.removeAttribute('id');
      currentAssistantEl.innerHTML = renderMarkdown(currentText, thinkingText);
      detectAndPreviewFiles();
    }
    stopTimer();
    currentAssistantEl = null;
    saveCurrentConversation();
  }

  function addErrorMessage(text) {
    removeProgressIndicator(); stopTimer();
    const chatArea = document.getElementById('agentChatArea');
    const errEl = document.createElement('div');
    errEl.className = 'agent-error'; errEl.textContent = text;
    chatArea.appendChild(errEl);
    scrollToBottom(); saveCurrentConversation();
  }

  // ============ File Preview ============

  function addFileItem(fileInfo) { fileItems.push(fileInfo); }

  function detectAndPreviewFiles() {
    if (fileItems.length > 0) {
      const htmlFile = fileItems.find(f => f.file_path?.endsWith('.html'));
      if (htmlFile) { openPreviewPanel(htmlFile); return; }
    }
    const fileMatch = currentText.match(/\{"files"\s*:\s*\[[\s\S]*?\]\}/);
    if (fileMatch) {
      try {
        const parsed = JSON.parse(fileMatch[0]);
        const htmlFile = (parsed.files || []).find(f => f.file_path?.endsWith('.html'));
        if (htmlFile) openPreviewPanel(htmlFile);
      } catch (e) {}
    }
  }

  function openPreviewPanel(fileInfo) {
    const panel = document.getElementById('agentPreviewPanel');
    const iframe = document.getElementById('agentPreviewIframe');
    const title = document.getElementById('agentPreviewTitle');
    const close = document.getElementById('agentPreviewClose');
    const openBtn = document.getElementById('agentPreviewOpenBtn');
    const downloadBtn = document.getElementById('agentPreviewDownloadBtn');
    if (!panel || !iframe) return;

    const url = fileInfo.url || '#';
    const fileName = fileInfo.file_path?.split('/').pop() || 'Preview';
    title.textContent = fileName;
    const isAdpUrl = url.startsWith('https://wss.lke.cloud.tencent.com/') || url.startsWith('https://sandbox.adp.cloud.tencent.com/');
    const iframeUrl = isAdpUrl ? `${_config.fileProxyUrl}?url=${encodeURIComponent(url)}` : url;
    iframe.src = iframeUrl;
    panel.classList.add('open');

    if (openBtn) openBtn.onclick = () => window.open(isAdpUrl ? `${_config.fileProxyUrl}?url=${encodeURIComponent(url)}` : url, '_blank', 'noopener,noreferrer');
    if (downloadBtn) downloadBtn.onclick = async () => {
      const dlUrl = isAdpUrl ? `${_config.fileProxyUrl}?url=${encodeURIComponent(url)}` : url;
      try {
        const res = await fetch(dlUrl); const blob = await res.blob();
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = fileName || 'report.html';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      } catch (e) { window.open(url, '_blank', 'noopener,noreferrer'); }
    };
    close.onclick = () => { panel.classList.remove('open'); iframe.src = ''; };
  }

  // ============ SSE Handling ============

  async function sendMessage() {
    const textarea = document.getElementById('agentTextarea');
    const text = textarea.value.trim();
    if (!text || isStreaming) return;

    textarea.value = ''; textarea.style.height = 'auto';
    updateSendButton(); addUserMessage(text);

    isStreaming = true;
    abortController = new AbortController();
    addProgressIndicator();

    try {
      const response = await fetch(_config.apiUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversation_id: conversationId, visitor_id: visitorId }),
        signal: abortController.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '', hasStartedReply = false, currentEvent = '', currentData = '', saveCounter = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].replace(/\r$/, '');
          if (line.startsWith(':')) continue;
          else if (line.startsWith('event:')) currentEvent = line.substring(6).trim();
          else if (line.startsWith('data:')) currentData += line.substring(5).trim();
          else if (line === '') {
            if (currentData) {
              if (currentData === '[DONE]') {
                if (!hasStartedReply) startAssistantMessage();
                finishAssistantMessage(); isStreaming = false; updateSendButton(); return;
              }
              try {
                const data = JSON.parse(currentData);
                const result = handleSSEEvent(currentEvent, data);
                if (result === 'start_reply' && !hasStartedReply) { hasStartedReply = true; startAssistantMessage(); }
              } catch (e) { console.warn('SSE parse error:', e); }
              currentEvent = ''; currentData = '';
            }
          }
        }

        if (++saveCounter % 20 === 0) saveCurrentConversation();
      }

      if (currentData && currentData !== '[DONE]') {
        try {
          const data = JSON.parse(currentData);
          if (handleSSEEvent(currentEvent, data) === 'start_reply' && !hasStartedReply) { hasStartedReply = true; startAssistantMessage(); }
        } catch (e) {}
      }
      if (!hasStartedReply) startAssistantMessage();
      finishAssistantMessage();
    } catch (e) {
      if (e.name === 'AbortError') { finishAssistantMessage(); }
      else { console.error('Chat Error:', e); addErrorMessage(`请求失败: ${e.message}`); }
    } finally {
      isStreaming = false; abortController = null; updateSendButton();
      saveCurrentConversation();
    }
  }

  function handleSSEEvent(event, data) {
    switch (event) {
      case 'request_ack': addProgressStep('', '\u{1F4E4}', '请求已发送', 'done'); break;
      case 'response.created': addProgressStep('', '\u{1F916}', '智能体已接收', 'done'); break;
      case 'response.processing':
        if (data.Response?.StatusDesc) updateStatus(data.Response.StatusDesc);
        break;

      case 'message.added': {
        const msg = data.Message || {};
        const msgId = data.MessageId || msg.MessageId || '';
        if (msg.Type === 'tool_call') {
          const toolName = msg.ExtraInfo?.ToolName || '工具';
          const icon = _config.toolIcons[toolName] || _config.toolIcons.default;
          const label = _config.toolLabels[toolName] || `调用 ${toolName}`;
          addProgressStep(msgId, icon, label, 'active');
        } else if (msg.Type === 'reply' || msg.Name === 'reply') return 'start_reply';
        break;
      }

      case 'message.processing': {
        const msg = data.Message || {};
        if (msg.Type === 'tool_call' && msg.Contents?.[0]?.Text?.trim())
          addStepDetail(data.MessageId || msg.MessageId || '', msg.Contents[0].Text, 'text');
        break;
      }

      case 'message.done': {
        const msg = data.Message || {};
        const msgId = data.MessageId || msg.MessageId || '';
        if (msg.Type === 'tool_call') {
          const toolName = msg.ExtraInfo?.ToolName || '工具';
          const doneLabel = (_config.toolLabels[toolName] || `${toolName}`) + ' 完成';
          updateProgressStep(msgId, doneLabel, 'done');
          if (msg.Contents?.[0]?.Text) {
            const resultText = msg.Contents[0].Text;
            if (toolName === 'FileToURL') {
              try {
                const result = JSON.parse(resultText);
                if (result.files) {
                  result.files.forEach(f => addFileItem(f));
                  const cards = result.files.map(f => {
                    const fn = f.file_path?.split('/').pop() || '文件';
                    const ext = fn.split('.').pop()?.toLowerCase();
                    const iconMap = { html:'\u{1F310}', pdf:'\u{1F4D6}', xlsx:'\u{1F4CA}', csv:'\u{1F4CB}',
                      png:'\u{1F5BC}', jpg:'\u{1F5BC}' };
                    const ic = iconMap[ext] || '\u{1F4C4}';
                    return `<div class="agent-file-card" onclick="ADPAgent.openPreview({url:'${escapeHtml(f.url||'#')}',file_path:'${escapeHtml(fn)})'})">
                      <span class="agent-file-icon">${ic}</span><span class="agent-file-name">${escapeHtml(fn)}</span><span class="agent-file-open">\u2197 打开</span></div>`;
                  }).join('');
                  addStepDetail(msgId, cards, 'file');
                }
              } catch (e) { addStepDetail(msgId, resultText, 'json'); }
            } else addStepDetail(msgId, resultText, 'json');
          }
        }
        break;
      }

      case 'content.added': return 'start_reply';
      case 'text.delta': if (data.Text) appendText(data.Text); break;
      case 'text.replace': if (data.Text) replaceText(data.Text); break;
      case 'response.completed':
        if (data.Response?.StatInfo) {
          const stat = data.Response.StatInfo;
          updateStatus(`完成 · ${stat.TotalTokens||0} tokens${stat.ModelName?'\u00B7 '+stat.ModelName:''}`);
        }
        break;
      case 'error': addErrorMessage(`[${data.Error?.Code||''}] ${data.Error?.Message||'未知错误'}`); break;
      case 'thought': if (data.Text||data.Content) appendThinking(data.Text||data.Content); break;
    }
    return null;
  }

  function updateStatus(text) {
    const el = document.getElementById('agentStatusText');
    if (el) el.textContent = text || '';
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      const el = document.getElementById('agentChatArea');
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============ Markdown Rendering ============

  function renderMarkdown(text, thinkingText) {
    if (!text && !thinkingText) return '';
    text = (text || '').replace(/\\u0026/g, '&');

    const LT = String.fromCharCode(60), GT = String.fromCharCode(62);
    const THINK_OPEN = LT+'think'+GT, THINK_CLOSE = LT+'/think'+GT;
    text = text.replace(new RegExp(THINK_OPEN.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([\\s\\S]*?)'+THINK_CLOSE.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'), (_,c) => { thinkingText=(thinkingText||')+c; return ''; });

    const mdLinks = [];
    text = text.replace(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, (match, linkText, url) => {
      const idx = mdLinks.length;
      let decodedUrl = url; try { decodedUrl=decodeURIComponent(url);}catch(e){}
      let fileName=linkText; const pathMatch=decodedUrl.match(/[?&]path=([^&]+)/);
      if(pathMatch&&linkText.length>20)try{fileName=decodeURIComponent(pathMatch[1]).split('/').pop();}catch(e){}
      mdLinks.push({url:decodedUrl,display:linkText,fileName,isHtml:decodedUrl.includes('.html')});
      return `__MDLINK_${idx}__`;
    });

    const fileCards=[];
    text=text.replace(/\{"files"\s*:\s*\[[\s\S]*?\]\}/g,(match)=>{const idx=fileCards.length;try{fileCards.push(JSON.parse(match).files||[]);}catch(e){fileCards.push(null);}return `\n__FILE_CARD_${idx}__\n`;});
    text=text.replace(/\{"content"\s*:\s*\[\s*\{\s*"type"\s*:\s*"text"\s*,\s*"text"\s*:\s*"[^"]*"\s*\}\s*\]\s*\}/g,'');
    text=text.replace(/\{"content"\s*:\s*\[[\s\S]*?\]\s*\}(?=\s*[^\s{]|$)/g,(match)=>{try{const p=JSON.parse(match);if(p.content&&Array.isArray(p.content))return'';}catch(e){}return match;});

    const links=[];
    text=text.replace(/https?:\/\/[^\s"'<>\]}|\\^`]+/g,(url)=>{
      const idx=links.length;let du=url;try{du=decodeURIComponent(url);}catch(e){}
      let display=url;const pm=du.match(/[?&]path=([^&]+)/);
      if(pm)try{display=decodeURIComponent(pm[1]).split('/').pop();}catch(e){}else if(url.length>60)display=url.substring(0,40)+'\u2026'+url.substring(url.length-15);
      links.push({url:du,display});return `__LINK_${idx}__`;
    });

    let html=escapeHtml(text);

    mdLinks.forEach((link,idx)=>{
      const ph=`__MDLINK_${idx}__`, su=escapeHtml(link.url), sd=escapeHtml(link.display);
      html=html.replace(ph, link.isHtml
        ?`<div class="agent-file-card" onclick="ADPAgent.openPreview({url:'${su}',file_path:'${escapeHtml(link.fileName)})'})"><span class="agent-file-icon">\u{1F310}</span><span class="agent-file-name">${sd}</span><span class="agent-file-open">\u2197 打开</span></div>`
        :`<a href="${su}" target="_blank" rel="noopener noreferrer" class="agent-link">${sd}</a>`);
    });

    fileCards.forEach((files,idx)=>{
      const ph=`__FILE_CARD_${idx}__`;
      if(files&&files.length>0){
        html=html.replace(ph, files.map(f=>{
          const fn=f.file_path?.split('/').pop()||'文件'; const ext=fn.split('.').pop()?.toLowerCase();
          const im={html:'\u{1F310}',pdf:'\u{1F4D6}',xlsx:'\u{1F4CA}',csv:'\u{1F4CB}',png:'\u{1F5BC}',jpg:'\u{1F5BC}'};
          return `<div class="agent-file-card" onclick="ADPAgent.openPreview({url:'${escapeHtml(f.url||'#')}',file_path:'${escapeHtml(fn)})'})"><span class="agent-file-icon">${im[ext]||'\u{1F4C4}'}</span><span class="agent-file-name">${escapeHtml(fn)}</span><span class="agent-file-open">\u2197 打开</span></div>`}).join(''));
      }else html=html.replace(ph,'');
    });

    links.forEach((link,idx)=>{
      const ph=`__LINK_${idx}__`; html=html.replace(ph,`<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" class="agent-link">${escapeHtml(link.display)}</a>`);
    });

    html=html.replace(/```(\w*)\n?([\s\S]*?)```/g,(_,lang,code)=>`<pre><code>${code.trim()}</code></pre>`);
    html=html.replace(/`([^`]+)`/g,'<code>$1</code>');
    html=html.replace(/(\|.+\|[\r\n]+\|[\s\-:|]+\|[\r\n]+((?:\|.+\|[\r\n]*)+))/g,(match)=>{
      const rows=match.trim().split(/[\r\n]+/).filter(r=>r.trim());
      if(rows.length<2)return match;
      let t='<table class="agent-table"><thead><tr>'+rows[0].split('|').filter(c=>c.trim()).map(h=>`<th>${h.trim()}</th>`).join('')+'</tr></thead><tbody>';
      for(let i=2;i<rows.length;i++){const cells=rows[i].split('|').filter(c=>c.trim());t+='<tr>'+cells.map(c=>`<td>${c.trim()}</td>`).join('')+'</tr>';}
      return t+'</tbody></table>';});
    html=html.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
    html=html.replace(/\*(.+?)\*/g,'<em>$1</em>');
    html=html.replace(/\n\n/g,'</p><p>');
    html=html.replace(/\n/g,'<br>');
    html='<p>'+html+'</p>';
    html=html.replace(/<p><\/p>/g,'');
    html=html.replace(/<p><br><\/p>/g,'');

    if(thinkingText&&thinkingText.trim()) html=renderThinking(thinkingText)+html;
    return html;
  }

  function renderThinking(text){
    const trimmed=text.trim(), preview=trimmed.length>80?trimmed.substring(0,80)+'\u2026':trimmed;
    return `<div class="agent-thinking-section"><div class="agent-thinking-header" onclick="this.parentElement.classList.toggle('expanded')">
      <span class="agent-thinking-icon">\uD83D\uDCAD</span><span class="agent-thinking-label">思考过程</span>
      <span class="agent-thinking-preview">${escapeHtml(preview)}</span><span class="agent-thinking-toggle">&#9654;</span></div>
      <div class="agent-thinking-content">${escapeHtml(trimmed).replace(/\n/g,'<br>')}</div></div>`;
  }

  // Expose for internal use from HTML onclick handlers
  ADPAgent.switchConversation = switchConversation;
  ADPAgent.deleteConversation = deleteConversation;
  ADPAgent.startNewConversation = startNewConversation;
  ADPAgent._toggleSidebar = _toggleSidebar;
  ADPAgent._toggleStepDetail = _toggleStepDetail;
  ADPAgent.openPreview = openPreviewPanel;
})();
