/**
 * 知识跟随 - 核心前端逻辑
 * 负责：搜索交互、ADP SSE 流式渲染、推荐列表、意图识别展示
 */

class KnowledgeFollow {
  constructor() {
    this.searchEngine = new KnowledgeSearch();
    this.isADPStreaming = false;
    this.currentADPConversationId = null;
    this.adpFullText = '';
    this.recommendations = [];
    this.searchResults = [];
    this.initialized = false;
  }

  /**
   * 初始化知识跟随模块
   */
  init() {
    if (this.initialized) return;
    this.bindEvents();
    this.loadRecommendations();
    this.setupADPChunkListener();
    this.setupRecommendationListener();
    this.initialized = true;
    console.log('[KnowledgeFollow] Initialized');
  }

  /**
   * 绑定事件
   */
  bindEvents() {
    // 搜索框回车
    const searchInput = document.getElementById('knowledgeSearchInput');
    if (searchInput) {
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.handleSearch();
        }
      });
    }

    // ADP搜索按钮
    const adpSearchBtn = document.getElementById('knowledgeADPSearchBtn');
    if (adpSearchBtn) {
      adpSearchBtn.addEventListener('click', () => this.handleADPSearch());
    }

    // 本地搜索按钮
    const localSearchBtn = document.getElementById('knowledgeLocalSearchBtn');
    if (localSearchBtn) {
      localSearchBtn.addEventListener('click', () => this.handleLocalSearch());
    }

    // 刷新推荐
    const refreshBtn = document.getElementById('knowledgeRefreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.loadRecommendations());
    }

    // 设置按钮
    const settingsBtn = document.getElementById('knowledgeSettingsBtn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => this.openSettings());
    }
  }

  /**
   * 设置 ADP chunk 监听（主进程推送流式内容）
   */
  setupADPChunkListener() {
    if (window.electronAPI && window.electronAPI.onKnowledgeADPChunk) {
      window.electronAPI.onKnowledgeADPChunk((data) => {
        this.handleADPChunk(data);
      });
    }
  }

  /**
   * 设置推荐推送监听
   */
  setupRecommendationListener() {
    if (window.electronAPI && window.electronAPI.onKnowledgeRecommendation) {
      window.electronAPI.onKnowledgeRecommendation((data) => {
        this.addRecommendation(data.recommendation);
      });
    }
  }

  /**
   * 处理综合搜索（本地 + ADP）
   */
  async handleSearch() {
    const input = document.getElementById('knowledgeSearchInput');
    const query = input ? input.value.trim() : '';
    if (!query) return;

    // 并行执行本地搜索和 ADP 搜索
    this.handleLocalSearch();
    this.handleADPSearch();
  }

  /**
   * 本地知识搜索
   */
  async handleLocalSearch() {
    const input = document.getElementById('knowledgeSearchInput');
    const query = input ? input.value.trim() : '';
    if (!query) return;

    const localContainer = document.getElementById('localSearchResults');
    if (!localContainer) return;

    localContainer.innerHTML = '<div class="knowledge-empty"><div class="empty-icon">🔍</div><p>搜索中...</p></div>';

    try {
      const results = await this.searchEngine.searchLocalKnowledge(query, 3);
      this.searchResults = results;
      this.renderLocalResults(results, query);
    } catch (e) {
      console.error('[KnowledgeFollow] Local search error:', e);
      localContainer.innerHTML = '<div class="knowledge-empty"><div class="empty-icon">❌</div><p>搜索失败</p></div>';
    }
  }

  /**
   * 渲染本地搜索结果
   */
  renderLocalResults(results, query) {
    const container = document.getElementById('localSearchResults');
    if (!container) return;

    if (results.length === 0) {
      container.innerHTML = `<div class="knowledge-empty"><div class="empty-icon">📭</div><p>未找到相关知识</p><span class="empty-hint">尝试换个关键词搜索</span></div>`;
      return;
    }

    container.innerHTML = results.map(r => this.renderLocalCard(r)).join('');
  }

  /**
   * 渲染本地知识卡片
   */
  renderLocalCard(item) {
    const sourceClass = item.type === 'memory' ? 'local-memory' : 'local-notebook';
    const sourceLabel = item.type === 'memory' ? '记忆' : '笔记';
    const scoreText = this.searchEngine.formatScore(item.score);
    const timeAgo = this.formatTimeAgo(item.createdAt);

    return `
      <div class="knowledge-card ${sourceClass}" data-id="${item.id}" data-type="${item.type}">
        <div class="knowledge-card-header">
          <span class="knowledge-card-source source-${sourceClass}">
            ${this.searchEngine.getSourceIcon(item.source)} ${sourceLabel}
          </span>
          <span class="relevance-score">匹配 ${scoreText}</span>
        </div>
        <div class="knowledge-card-title">${this.escapeHtml(item.title)}</div>
        <div class="knowledge-card-content">${this.escapeHtml(item.content.substring(0, 200))}${item.content.length > 200 ? '...' : ''}</div>
        <div class="knowledge-card-footer">
          <div class="knowledge-card-meta">
            <span>📅 ${timeAgo}</span>
            <span>📂 ${item.category || '通用'}</span>
          </div>
          <div class="knowledge-card-actions">
            <button class="knowledge-card-action" onclick="knowledgeFollow.viewDetail('${item.id}', '${item.type}')">查看</button>
            <button class="knowledge-card-action save-action" onclick="knowledgeFollow.saveToLocal('${item.id}', '${item.type}')">💾 保存</button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * ADP 搜索（触发 SSE 流式调用）
   */
  async handleADPSearch(intent = null) {
    const input = document.getElementById('knowledgeSearchInput');
    const query = input ? input.value.trim() : '';
    if (!query) return;

    const streamContainer = document.getElementById('adpStreamingContent');
    const streamArea = document.getElementById('adpStreamingArea');
    if (!streamContainer || !streamArea) return;

    // 清空之前的内容
    this.adpFullText = '';
    this.isADPStreaming = true;
    streamContainer.innerHTML = '';
    this.showStreamingStatus(true);
    this.updateStreamingControls(true);

    try {
      const result = await window.electronAPI.knowledgeSearchADP({
        query,
        intent: intent || 'search_knowledge',
        conversationId: this.currentADPConversationId
      });

      if (!result.success) {
        streamContainer.innerHTML = `<div class="knowledge-no-config"><div class="warn-icon">⚠️</div><p>${result.error || 'ADP搜索失败'}</p>${result.error && result.error.includes('AppKey') ? '<button class="config-btn" onclick="knowledgeFollow.openSettings()">配置 AppKey</button>' : ''}</div>`;
        this.isADPStreaming = false;
        this.showStreamingStatus(false);
      } else {
        // 流式输出已开始，chunk 会通过 IPC 推送
        if (result.conversationId) {
          this.currentADPConversationId = result.conversationId;
        }
      }
    } catch (e) {
      console.error('[KnowledgeFollow] ADP search error:', e);
      streamContainer.innerHTML = `<div class="knowledge-empty"><div class="empty-icon">❌</div><p>ADP搜索失败: ${e.message}</p></div>`;
      this.isADPStreaming = false;
      this.showStreamingStatus(false);
    }
  }

  /**
   * 处理 ADP 流式 chunk
   */
  handleADPChunk(data) {
    const streamContainer = document.getElementById('adpStreamingContent');
    if (!streamContainer) return;

    if (data.text) {
      this.adpFullText += data.text;
      // 渲染 Markdown（简单版，只处理基本格式）
      const html = this.renderSimpleMarkdown(this.adpFullText);
      streamContainer.innerHTML = html + '<span class="cursor"></span>';

      // 自动滚动
      const scrollParent = streamContainer.closest('.knowledge-content');
      if (scrollParent) {
        scrollParent.scrollTop = scrollParent.scrollHeight;
      }
    }

    if (data.done) {
      // 流式输出完成
      this.isADPStreaming = false;
      const html = this.renderSimpleMarkdown(this.adpFullText);
      streamContainer.innerHTML = html;
      this.showStreamingStatus(false);
      this.updateStreamingControls(false);
      this.showADPDoneActions();
    }

    if (data.error) {
      this.isADPStreaming = false;
      streamContainer.innerHTML = `<p style="color: var(--danger-color);">错误: ${this.escapeHtml(data.error)}</p>`;
      this.showStreamingStatus(false);
    }
  }

  /**
   * 停止 ADP 流式输出
   */
  async stopADPStreaming() {
    try {
      await window.electronAPI.knowledgeStopADP();
      this.isADPStreaming = false;
      this.showStreamingStatus(false);
      this.updateStreamingControls(false);

      const streamContainer = document.getElementById('adpStreamingContent');
      if (streamContainer) {
        // 移除光标
        const cursor = streamContainer.querySelector('.cursor');
        if (cursor) cursor.remove();
      }
    } catch (e) {
      console.error('[KnowledgeFollow] Stop streaming error:', e);
    }
  }

  /**
   * 显示/隐藏流式状态
   */
  showStreamingStatus(show) {
    const status = document.getElementById('adpStreamingStatus');
    if (status) {
      status.style.display = show ? 'flex' : 'none';
    }
  }

  /**
   * 更新流式控制按钮
   */
  updateStreamingControls(isStreaming) {
    const controls = document.getElementById('adpStreamingControls');
    if (controls) {
      controls.style.display = isStreaming ? 'flex' : 'none';
    }
  }

  /**
   * 显示 ADP 完成后的操作按钮
   */
  showADPDoneActions() {
    const doneArea = document.getElementById('adpStreamingDone');
    if (doneArea) {
      doneArea.style.display = 'flex';
    }
  }

  /**
   * 保存 ADP 回答到知识库
   */
  async saveADPResult() {
    if (!this.adpFullText) return;

    const input = document.getElementById('knowledgeSearchInput');
    const query = input ? input.value.trim() : 'ADP搜索';

    try {
      await window.electronAPI.knowledgeSaveItem({
        title: query.substring(0, 50),
        content: this.adpFullText,
        source: 'adp_search',
        tags: ['ADP', '知识搜索'],
        query: query,
        adpConversationId: this.currentADPConversationId
      });

      this.showToast('已保存到知识库', 'success');
      this.loadRecommendations();
    } catch (e) {
      console.error('[KnowledgeFollow] Save ADP result error:', e);
      this.showToast('保存失败', 'error');
    }
  }

  /**
   * 复制 ADP 回答
   */
  async copyADPResult() {
    if (!this.adpFullText) return;
    try {
      await navigator.clipboard.writeText(this.adpFullText);
      this.showToast('已复制到剪贴板', 'success');
    } catch (e) {
      this.showToast('复制失败', 'error');
    }
  }

  /**
   * 忽略 ADP 回答
   */
  dismissADPResult() {
    const streamContainer = document.getElementById('adpStreamingContent');
    const doneArea = document.getElementById('adpStreamingDone');
    if (streamContainer) streamContainer.innerHTML = '';
    if (doneArea) doneArea.style.display = 'none';
    this.adpFullText = '';
    this.isADPStreaming = false;
  }

  /**
   * 加载智能推荐
   */
  async loadRecommendations() {
    try {
      const result = await window.electronAPI.knowledgeGetRecommendations({});
      if (result.recommendations) {
        this.recommendations = result.recommendations;
        this.renderRecommendations();
      }
    } catch (e) {
      console.error('[KnowledgeFollow] Load recommendations error:', e);
    }
  }

  /**
   * 渲染推荐列表
   */
  renderRecommendations() {
    const container = document.getElementById('recommendationList');
    if (!container) return;

    if (this.recommendations.length === 0) {
      container.innerHTML = `<div class="knowledge-empty"><div class="empty-icon">🤖</div><p>暂无智能推荐</p><span class="empty-hint">复制含疑问的内容，系统将自动推荐知识</span></div>`;
      return;
    }

    container.innerHTML = this.recommendations.map(r => this.renderRecommendationCard(r)).join('');
  }

  /**
   * 渲染推荐卡片
   */
  renderRecommendationCard(item) {
    const intentTag = item.intent ? this.getIntentTagHtml(item.intent) : '';
    const timeAgo = this.formatTimeAgo(item.created_at);

    return `
      <div class="knowledge-card adp-recommend ${item.is_read ? '' : 'unread'}" data-id="${item.id}">
        <div class="knowledge-card-header">
          <span class="knowledge-card-source source-adp-recommend">🔵 ADP推荐</span>
          ${intentTag}
        </div>
        <div class="knowledge-card-title">${this.escapeHtml(item.title || '知识推荐')}</div>
        <div class="knowledge-card-content">${this.escapeHtml((item.content || '').substring(0, 200))}${(item.content || '').length > 200 ? '...' : ''}</div>
        <div class="knowledge-card-footer">
          <div class="knowledge-card-meta">
            <span>📅 ${timeAgo}</span>
            <span>来源: ADP</span>
          </div>
          <div class="knowledge-card-actions">
            <button class="knowledge-card-action save-action" onclick="knowledgeFollow.saveRecommendation('${item.id}')">💾 保存</button>
            <button class="knowledge-card-action delete-action" onclick="knowledgeFollow.deleteRecommendation('${item.id}')">🗑️ 删除</button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 添加新推荐（从剪贴板触发）
   */
  addRecommendation(recommendation) {
    this.recommendations.unshift(recommendation);
    this.renderRecommendations();
  }

  /**
   * 保存推荐到知识库
   */
  async saveRecommendation(id) {
    try {
      await window.electronAPI.knowledgeSaveItem({ id });
      this.showToast('已保存', 'success');
      this.loadRecommendations();
    } catch (e) {
      this.showToast('保存失败', 'error');
    }
  }

  /**
   * 删除推荐
   */
  async deleteRecommendation(id) {
    try {
      await window.electronAPI.knowledgeDeleteItem({ id });
      this.recommendations = this.recommendations.filter(r => r.id !== id);
      this.renderRecommendations();
      this.showToast('已删除', 'success');
    } catch (e) {
      this.showToast('删除失败', 'error');
    }
  }

  /**
   * 查看本地知识详情
   */
  async viewDetail(id, type) {
    // 简单展开/折叠
    const card = document.querySelector(`.knowledge-card[data-id="${id}"][data-type="${type}"]`);
    if (card) {
      const content = card.querySelector('.knowledge-card-content');
      if (content) {
        content.classList.toggle('expanded');
      }
    }
  }

  /**
   * 保存本地知识到知识库
   */
  async saveToLocal(id, type) {
    const item = this.searchResults.find(r => r.id === id && r.type === type);
    if (!item) return;

    try {
      await window.electronAPI.knowledgeSaveItem({
        title: item.title,
        content: item.content,
        source: item.source,
        source_id: id,
        tags: [item.category || '通用']
      });
      this.showToast('已保存到知识库', 'success');
    } catch (e) {
      this.showToast('保存失败', 'error');
    }
  }

  /**
   * 打开设置
   */
  openSettings() {
    const settingsBtn = document.getElementById('openSettingsBtn');
    if (settingsBtn) settingsBtn.click();
    // 切换到 ADP 配置面板
    setTimeout(() => {
      const adpTab = document.querySelector('.settings-tab[data-tab="adp"]');
      if (adpTab) adpTab.click();
    }, 200);
  }

  /**
   * 获取意图标签 HTML
   */
  getIntentTagHtml(intent) {
    const tags = {
      search_knowledge: { icon: '🔍', label: '搜索知识', class: 'search_knowledge' },
      get_document: { icon: '📄', label: '获取文档', class: 'get_document' },
      query_question: { icon: '❓', label: '查询问题', class: 'query_question' },
      doubt: { icon: '🤔', label: '有疑问', class: 'doubt' }
    };
    const tag = tags[intent];
    if (!tag) return '';
    return `<span class="intent-tag ${tag.class}">${tag.icon} ${tag.label}</span>`;
  }

  /**
   * 简单 Markdown 渲染
   */
  renderSimpleMarkdown(text) {
    if (!text) return '';
    let html = this.escapeHtml(text);
    // 标题
    html = html.replace(/^### (.+)$/gm, '<h4 style="font-size:14px;font-weight:600;margin:10px 0 6px;color:var(--text-primary)">$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3 style="font-size:15px;font-weight:600;margin:12px 0 8px;color:var(--text-primary)">$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2 style="font-size:16px;font-weight:700;margin:14px 0 8px;color:var(--text-primary)">$1</h2>');
    // 粗体
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // 列表
    html = html.replace(/^\d+\.\s+(.+)$/gm, '<div style="padding-left:16px;margin:2px 0">$1</div>');
    html = html.replace(/^[-*]\s+(.+)$/gm, '<div style="padding-left:16px;margin:2px 0">• $1</div>');
    // 换行
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  /**
   * 格式化相对时间
   */
  formatTimeAgo(dateStr) {
    if (!dateStr) return '未知';
    const now = new Date();
    const date = new Date(dateStr);
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 30) return `${days}天前`;
    return date.toLocaleDateString('zh-CN');
  }

  /**
   * HTML 转义
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Toast 提示
   */
  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
      padding: 10px 20px; border-radius: 12px; font-size: 13px; font-weight: 500;
      z-index: 9999; animation: slideUp 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
      box-shadow: 0 4px 16px rgba(0,0,0,0.12);
      backdrop-filter: blur(20px) saturate(180%);
    `;

    if (type === 'success') {
      toast.style.background = 'rgba(52, 199, 89, 0.9)';
      toast.style.color = 'white';
    } else if (type === 'error') {
      toast.style.background = 'rgba(255, 59, 48, 0.9)';
      toast.style.color = 'white';
    } else {
      toast.style.background = 'rgba(255, 255, 255, 0.9)';
      toast.style.color = '#1a1a2e';
    }

    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }
}

// 全局实例
const knowledgeFollow = new KnowledgeFollow();
