/**
 * 知识跟随 - 核心前端逻辑
 * 负责：搜索交互、ADP SSE 流式渲染、推荐列表、公开资源搜索、意图识别展示、三面板拖拽布局
 */

// 文档资源服务器地址：动态从登录配置获取 toolkitUrl，未登录时用默认值
const DEFAULT_TOOLKIT_URL = 'http://21.91.29.59:3000';
let TOOLKIT_BASE_URL = DEFAULT_TOOLKIT_URL;

// 从登录配置同步服务器地址（优先使用 toolkitUrl，而非 authUrl）
async function syncToolkitBaseUrl() {
  try {
    if (window.electronAPI?.authGetState) {
      const state = await window.electronAPI.authGetState();
      if (state.isLoggedIn) {
        // 优先使用 toolkitUrl（专用于文档/案例/Demo 资源的服务器地址）
        TOOLKIT_BASE_URL = state.toolkitUrl || state.authUrl || DEFAULT_TOOLKIT_URL;
        console.log('[KnowledgeFollow] Toolkit URL synced from auth:', TOOLKIT_BASE_URL);
      } else {
        TOOLKIT_BASE_URL = DEFAULT_TOOLKIT_URL;
      }
    }
  } catch (e) {
    console.warn('[KnowledgeFollow] Sync toolkit URL failed, using default:', e.message);
    TOOLKIT_BASE_URL = DEFAULT_TOOLKIT_URL;
  }
}

// 启动时同步一次
syncToolkitBaseUrl();

