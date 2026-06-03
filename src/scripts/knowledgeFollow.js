/**
 * 知识跟随 - 核心前端逻辑
 * 负责：搜索交互、ADP SSE 流式渲染、推荐列表、公开资源搜索、意图识别展示
 */

const TOOLKIT_BASE_URL = 'http://21.91.29.59:3000';

class KnowledgeFollow {
  constructor() {
    this.searchEngine = new KnowledgeSearch();
    this.isADPStreaming = false;
    this.currentADPConversationId = null;
    this.adpFullText = '';
    this.recommendations = [];
    this.searchResults = [];
    this.publicResults = [];
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

    // 搜索按钮（合并：同时搜索公开API + 本地 + ADP）
    const searchBtn = document.getElementById('knowledgeSearchBtn');
    if (searchBtn) {
      searchBtn.addEventListener('click', () => this.handleSearch());
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
   * 设置 ADP chunk 监听
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
   * 综合搜索：公开API + 本地记忆 + ADP 同时发起
   */
  async handleSearch(intent = null) {
    const input = document.getElementById('knowledgeSearchInput');
    const query = input ? input.value.trim() : '';
    if (!query) return;

    // 显示搜索结果区
    const resultsSection = document.getElementById('knowledgeSearchResults');
    if (resultsSection) resultsSection.style.display = 'block';

    // 并行搜索三个来源
    this.handlePublicSearch(query);
    this.handleLocalSearch(query);
    this.handleADPSearch(intent);
  }

  /**
   * 公开资源搜索（ADPToolkit API）
   */
  async handlePublicSearch(query) {
    const container = document.getElementById('publicSearchResults');
    if (!container) return;

    container.innerHTML = '<div class="knowledge-empty"><div class="empty-icon">⏳</div><p>搜索资源中...</p></div>';

    try {
      // 并行搜索4种资源类型
      const [docsRes, casesRes, demosRes, learningRes] = await Promise.allSettled([
        fetch(`${TOOLKIT_BASE_URL}/api/public/documents?keyword=${encodeURIComponent(query)}&page_size=5`).then(r => r.json()),
        fetch(`${TOOLKIT_BASE_URL}/api/public/cases?keyword=${encodeURIComponent(query)}&page_size=5`).then(r => r.json()),
        fetch(`${TOOLKIT_BASE_URL}/api/public/demos?keyword=${encodeURIComponent(query)}&page_size=5`).then(r => r.json()),
        fetch(`${TOOLKIT_BASE_URL}/api/public/learning?keyword=${encodeURIComponent(query)}&page_size=5`).then(r => r.json())
      ]);

      const items = [];

      // 处理文档
      if (docsRes.status === 'fulfilled' && docsRes.value?.data) {
        docsRes.value.data.forEach(d => items.push({
          id: d.id, type: 'document', title: d.title,
          description: d.description, category: d.category,
          industry: d.industry, author: d.author_name,
          fileName: d.file_name, fileType: d.file_type,
          views: d.view_count, downloads: d.download_count,
          createdAt: d.created_at, updatedAt: d.updated_at
        }));
      }

      // 处理案例
      if (casesRes.status === 'fulfilled' && casesRes.value?.data) {
        casesRes.value.data.forEach(c => items.push({
          id: c.id, type: 'case', title: c.title,
          description: c.description, category: c.industry,
          industry: c.industry, author: c.client_name,
          fileName: null, fileType: null,
          views: c.view_count, downloads: c.download_count,
          demoUrl: c.demo_url, createdAt: c.created_at, updatedAt: c.updated_at
        }));
      }

      // 处理 Demo
      if (demosRes.status === 'fulfilled' && demosRes.value?.data) {
        demosRes.value.data.forEach(d => items.push({
          id: d.id, type: 'demo', title: d.name,
          description: d.description, category: d.category,
          industry: d.industry, author: null,
          fileName: null, fileType: null,
          views: d.click_count, downloads: d.download_count,
          accessUrl: d.access_url, createdAt: d.created_at, updatedAt: d.updated_at
        }));
      }

      // 处理学习材料
      if (learningRes.status === 'fulfilled' && learningRes.value?.data) {
        learningRes.value.data.forEach(l => items.push({
          id: l.id, type: 'learning', title: l.title,
          description: l.description, category: l.category,
          industry: null, author: l.author_name,
          tags: l.tags, fileName: null, fileType: null,
          views: l.view_count, downloads: l.download_count,
          htmlUrl: l.html_url, createdAt: l.created_at, updatedAt: l.updated_at
        }));
      }

      this.publicResults = items;
      this.renderPublicResults(items);
    } catch (e) {
      console.error('[KnowledgeFollow] Public search error:', e);
      container.innerHTML = '<div class="knowledge-empty"><div class="empty-icon">❌</div><p>资源搜索失败</p><span class="empty-hint">请检查网络连接</span></div>';
    }
  }

  /**
   * 渲染公开资源文件列表
   */
  renderPublicResults(items) {
    const container = document.getElementById('publicSearchResults');
    if (!container) return;

    if (items.length === 0) {
      container.innerHTML = '<div class="knowledge-empty"><div class="empty-icon">📭</div><p>未找到相关资源</p><span class="empty-hint">尝试换个关键词搜索</span></div>';
      return;
    }

    container.innerHTML = items.map(item => this.renderFileItem(item)).join('');
  }

  /**
   * 渲染单个文件列表项
   */
  renderFileItem(item) {
    const typeConfig = {
      document: { icon: '📄', label: '文档', color: '#007AFF', bg: 'rgba(0,122,255,0.08)' },
      case:     { icon: '💼', label: '案例', color: '#FF9500', bg: 'rgba(255,149,0,0.08)' },
      demo:     { icon: '🎮', label: 'Demo', color: '#34C759', bg: 'rgba(52,199,89,0.08)' },
      learning: { icon: '📖', label: '学习', color: '#AF52DE', bg: 'rgba(175,82,222,0.08)' }
    };
    const cfg = typeConfig[item.type] || typeConfig.document;
    const timeAgo = this.formatTimeAgo(item.updatedAt || item.createdAt);

    // 文件类型图标
    const ext = (item.fileType || '').toLowerCase();
    let fileIcon = '📄';
    if (ext === '.pdf') fileIcon = '📕';
    else if (['.doc', '.docx'].includes(ext)) fileIcon = '📘';
    else if (['.ppt', '.pptx'].includes(ext)) fileIcon = '📙';
    else if (['.xls', '.xlsx'].includes(ext)) fileIcon = '📗';
    else if (['.html', '.htm'].includes(ext)) fileIcon = '🌐';
    else if (item.type === 'demo') fileIcon = '🎮';
    else if (item.type === 'learning') fileIcon = '📖';

    const fileName = item.fileName || `${item.title}`;
    const views = item.views || 0;
    const downloads = item.downloads || 0;

    return `
      <div class="knowledge-file-item" data-id="${item.id}" data-type="${item.type}" onclick="knowledgeFollow.openPublicResource('${item.id}', '${item.type}')">
        <div class="file-icon" style="background: ${cfg.bg}; color: ${cfg.color};">${fileIcon}</div>
        <div class="file-info">
          <div class="file-name">${this.escapeHtml(fileName || item.title)}</div>
          <div class="file-desc">${this.escapeHtml((item.description || '').substring(0, 100))}${(item.description || '').length > 100 ? '...' : ''}</div>
          <div class="file-meta">
            <span class="file-type-badge" style="background: ${cfg.bg}; color: ${cfg.color};">${cfg.icon} ${cfg.label}</span>
            ${item.category ? `<span class="file-category">${this.escapeHtml(item.category)}</span>` : ''}
            ${item.author ? `<span class="file-author">👤 ${this.escapeHtml(item.author)}</span>` : ''}
            <span class="file-stat">👁 ${views}</span>
            <span class="file-stat">⬇️ ${downloads}</span>
            <span class="file-time">${timeAgo}</span>
          </div>
        </div>
        <div class="file-action">
          <button class="file-download-btn" onclick="event.stopPropagation(); knowledgeFollow.downloadPublicResource('${item.id}', '${item.type}')" title="下载">⬇️</button>
        </div>
      </div>
    `;
  }

  /**
   * 打开公开资源详情
   */
  openPublicResource(id, type) {
    const urlMap = {
      document: `${TOOLKIT_BASE_URL}/api/public/documents/${id}`,
      case: `${TOOLKIT_BASE_URL}/api/public/cases/${id}`,
      demo: `${TOOLKIT_BASE_URL}/api/public/demos/${id}`,
      learning: `${TOOLKIT_BASE_URL}/api/public/learning/${id}`
    };

    // 在默认浏览器中打开公开页面
    const publicPageUrl = `${TOOLKIT_BASE_URL}/public.html`;
    // 使用 shell.openExternal
    if (window.electronAPI && window.electronAPI.openExternal) {
      window.electronAPI.openExternal(publicPageUrl);
    } else {
      window.open(publicPageUrl, '_blank');
    }
  }

  /**
   * 下载公开资源
   */
  downloadPublicResource(id, type) {
    const url = `${TOOLKIT_BASE_URL}/api/public/download/${type}/${id}`;
    if (window.electronAPI && window.electronAPI.openExternal) {
      window.electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  }

  /**
   * 清除搜索结果
   */
  clearSearchResults() {
    const resultsSection = document.getElementById('knowledgeSearchResults');
    if (resultsSection) resultsSection.style.display = 'none';
  }

  /**
   * 本地知识搜索
   */
  async handleLocalSearch(query) {
    const localContainer = document.getElementById('localSearchResults');
    if (!localContainer) return;

    localContainer.innerHTML = '<div class="knowledge-empty"><div class="empty-icon">⏳</div><p>搜索记忆中...</p></div>';

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
      container.innerHTML = '<div class="knowledge-empty"><div class="empty-icon">📭</div><p>本地无相关记忆</p></div>';
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
      const html = this.renderSimpleMarkdown(this.adpFullText);
      streamContainer.innerHTML = html + '<span class="cursor"></span>';

      const scrollParent = streamContainer.closest('.knowledge-content');
      if (scrollParent) {
        scrollParent.scrollTop = scrollParent.scrollHeight;
      }
    }

    if (data.done) {
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
      container.innerHTML = '<div class="knowledge-empty"><div class="empty-icon">🤖</div><p>暂无智能推荐</p><span class="empty-hint">复制含疑问的内容，系统将自动推荐知识</span></div>';
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
   * 添加新推荐
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
    html = html.replace(/^### (.+)$/gm, '<h4 style="font-size:14px;font-weight:600;margin:10px 0 6px;color:var(--text-primary)">$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3 style="font-size:15px;font-weight:600;margin:12px 0 8px;color:var(--text-primary)">$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2 style="font-size:16px;font-weight:700;margin:14px 0 8px;color:var(--text-primary)">$1</h2>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^\d+\.\s+(.+)$/gm, '<div style="padding-left:16px;margin:2px 0">$1</div>');
    html = html.replace(/^[-*]\s+(.+)$/gm, '<div style="padding-left:16px;margin:2px 0">• $1</div>');
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
window.knowledgeFollow = knowledgeFollow;