// 监听登录状态变化，实时同步
if (window.electronAPI?.onAuthChanged) {
  window.electronAPI.onAuthChanged(() => {
    syncToolkitBaseUrl();
  });
}

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
    this._panelOrder = ['adp', 'local', 'public']; // 面板顺序：ADP优先
    this._expandedPanel = null; // 当前展开的面板

    // 提前注册 IPC 事件监听（不依赖 init()，避免切换到知识视图前丢失事件）
    this.setupADPChunkListener();
    this.setupRecommendationListener();
  }

  /**
   * 初始化知识跟随模块
   */
  init() {
    if (this.initialized) return;
    this.bindEvents();
    this.loadRecommendations();
    this.initPanelResizers();
    this.initPanelExpand();
    this.initRecommendationCardEvents();
    this.initLocalCardEvents();
    this.initialized = true;
    console.log('[KnowledgeFollow] Initialized');
  }

  /**
   * 显示知识视图时调用（每次切换都刷新推荐）
   */
  async onShow() {
    await syncToolkitBaseUrl();
    this.loadRecommendations();
  }

  /**
   * 绑定事件
   */
  bindEvents() {
    // 搜索框回车
    const searchInput = document.getElementById('knowledgeSearchInput');
    if (searchInput) {
      searchInput.addEventListener('keydown', (e) => {
        // 中文输入法组合中不触发搜索（按回车确认输入法时 isComposing 为 true）
        if (e.key === 'Enter' && !e.isComposing) this.handleSearch();
      });
    }

    // 搜索按钮
    const searchBtn = document.getElementById('knowledgeSearchBtn');
    if (searchBtn) {
      searchBtn.addEventListener('click', () => this.handleSearch());
    }

    // 刷新推荐
    const refreshBtn = document.getElementById('knowledgeRefreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.loadRecommendations());
    }

    // 设置按钮（已移除，共用全局设置）
  }

  // ============ 面板拖拽调整大小 ============

  initPanelExpand() {
    // 点击面板头部展开/收起
    document.querySelectorAll('.search-panel-header').forEach(header => {
      header.addEventListener('click', (e) => {
        // 不影响按钮点击
        if (e.target.closest('.adp-stream-control') || e.target.closest('.adp-streaming-status')) return;
        const panel = header.closest('.search-panel');
        if (!panel) return;
        const panelName = panel.dataset.panel;
        this.togglePanelExpand(panelName);
      });
    });

    // 点击面板 body 区域也展开
    document.querySelectorAll('.search-panel-body').forEach(body => {
      body.addEventListener('click', (e) => {
        const panel = body.closest('.search-panel');
        if (!panel) return;
        const panelName = panel.dataset.panel;
        if (this._expandedPanel !== panelName) {
          this.togglePanelExpand(panelName);
        }
      });
    });

    // 点击其他区域恢复默认
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-panels') && this._expandedPanel) {
        this.resetPanelExpand();
      }
    });
  }

  togglePanelExpand(panelName) {
    const panels = document.querySelectorAll('.search-panel');
    if (this._expandedPanel === panelName) {
      // 再次点击同一个面板 -> 收起
      this.resetPanelExpand();
      return;
    }
    // 展开当前面板，收起其他
    this._expandedPanel = panelName;
    panels.forEach(p => {
      if (p.dataset.panel === panelName) {
        p.classList.add('expanded');
        p.classList.remove('collapsed');
      } else {
        p.classList.add('collapsed');
        p.classList.remove('expanded');
      }
    });
  }

  resetPanelExpand() {
    this._expandedPanel = null;
    const panels = document.querySelectorAll('.search-panel');
    panels.forEach(p => {
      p.classList.remove('expanded');
      p.classList.remove('collapsed');
    });
  }

  initPanelResizers() {
    const resizers = document.querySelectorAll('.search-panel-resizer');
    resizers.forEach(resizer => {
      let startY, startHeights;

      resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const panels = document.querySelectorAll('.search-panel');
        startY = e.clientY;
        startHeights = Array.from(panels).map(p => p.getBoundingClientRect().height);

        const onMouseMove = (e) => {
          const delta = e.clientY - startY;
          const idx = parseInt(resizer.dataset.resizer);
          const panelsArr = Array.from(panels);

          // 调整相邻两个面板
          const newH1 = Math.max(80, startHeights[idx] + delta);
          const newH2 = Math.max(80, startHeights[idx + 1] - delta);

          panelsArr[idx].style.flex = `0 0 ${newH1}px`;
          panelsArr[idx + 1].style.flex = `0 0 ${newH2}px`;
        };

        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
      });

      // 光标样式
      resizer.addEventListener('mouseenter', () => { resizer.style.cursor = 'row-resize'; });
    });
  }

  // ============ 搜索 ============

  /**
   * 综合搜索：公开API + 本地记忆 + ADP 同时发起
   * ADP 支持语义搜索，用原始 query；本地和公开API 是关键词搜索，先 AI 提炼关键词
   */
  async handleSearch(intent = null) {
    const input = document.getElementById('knowledgeSearchInput');
    const query = input ? input.value.trim() : '';
    if (!query) return;

    // 显示搜索结果区
    const resultsSection = document.getElementById('knowledgeSearchResults');
    if (resultsSection) resultsSection.style.display = 'block';
    this.expandSearchSection();

    // 重置面板为均分
    const panels = document.querySelectorAll('.search-panel');
    panels.forEach(p => { p.style.flex = '1 1 0%'; });

    // ADP 支持语义搜索，直接用原始 query
    this.handleADPSearch(intent);

    // 本地和公开 API 是关键词匹配，先 AI 提炼关键词再搜索
    this.extractKeywordsAndSearch(query);
  }

  /**
   * AI 提炼关键词后进行本地和公开搜索
   */
  async extractKeywordsAndSearch(query) {
    let keywords = query;
    let extracted = false;
    try {
      if (window.electronAPI?.knowledgeExtractKeywords) {
        const result = await window.electronAPI.knowledgeExtractKeywords({ query });
        if (result.keywords && result.keywords.trim()) {
          keywords = result.keywords.trim();
          extracted = true;
        }
      }
    } catch (e) {
      console.warn('[KnowledgeFollow] Keyword extraction failed, using original query:', e);
    }

    // 在本地搜索面板标题显示提炼的关键词
    this.showExtractedKeywords(keywords, extracted);

    // 用提炼的关键词搜索本地和公开 API
    this.handleLocalSearch(keywords);
    this.handlePublicSearch(keywords);
  }

  /**
   * 在搜索面板标题显示提炼的关键词
   */
  showExtractedKeywords(keywords, extracted) {
    // 本地记忆面板
    const localKeywordsEl = document.getElementById('localKeywords');
    if (localKeywordsEl) {
      if (extracted && keywords) {
        localKeywordsEl.textContent = `🔍 ${keywords}`;
        localKeywordsEl.style.display = 'inline';
        localKeywordsEl.title = `AI 提炼关键词: ${keywords}`;
      } else {
        localKeywordsEl.style.display = 'none';
      }
    }
    // 资源文件面板
    const publicKeywordsEl = document.getElementById('publicKeywords');
    if (publicKeywordsEl) {
      if (extracted && keywords) {
        publicKeywordsEl.textContent = `🔍 ${keywords}`;
        publicKeywordsEl.style.display = 'inline';
        publicKeywordsEl.title = `AI 提炼关键词: ${keywords}`;
      } else {
        publicKeywordsEl.style.display = 'none';
      }
    }
  }

  /**
   * 清除搜索结果，恢复推荐区
   */
  clearSearchResults() {
    const resultsSection = document.getElementById('knowledgeSearchResults');
    const recommendSection = document.getElementById('knowledgeRecommendSection');
    if (resultsSection) resultsSection.style.display = 'none';
    if (recommendSection) {
      recommendSection.style.maxHeight = '';
      recommendSection.style.flex = '';
    }
    // 清除关键词显示
    const keywordsEl = document.getElementById('localKeywords');
    if (keywordsEl) keywordsEl.style.display = 'none';
    const publicKeywordsEl = document.getElementById('publicKeywords');
    if (publicKeywordsEl) publicKeywordsEl.style.display = 'none';
  }

  // 推荐区扩大（点击推荐卡片展开时调用）
  expandRecommendSection() {
    const recommendSection = document.getElementById('knowledgeRecommendSection');
    if (recommendSection) {
      // 移除固定 maxHeight，让推荐区随内容自然撑开
      recommendSection.style.maxHeight = 'none';
      recommendSection.style.flex = '1 1 auto';
    }
    // 不再压缩搜索结果区，让 knowledge-content 整体滚动
  }

  // 收起推荐区（点击推荐卡片收起时调用）
  collapseRecommendSection() {
    const recommendSection = document.getElementById('knowledgeRecommendSection');
    if (recommendSection) {
      recommendSection.style.maxHeight = '';
      recommendSection.style.flex = '';
    }
  }

  // 搜索区扩大，推荐区缩小（点击搜索结果时调用）
  expandSearchSection() {
    const resultsSection = document.getElementById('knowledgeSearchResults');
    const recommendSection = document.getElementById('knowledgeRecommendSection');
    if (resultsSection) {
      resultsSection.style.maxHeight = '';
      resultsSection.style.overflow = '';
    }
    if (recommendSection) {
      recommendSection.style.maxHeight = '25%';
      recommendSection.style.flex = '0 0 auto';
    }
  }

  // ============ 公开资源搜索 ============

  async handlePublicSearch(query) {
    const container = document.getElementById('publicSearchResults');
    const countEl = document.getElementById('publicCount');
    if (!container) return;

    container.innerHTML = '<div class="knowledge-empty"><div class="empty-icon">⏳</div><p>搜索资源中...</p></div>';
    if (countEl) countEl.textContent = '...';

    try {
      const [docsRes, casesRes, demosRes, learningRes] = await Promise.allSettled([
        fetch(`${TOOLKIT_BASE_URL}/api/public/documents?keyword=${encodeURIComponent(query)}&page_size=5`).then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }).catch(e => { console.warn('[KnowledgeFollow] Documents API error:', e.message); return null; }),
        fetch(`${TOOLKIT_BASE_URL}/api/public/cases?keyword=${encodeURIComponent(query)}&page_size=5`).then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }).catch(e => { console.warn('[KnowledgeFollow] Cases API error:', e.message); return null; }),
        fetch(`${TOOLKIT_BASE_URL}/api/public/demos?keyword=${encodeURIComponent(query)}&page_size=5`).then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }).catch(e => { console.warn('[KnowledgeFollow] Demos API error:', e.message); return null; }),
        fetch(`${TOOLKIT_BASE_URL}/api/public/learning?keyword=${encodeURIComponent(query)}&page_size=5`).then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }).catch(e => { console.warn('[KnowledgeFollow] Learning API error:', e.message); return null; })
      ]);

      const items = [];

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
      if (countEl) countEl.textContent = items.length;
    } catch (e) {
      console.error('[KnowledgeFollow] Public search error:', e);
      container.innerHTML = '<div class="knowledge-empty"><div class="empty-icon">❌</div><p>资源搜索失败</p><span class="empty-hint">请检查网络连接</span></div>';
      if (countEl) countEl.textContent = '0';
    }
  }

  renderPublicResults(items) {
    const container = document.getElementById('publicSearchResults');
    if (!container) return;

    if (items.length === 0) {
      container.innerHTML = '<div class="knowledge-empty"><div class="empty-icon">📭</div><p>未找到相关资源</p><span class="empty-hint">尝试换个关键词搜索</span></div>';
      return;
    }

    container.innerHTML = '<div class="knowledge-file-list">' + items.map(item => this.renderFileItem(item)).join('') + '</div>';
  }

  renderFileItem(item) {
    const typeConfig = {
      document: { icon: '📄', label: '文档', color: '#007AFF', bg: 'rgba(0,122,255,0.08)' },
      case:     { icon: '💼', label: '案例', color: '#FF9500', bg: 'rgba(255,149,0,0.08)' },
      demo:     { icon: '🎮', label: 'Demo', color: '#34C759', bg: 'rgba(52,199,89,0.08)' },
      learning: { icon: '📖', label: '学习', color: '#AF52DE', bg: 'rgba(175,82,222,0.08)' }
    };
    const cfg = typeConfig[item.type] || typeConfig.document;
    const timeAgo = this.formatTimeAgo(item.updatedAt || item.createdAt);

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

  openPublicResource(id, type) {
    const publicPageUrl = `${TOOLKIT_BASE_URL}/public.html`;
    if (window.electronAPI && window.electronAPI.openExternal) {
      window.electronAPI.openExternal(publicPageUrl);
    } else {
      window.open(publicPageUrl, '_blank');
    }
  }

  downloadPublicResource(id, type) {
    // 查找该条目，判断是否在线文档
    const item = this.publicResults.find(r => r.id === id && r.type === type);
    const isOnline = this._isOnlinePublicResource(item, type);

    if (isOnline && item) {
      let openUrl = '';
      if (type === 'learning' && item.htmlUrl) {
        openUrl = item.htmlUrl.startsWith('http') ? item.htmlUrl : `${TOOLKIT_BASE_URL}${item.htmlUrl}`;
      } else if (item.accessUrl) {
        openUrl = item.accessUrl.startsWith('http') ? item.accessUrl : `${TOOLKIT_BASE_URL}${item.accessUrl}`;
      } else if (type === 'document' && item.fileType) {
        const ext = item.fileType.toLowerCase().replace('.', '');
        if (['html', 'htm', 'md'].includes(ext)) {
          const downloadUrl = `${TOOLKIT_BASE_URL}/api/public/download/${type}/${id}`;
          openUrl = downloadUrl;
        }
      }
      if (openUrl) {
        if (window.electronAPI && window.electronAPI.openExternal) {
          window.electronAPI.openExternal(openUrl);
        } else {
          window.open(openUrl, '_blank');
        }
        return;
      }
    }

    // 非在线文档，走下载
    const url = `${TOOLKIT_BASE_URL}/api/public/download/${type}/${id}`;
    if (window.electronAPI && window.electronAPI.openExternal) {
      window.electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  }

  _isOnlinePublicResource(item, type) {
    if (!item) return false;
    if (type === 'learning' && item.htmlUrl) return true;
    if (type === 'document' && item.fileType) {
      const ext = item.fileType.toLowerCase().replace('.', '');
      if (['html', 'htm', 'md', 'markdown'].includes(ext)) return true;
    }
    if (type === 'demo' && item.accessUrl) return true;
    return false;
  }

  // ============ 本地知识搜索 ============

  async handleLocalSearch(query) {
    const container = document.getElementById('localSearchResults');
    const countEl = document.getElementById('localCount');
    if (!container) return;

    container.innerHTML = '<div class="knowledge-empty"><div class="empty-icon">⏳</div><p>搜索记忆中...</p></div>';
    if (countEl) countEl.textContent = '...';

    try {
      const results = await this.searchEngine.searchLocalKnowledge(query, 10);
      this.searchResults = results;
      this.renderLocalResults(results, query);
      if (countEl) countEl.textContent = results.length;
    } catch (e) {
      console.error('[KnowledgeFollow] Local search error:', e);
      container.innerHTML = '<div class="knowledge-empty"><div class="empty-icon">❌</div><p>搜索失败</p></div>';
      if (countEl) countEl.textContent = '0';
    }
  }

  renderLocalResults(results, query) {
    const container = document.getElementById('localSearchResults');
    if (!container) return;

    if (results.length === 0) {
      container.innerHTML = '<div class="knowledge-empty"><div class="empty-icon">📭</div><p>本地无相关记忆</p></div>';
      return;
    }

    container.innerHTML = '<div class="knowledge-card-list">' + results.map(r => this.renderLocalCard(r)).join('') + '</div>';
  }

  renderLocalCard(item) {
    const sourceClassMap = {
      'memory': 'local-memory',
      'notebook': 'local-notebook',
      'knowledge_atom': 'knowledge-graph',
      'knowledge_cluster': 'knowledge-graph',
      'knowledge_article': 'knowledge-article'
    };
    const sourceClass = sourceClassMap[item.type] || 'local-notebook';
    const sourceLabel = this.searchEngine.getSourceLabel(item.source);
    const scoreText = this.searchEngine.formatScore(item.score);
    const timeAgo = this.formatTimeAgo(item.createdAt);

    return `
      <div class="knowledge-card ${sourceClass}" data-id="${item.id}" data-type="${item.type}" data-content="${this.escapeAttr(item.content)}">
        <div class="knowledge-card-header">
          <span class="knowledge-card-source source-${sourceClass}">
            ${this.searchEngine.getSourceIcon(item.source)} ${sourceLabel}
          </span>
          <span class="relevance-score">匹配 ${scoreText}</span>
        </div>
        <div class="knowledge-card-title">${this.escapeHtml(item.title)}</div>
        <div class="knowledge-card-content">${this.escapeHtml(item.content.substring(0, 150))}${item.content.length > 150 ? '...' : ''}</div>
        <div class="knowledge-card-footer">
          <div class="knowledge-card-meta">
            <span>📅 ${timeAgo}</span>
            <span>📂 ${item.category || '通用'}</span>
            <span class="copy-hint" style="opacity:0;transition:opacity 0.2s;">双击复制</span>
          </div>
          <div class="knowledge-card-actions">
            <button class="knowledge-card-action" onclick="event.stopPropagation(); knowledgeFollow.viewDetail('${item.id}', '${item.type}')">查看</button>
            <button class="knowledge-card-action save-action" onclick="event.stopPropagation(); knowledgeFollow.saveToLocal('${item.id}', '${item.type}')">💾 保存</button>
          </div>
        </div>
      </div>
    `;
  }

  // ============ ADP 搜索 ============

  async handleADPSearch(intent = null) {
    const input = document.getElementById('knowledgeSearchInput');
    const query = input ? input.value.trim() : '';
    if (!query) return;

    const streamContainer = document.getElementById('adpStreamingContent');
    const countEl = document.getElementById('adpCount');
    if (!streamContainer) return;

    // 清空
    this.adpFullText = '';
    this.isADPStreaming = true;
    streamContainer.innerHTML = '<div class="knowledge-empty"><div class="empty-icon">⏳</div><p>ADP 搜索中...</p></div>';
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

    // text.replace 事件：用新文本替换全部
    if (data.replace && data.fullText) {
      this.adpFullText = data.fullText;
      const html = this.renderSimpleMarkdown(this.adpFullText);
      streamContainer.innerHTML = html + '<span class="cursor"></span>';
      const panelBody = streamContainer.closest('.search-panel-body');
      if (panelBody) panelBody.scrollTop = panelBody.scrollHeight;
      return;
    }

    if (data.text) {
      this.adpFullText += data.text;
      const html = this.renderSimpleMarkdown(this.adpFullText);
      streamContainer.innerHTML = html + '<span class="cursor"></span>';

      // 自动滚动到面板底部
      const panelBody = streamContainer.closest('.search-panel-body');
      if (panelBody) {
        panelBody.scrollTop = panelBody.scrollHeight;
      }
    }

    if (data.done) {
      this.isADPStreaming = false;
      const html = this.renderSimpleMarkdown(this.adpFullText);
      streamContainer.innerHTML = html;
      this.showStreamingStatus(false);
      this.updateStreamingControls(false);
      this.showADPDoneActions();

      // 自动保存 ADP 搜索结果到推荐列表
      if (this.adpFullText) {
        this.autoSaveADPToRecommendations();
      }
    }

    if (data.error) {
      this.isADPStreaming = false;
      streamContainer.innerHTML = `<p style="color: var(--danger-color);">错误: ${this.escapeHtml(data.error)}</p>`;
      this.showStreamingStatus(false);
    }
  }

  /**
   * 自动保存 ADP 搜索结果到推荐列表（数据库）
   */
  async autoSaveADPToRecommendations() {
    const input = document.getElementById('knowledgeSearchInput');
    const query = input ? input.value.trim() : 'ADP搜索';

    try {
      await window.electronAPI.knowledgeSaveItem({
        title: query.substring(0, 50),
        content: this.adpFullText,
        source: 'adp_search',
        intent: 'search_knowledge',
        tags: ['ADP', '知识搜索'],
        auto_save: true
      });
      console.log('[KnowledgeFollow] ADP result auto-saved');
    } catch (e) {
      console.error('[KnowledgeFollow] Auto-save ADP result error:', e);
    }
  }

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

  showStreamingStatus(show) {
    const status = document.getElementById('adpStreamingStatus');
    if (status) status.style.display = show ? 'flex' : 'none';
  }

  updateStreamingControls(isStreaming) {
    const controls = document.getElementById('adpStreamingControls');
    if (controls) controls.style.display = isStreaming ? 'flex' : 'none';
  }

  showADPDoneActions() {
    const doneArea = document.getElementById('adpStreamingDone');
    if (doneArea) doneArea.style.display = 'flex';
  }

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

  async copyADPResult() {
    if (!this.adpFullText) return;
    try {
      await navigator.clipboard.writeText(this.adpFullText);
      this.showToast('已复制到剪贴板', 'success');
    } catch (e) {
      this.showToast('复制失败', 'error');
    }
  }

  dismissADPResult() {
    const streamContainer = document.getElementById('adpStreamingContent');
    const doneArea = document.getElementById('adpStreamingDone');
    if (streamContainer) streamContainer.innerHTML = '';
    if (doneArea) doneArea.style.display = 'none';
    this.adpFullText = '';
    this.isADPStreaming = false;
  }

  // ============ 推荐管理 ============

  async loadRecommendations() {
    try {
      const result = await window.electronAPI.knowledgeGetRecommendations({});
      if (result.recommendations) {
        // 按时间倒序（最新在最上面）
        this.recommendations = result.recommendations.sort((a, b) =>
          new Date(b.created_at) - new Date(a.created_at)
        );
        this.renderRecommendations();
      }
    } catch (e) {
      console.error('[KnowledgeFollow] Load recommendations error:', e);
    }
  }

  renderRecommendations() {
    const container = document.getElementById('recommendationList');
    if (!container) return;

    if (this.recommendations.length === 0) {
      container.innerHTML = '<div class="knowledge-empty"><div class="empty-icon">🤖</div><p>暂无智能推荐</p><span class="empty-hint">复制含疑问的内容，系统将自动推荐知识</span></div>';
      return;
    }

    container.innerHTML = this.recommendations.map(r => this.renderRecommendationCard(r)).join('');
  }

  renderRecommendationCard(item) {
    const intentTag = item.intent ? this.getIntentTagHtml(item.intent) : '';
    const timeAgo = this.formatTimeAgo(item.created_at);
    const fullContent = item.content || '';

    return `
      <div class="knowledge-card adp-recommend ${item.is_read ? '' : 'unread'}" data-id="${item.id}" data-content="${this.escapeAttr(fullContent)}">
        <div class="knowledge-card-header">
          <span class="knowledge-card-source source-adp-recommend">🔵 ADP推荐</span>
          ${intentTag}
        </div>
        <div class="knowledge-card-title">${this.escapeHtml(item.title || '知识推荐')}</div>
        <div class="knowledge-card-content">${this.renderSimpleMarkdown(fullContent)}</div>
        <div class="knowledge-card-footer">
          <div class="knowledge-card-meta">
            <span>📅 ${timeAgo}</span>
            <span>来源: ADP</span>
            <span class="copy-hint" style="opacity:0;transition:opacity 0.2s;">双击复制</span>
          </div>
          <div class="knowledge-card-actions">
            <button class="knowledge-card-action save-action" onclick="event.stopPropagation(); knowledgeFollow.saveRecommendation('${item.id}')">💾 保存</button>
            <button class="knowledge-card-action delete-action" onclick="event.stopPropagation(); knowledgeFollow.deleteRecommendation('${item.id}')">🗑️ 删除</button>
          </div>
        </div>
      </div>
    `;
  }

  addRecommendation(recommendation) {
    this.recommendations.unshift(recommendation);
    this.recommendations.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    this.renderRecommendations();
  }

  async saveRecommendation(id) {
    try {
      await window.electronAPI.knowledgeSaveItem({ id });
      this.showToast('已保存', 'success');
      this.loadRecommendations();
    } catch (e) {
      this.showToast('保存失败', 'error');
    }
  }

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

  // ============ 本地详情 ============

  async viewDetail(id, type) {
    const card = document.querySelector(`.knowledge-card[data-id="${id}"][data-type="${type}"]`);
    if (card) {
      const content = card.querySelector('.knowledge-card-content');
      if (content) content.classList.toggle('expanded');
    }
  }

  // ============ 推荐卡片交互 ============

  initRecommendationCardEvents() {
    const container = document.getElementById('recommendationList');
    if (!container) return;

    // 点击卡片展开/收起内容，同时推荐区扩大、搜索区收起
    container.addEventListener('click', (e) => {
      const card = e.target.closest('.knowledge-card');
      if (!card) return;
      if (e.target.closest('.knowledge-card-action')) return;
      const content = card.querySelector('.knowledge-card-content');
      if (content) {
        const isExpanding = !content.classList.contains('expanded');
        content.classList.toggle('expanded');
        if (isExpanding) {
          this.expandRecommendSection();
        } else {
          // 检查是否还有其他展开的卡片
          const otherExpanded = container.querySelectorAll('.knowledge-card-content.expanded');
          if (otherExpanded.length === 0) {
            this.collapseRecommendSection();
          }
        }
      }
    });

    // 双击复制内容
    container.addEventListener('dblclick', (e) => {
      const card = e.target.closest('.knowledge-card');
      if (!card) return;
      const rawContent = card.dataset.content || card.querySelector('.knowledge-card-content')?.textContent || '';
      if (rawContent) {
        navigator.clipboard.writeText(rawContent).then(() => {
          this.showToast('已复制到剪贴板', 'success');
        }).catch(() => {
          this.showToast('复制失败', 'error');
        });
      }
    });

    // hover 显示"双击复制"提示
    container.addEventListener('mouseenter', (e) => {
      const card = e.target.closest('.knowledge-card');
      if (card) {
        const hint = card.querySelector('.copy-hint');
        if (hint) hint.style.opacity = '1';
      }
    }, true);
    container.addEventListener('mouseleave', (e) => {
      const card = e.target.closest('.knowledge-card');
      if (card) {
        const hint = card.querySelector('.copy-hint');
        if (hint) hint.style.opacity = '0';
      }
    }, true);
  }

  initLocalCardEvents() {
    const container = document.getElementById('localSearchResults');
    if (!container) return;

    // 点击卡片展开/收起
    container.addEventListener('click', (e) => {
      const card = e.target.closest('.knowledge-card');
      if (!card) return;
      if (e.target.closest('.knowledge-card-action')) return;
      const content = card.querySelector('.knowledge-card-content');
      if (content) content.classList.toggle('expanded');
    });

    // 双击复制
    container.addEventListener('dblclick', (e) => {
      const card = e.target.closest('.knowledge-card');
      if (!card) return;
      const rawContent = card.dataset.content || card.querySelector('.knowledge-card-content')?.textContent || '';
      if (rawContent) {
        navigator.clipboard.writeText(rawContent).then(() => {
          this.showToast('已复制到剪贴板', 'success');
        }).catch(() => {
          this.showToast('复制失败', 'error');
        });
      }
    });

    // hover 提示
    container.addEventListener('mouseenter', (e) => {
      const card = e.target.closest('.knowledge-card');
      if (card) {
        const hint = card.querySelector('.copy-hint');
        if (hint) hint.style.opacity = '1';
      }
    }, true);
    container.addEventListener('mouseleave', (e) => {
      const card = e.target.closest('.knowledge-card');
      if (card) {
        const hint = card.querySelector('.copy-hint');
        if (hint) hint.style.opacity = '0';
      }
    }, true);
  }

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

  // ============ 设置 ============

  openSettings() {
    const settingsBtn = document.getElementById('openSettingsBtn');
    if (settingsBtn) settingsBtn.click();
    setTimeout(() => {
      const adpTab = document.querySelector('.settings-tab[data-tab="adp"]');
      if (adpTab) adpTab.click();
    }, 200);
  }

  // ============ ADP chunk 监听 ============

  setupADPChunkListener() {
    if (window.electronAPI && window.electronAPI.onKnowledgeADPChunk) {
      window.electronAPI.onKnowledgeADPChunk((data) => {
        this.handleADPChunk(data);
      });
    }
  }

  setupRecommendationListener() {
    if (window.electronAPI && window.electronAPI.onKnowledgeRecommendation) {
      window.electronAPI.onKnowledgeRecommendation((data) => {
        this.addRecommendation(data.recommendation);
      });
    }
  }

  // ============ 工具方法 ============

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

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  escapeAttr(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

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
