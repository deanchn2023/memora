/**
 * 知识文档模块 - 对接 ADP Toolkit 公开资源 API
 * BASE_URL 动态获取：优先使用登录环境的 toolkitUrl，未登录则使用默认地址
 */

const Documents = {
  BASE_URL: 'http://121.5.164.126:3010', // 默认使用外网可访问的 Beta 地址
  currentType: 'cloud', // cloud | local | artifacts
  cloudSubType: 'documents', // documents | cases | demos | learning
  currentSort: 'latest', // latest | hot
  currentPage: 1,
  pageSize: 20,
  total: 0,
  keyword: '',
  data: [],
  allData: [], // 累积加载的所有数据
  initialized: false,
  isLoading: false,
  hasMore: true,

  init() {
    if (this.initialized) return;
    this.initialized = true;

    // 顶级分类标签切换：云端资料 | 本地 | Agent 产物
    document.querySelectorAll('.doc-cat-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.doc-cat-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        this.currentType = e.target.dataset.type;
        this.currentPage = 1;
        this.allData = [];
        this.hasMore = true;
        this.keyword = document.getElementById('documentsSearchInput')?.value || '';

        const localContainer = document.getElementById('localFilesContainer');
        const artifactsContainer = document.getElementById('agentArtifactsContainer');
        const normalElements = document.querySelectorAll('#documentsGrid, #documentsPagination, #documentsLoading');
        const cloudSubTabs = document.getElementById('cloudSubTabs');

        if (this.currentType === 'local') {
          normalElements.forEach(el => el.classList.add('hidden'));
          if (localContainer) localContainer.classList.remove('hidden');
          if (artifactsContainer) artifactsContainer.classList.add('hidden');
          if (cloudSubTabs) cloudSubTabs.classList.add('hidden');
          if (window.LocalFiles) LocalFiles.onShow();
        } else if (this.currentType === 'artifacts') {
          normalElements.forEach(el => el.classList.add('hidden'));
          if (localContainer) localContainer.classList.add('hidden');
          if (artifactsContainer) artifactsContainer.classList.remove('hidden');
          if (cloudSubTabs) cloudSubTabs.classList.add('hidden');
          AgentArtifacts.onShow();
        } else {
          // cloud
          normalElements.forEach(el => el.classList.remove('hidden'));
          if (localContainer) localContainer.classList.add('hidden');
          if (artifactsContainer) artifactsContainer.classList.add('hidden');
          if (cloudSubTabs) cloudSubTabs.classList.remove('hidden');
          this.fetchData(true);
        }
      });
    });

    // 云端资料子分类切换：文档 | 案例 | Demo | 学习材料
    document.querySelectorAll('.cloud-sub-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.cloud-sub-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        this.cloudSubType = e.target.dataset.type;
        this.currentPage = 1;
        this.allData = [];
        this.hasMore = true;
        this.fetchData(true);
      });
    });

    // 排序标签切换
    document.querySelectorAll('.doc-sort-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.doc-sort-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        this.currentSort = e.target.dataset.sort;
        this.currentPage = 1;
        this.allData = [];
        this.hasMore = true;
        this.fetchData(true);
      });
    });

    // 搜索（统一搜索：同时搜索在线文档和本地文件）
    document.getElementById('documentsSearchBtn')?.addEventListener('click', () => {
      this.keyword = document.getElementById('documentsSearchInput')?.value || '';
      this.currentPage = 1;
      this.allData = [];
      this.hasMore = true;
      // 如果当前不是本地/Agent产物，搜索在线文档
      if (this.currentType !== 'local' && this.currentType !== 'artifacts') {
        this.fetchData(true);
      }
      // 始终同步搜索本地文件
      if (window.LocalFiles) {
        LocalFiles.searchFromExternal(this.keyword);
      }
    });

    document.getElementById('documentsSearchInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.keyword = e.target.value || '';
        this.currentPage = 1;
        this.allData = [];
        this.hasMore = true;
        if (this.currentType !== 'local' && this.currentType !== 'artifacts') {
          this.fetchData(true);
        }
        // 始终同步搜索本地文件
        if (window.LocalFiles) {
          LocalFiles.searchFromExternal(this.keyword);
        }
      }
    });

    // 下拉加载更多：监听滚动
    const body = document.getElementById('documentsBody');
    if (body) {
      body.addEventListener('scroll', () => {
        if (this.isLoading || !this.hasMore) return;
        const { scrollTop, scrollHeight, clientHeight } = body;
        // 距离底部 100px 时触发加载
        if (scrollHeight - scrollTop - clientHeight < 100) {
          this.loadMore();
        }
      });
    }
  },

  onShow() {
    this.init();
    // 动态更新 BASE_URL：优先使用登录环境的 toolkitUrl
    this._updateBaseUrl();
    // 首次加载数据
    if (this.allData.length === 0) {
      this.fetchData(true);
    }
  },

  async _updateBaseUrl() {
    try {
      if (window.electronAPI?.authGetState) {
        const state = await window.electronAPI.authGetState();
        if (state.toolkitUrl) {
          this.BASE_URL = state.toolkitUrl;
          console.log('[Documents] Using toolkitUrl from auth:', this.BASE_URL);
        }
      }
    } catch (err) {
      console.log('[Documents] Using default BASE_URL:', this.BASE_URL);
    }
  },

  loadMore() {
    if (!this.hasMore || this.isLoading) return;
    this.currentPage++;
    this.fetchData(false);
  },

  async fetchData(resetGrid = false) {
    if (this.isLoading) return;
    this.isLoading = true;

    const loading = document.getElementById('documentsLoading');
    const grid = document.getElementById('documentsGrid');
    const pagination = document.getElementById('documentsPagination');

    if (resetGrid) {
      if (loading) loading.style.display = 'flex';
      if (grid) grid.innerHTML = '';
      this.allData = [];
    }

    // 显示底部加载指示器
    this._showLoadMoreIndicator(true);

    try {
      const apiPath = this._getApiPath();
      const params = new URLSearchParams();
      if (this.keyword) params.set('keyword', this.keyword);
      if (this.currentPage > 1) params.set('page', this.currentPage);
      if (this.pageSize !== 20) params.set('page_size', this.pageSize);

      const url = `${this.BASE_URL}${apiPath}?${params.toString()}`;
      console.log('[Documents] Fetching:', url);

      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = await response.json();
      this.data = result.data || [];
      this.total = result.total || 0;

      // 前端排序
      if (this.currentSort === 'hot') {
        this.data.sort((a, b) => {
          const aViews = (a.view_count || 0) + (a.click_count || 0);
          const bViews = (b.view_count || 0) + (b.click_count || 0);
          return bViews - aViews;
        });
      }
      // latest 排序：后端默认按更新时间倒序，无需额外处理

      // 累积数据
      this.allData = this.allData.concat(this.data);
      this.hasMore = this.allData.length < this.total;

      this.renderGrid();
      this.renderPagination();
    } catch (err) {
      console.error('[Documents] Fetch error:', err);
      if (resetGrid && grid) {
        grid.innerHTML = `
          <div class="documents-empty">
            <div class="empty-icon">⚠️</div>
            <p>加载失败</p>
            <span class="empty-hint">${err.message}</span>
          </div>`;
      }
    } finally {
      this.isLoading = false;
      if (loading) loading.style.display = 'none';
      this._showLoadMoreIndicator(false);
    }
  },

  _showLoadMoreIndicator(show) {
    let indicator = document.getElementById('loadMoreIndicator');
    if (show) {
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'loadMoreIndicator';
        indicator.className = 'load-more-indicator';
        indicator.innerHTML = '<div class="spinner"></div><span>加载更多...</span>';
        const grid = document.getElementById('documentsGrid');
        if (grid && grid.parentNode) {
          grid.parentNode.appendChild(indicator);
        }
      }
      indicator.style.display = 'flex';
    } else {
      if (indicator) indicator.style.display = 'none';
    }
  },

  _getApiPath() {
    switch (this.currentType) {
      case 'cloud': {
        switch (this.cloudSubType) {
          case 'documents': return '/api/public/documents';
          case 'cases': return '/api/public/cases';
          case 'demos': return '/api/public/demos';
          case 'learning': return '/api/public/learning';
          default: return '/api/public/documents';
        }
      }
      case 'artifacts': return null; // Agent 产物不走 API
      default: return '/api/public/documents';
    }
  },

  renderGrid() {
    const grid = document.getElementById('documentsGrid');
    if (!grid) return;

    if (this.allData.length === 0) {
      const typeLabel = { documents: '文档', cases: '案例', demos: 'Demo', learning: '学习材料' }[this.cloudSubType];
      grid.innerHTML = `
        <div class="documents-empty">
          <div class="empty-icon">📭</div>
          <p>暂无${typeLabel}</p>
          <span class="empty-hint">${this.keyword ? '试试换个关键词搜索' : '数据正在录入中'}</span>
        </div>`;
      return;
    }

    grid.innerHTML = this.allData.map(item => this._renderCard(item)).join('');

    // 绑定卡片点击事件
    grid.querySelectorAll('.doc-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        const type = card.dataset.type;
        this._handleCardClick(id, type);
      });
    });

    // 绑定下载按钮
    grid.querySelectorAll('.doc-download-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const type = btn.dataset.type;
        this._handleDownload(id, type);
      });
    });
  },

  _renderCard(item) {
    const subType = this.currentType === 'cloud' ? this.cloudSubType : this.currentType;
    switch (subType) {
      case 'documents': return this._renderDocumentCard(item);
      case 'cases': return this._renderCaseCard(item);
      case 'demos': return this._renderDemoCard(item);
      case 'learning': return this._renderLearningCard(item);
      default: return this._renderDocumentCard(item);
    }
  },

  _renderDocumentCard(doc) {
    const fileIcon = this._getFileIcon(doc.file_type);
    const timeAgo = this._timeAgo(doc.updated_at || doc.created_at);
    const fullTime = doc.updated_at || doc.created_at || '';

    return `
      <div class="doc-card" data-id="${doc.id}" data-type="document">
        <div class="doc-card-icon">${fileIcon}</div>
        <div class="doc-card-body">
          <div class="doc-card-title">${this._escapeHtml(doc.title)}</div>
          <div class="doc-card-desc">${this._escapeHtml(doc.description || '')}</div>
          <div class="doc-card-meta">
            <span class="doc-category">${this._escapeHtml(doc.category || '')}</span>
            ${doc.industry ? `<span class="doc-industry">${this._escapeHtml(doc.industry)}</span>` : ''}
            <span class="doc-time" title="${fullTime}">${timeAgo}</span>
          </div>
          <div class="doc-card-stats">
            <span>👁 ${doc.view_count || 0}</span>
            <span>⬇ ${doc.download_count || 0}</span>
            ${doc.author_name ? `<span>✍ ${this._escapeHtml(doc.author_name)}</span>` : ''}
          </div>
        </div>
        <button class="doc-download-btn" data-id="${doc.id}" data-type="document" title="下载">⬇</button>
      </div>`;
  },

  _renderCaseCard(c) {
    const timeAgo = this._timeAgo(c.updated_at || c.created_at);
    const fullTime = c.updated_at || c.created_at || '';

    return `
      <div class="doc-card doc-card-case" data-id="${c.id}" data-type="case">
        <div class="doc-card-icon">💼</div>
        <div class="doc-card-body">
          <div class="doc-card-title">${this._escapeHtml(c.title)}</div>
          <div class="doc-card-desc">${this._escapeHtml(c.description || '')}</div>
          <div class="doc-card-meta">
            ${c.client_name ? `<span class="doc-client">🏢 ${this._escapeHtml(c.client_name)}</span>` : ''}
            ${c.industry ? `<span class="doc-industry">${this._escapeHtml(c.industry)}</span>` : ''}
            <span class="doc-time" title="${fullTime}">${timeAgo}</span>
          </div>
          <div class="doc-card-stats">
            <span>👁 ${c.view_count || 0}</span>
            <span>⬇ ${c.download_count || 0}</span>
          </div>
        </div>
        <button class="doc-download-btn" data-id="${c.id}" data-type="case" title="下载">⬇</button>
      </div>`;
  },

  _renderDemoCard(d) {
    const timeAgo = this._timeAgo(d.updated_at || d.created_at);
    const fullTime = d.updated_at || d.created_at || '';

    return `
      <div class="doc-card doc-card-demo" data-id="${d.id}" data-type="demo">
        <div class="doc-card-icon">🎮</div>
        <div class="doc-card-body">
          <div class="doc-card-title">${this._escapeHtml(d.name || d.title)}</div>
          <div class="doc-card-desc">${this._escapeHtml(d.description || '')}</div>
          <div class="doc-card-meta">
            ${d.category ? `<span class="doc-category">${this._escapeHtml(d.category)}</span>` : ''}
            <span class="doc-time" title="${fullTime}">${timeAgo}</span>
          </div>
          <div class="doc-card-stats">
            <span>🖱 ${d.click_count || 0}</span>
            <span>⬇ ${d.download_count || 0}</span>
          </div>
        </div>
        ${d.access_url ? `<a class="doc-demo-link" href="${this._escapeHtml(d.access_url)}" target="_blank" onclick="event.stopPropagation()">🔗</a>` : ''}
      </div>`;
  },

  _renderLearningCard(l) {
    const timeAgo = this._timeAgo(l.updated_at || l.created_at);
    const fullTime = l.updated_at || l.created_at || '';
    const tags = (l.tags && Array.isArray(l.tags)) ? l.tags : [];
    const isOnline = !!(l.html_url); // 有 html_url 则在线打开

    return `
      <div class="doc-card doc-card-learning" data-id="${l.id}" data-type="learning">
        <div class="doc-card-icon">${isOnline ? '🌐' : '📚'}</div>
        <div class="doc-card-body">
          <div class="doc-card-title">${this._escapeHtml(l.title)}</div>
          <div class="doc-card-desc">${this._escapeHtml(l.description || '')}</div>
          <div class="doc-card-meta">
            ${l.category ? `<span class="doc-category">${this._escapeHtml(l.category)}</span>` : ''}
            ${tags.length > 0 ? `<span class="doc-tags">${tags.map(t => `#${this._escapeHtml(t)}`).join(' ')}</span>` : ''}
            <span class="doc-time" title="${fullTime}">${timeAgo}</span>
          </div>
          <div class="doc-card-stats">
            <span>👁 ${l.view_count || 0}</span>
            <span>${isOnline ? '📖' : '⬇'} ${l.download_count || 0}</span>
            ${l.author_name ? `<span>✍ ${this._escapeHtml(l.author_name)}</span>` : ''}
          </div>
        </div>
        <button class="doc-download-btn" data-id="${l.id}" data-type="learning" title="${isOnline ? '在线查看' : '下载'}">${isOnline ? '📖' : '⬇'}</button>
      </div>`;
  },

  renderPagination() {
    const pagination = document.getElementById('documentsPagination');
    const info = document.getElementById('paginationInfo');
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');

    if (!pagination) return;

    if (this.total <= this.pageSize) {
      pagination.classList.add('hidden');
      return;
    }

    pagination.classList.remove('hidden');
    const maxPage = Math.ceil(this.total / this.pageSize);
    if (info) info.textContent = `已加载 ${this.allData.length} / ${this.total} 条`;
    if (prevBtn) prevBtn.style.display = 'none';
    if (nextBtn) {
      nextBtn.style.display = '';
      nextBtn.textContent = this.hasMore ? '加载更多' : '已全部加载';
      nextBtn.disabled = !this.hasMore;
      nextBtn.onclick = () => {
        if (this.hasMore) this.loadMore();
      };
    }
  },

  async _handleCardClick(id, type) {
    try {
      const typePath = { document: 'documents', case: 'cases', demo: 'demos', learning: 'learning' }[type];
      const url = `${this.BASE_URL}/api/public/${typePath}/${id}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const detail = await res.json();
      this._showDetailModal(detail, type);
    } catch (err) {
      console.error('[Documents] Detail fetch error:', err);
    }
  },

  _showDetailModal(item, type) {
    const overlay = document.createElement('div');
    overlay.className = 'doc-detail-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    const typeLabel = { document: '文档', case: '案例', demo: 'Demo', learning: '学习材料' }[type];
    const title = item.title || item.name || '详情';
    const description = item.description || '';
    const timeAgo = this._timeAgo(item.updated_at || item.created_at);

    let extraFields = '';
    if (item.category) extraFields += `<div class="detail-field"><span class="detail-label">分类</span><span class="detail-value">${this._escapeHtml(item.category)}</span></div>`;
    if (item.industry) extraFields += `<div class="detail-field"><span class="detail-label">行业</span><span class="detail-value">${this._escapeHtml(item.industry)}</span></div>`;
    if (item.author_name) extraFields += `<div class="detail-field"><span class="detail-label">作者</span><span class="detail-value">${this._escapeHtml(item.author_name)}</span></div>`;
    if (item.client_name) extraFields += `<div class="detail-field"><span class="detail-label">客户</span><span class="detail-value">${this._escapeHtml(item.client_name)}</span></div>`;
    if (item.file_name) extraFields += `<div class="detail-field"><span class="detail-label">文件</span><span class="detail-value">${this._escapeHtml(item.file_name)}</span></div>`;

    const tags = (item.tags && Array.isArray(item.tags)) ? item.tags : [];
    if (tags.length > 0) extraFields += `<div class="detail-field"><span class="detail-label">标签</span><span class="detail-value">${tags.map(t => `#${this._escapeHtml(t)}`).join(' ')}</span></div>`;

    // 判断是否在线文档：学习材料有 html_url、文档 file_type 为 html/md、demo 有 access_url
    const isOnlineDoc = this._isOnlineResource(item, type);

    let actionBtn = '';
    if (type === 'demo' && item.access_url) {
      actionBtn = `<button class="detail-action-btn primary" onclick="window.electronAPI?.openExternal('${this._escapeHtml(item.access_url)}')">🔗 打开 Demo</button>`;
    } else if (isOnlineDoc) {
      const openUrl = this._getOnlineUrl(item, type);
      actionBtn = `<button class="detail-action-btn primary" onclick="window.electronAPI?.openExternal('${this._escapeHtml(openUrl)}'); this.closest('.doc-detail-overlay').remove();">📖 在线查看</button>`;
    } else {
      actionBtn = `<button class="detail-action-btn primary" onclick="Documents._handleDownload('${item.id}', '${type}'); this.closest('.doc-detail-overlay').remove();">⬇ 下载</button>`;
    }

    overlay.innerHTML = `
      <div class="doc-detail-modal">
        <div class="doc-detail-header">
          <span class="doc-detail-type">${typeLabel}</span>
          <h3 class="doc-detail-title">${this._escapeHtml(title)}</h3>
          <button class="doc-detail-close" onclick="this.closest('.doc-detail-overlay').remove()">×</button>
        </div>
        <div class="doc-detail-body">
          <p class="doc-detail-desc">${this._escapeHtml(description)}</p>
          <div class="doc-detail-fields">${extraFields}</div>
          <div class="doc-detail-stats">
            <span>👁 ${item.view_count || item.click_count || 0} 浏览</span>
            <span>⬇ ${item.download_count || 0} 下载</span>
            <span>🕐 ${timeAgo}</span>
          </div>
        </div>
        <div class="doc-detail-footer">
          ${actionBtn}
          <button class="detail-action-btn" onclick="this.closest('.doc-detail-overlay').remove()">关闭</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
  },

  _handleDownload(id, type) {
    // 先从 allData 中查找该条目，判断是否在线文档
    const item = this.allData.find(d => d.id === id);
    if (item && this._isOnlineResource(item, type)) {
      const openUrl = this._getOnlineUrl(item, type);
      if (window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(openUrl);
      } else {
        window.open(openUrl, '_blank');
      }
      return;
    }
    // 非在线文档，走下载
    const typePath = { document: 'document', case: 'case', demo: 'demo', learning: 'learning' }[type];
    const url = `${this.BASE_URL}/api/public/download/${typePath}/${id}`;
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  },

  /**
   * 判断资源是否为在线文档（应打开而非下载）
   */
  _isOnlineResource(item, type) {
    // 学习材料有 html_url → 在线打开
    if (type === 'learning' && item.html_url) return true;
    // 文档的 file_type 为 html/md → 在线打开
    if (type === 'document') {
      const ft = (item.file_type || '').toLowerCase().replace('.', '');
      if (['html', 'htm', 'md', 'markdown'].includes(ft)) return true;
    }
    return false;
  },

  /**
   * 获取在线文档的完整 URL
   */
  _getOnlineUrl(item, type) {
    if (type === 'learning' && item.html_url) {
      return item.html_url.startsWith('http') ? item.html_url : `${this.BASE_URL}${item.html_url}`;
    }
    if (type === 'document' && item.file_url) {
      return item.file_url.startsWith('http') ? item.file_url : `${this.BASE_URL}${item.file_url}`;
    }
    return `${this.BASE_URL}/api/public/download/${type}/${item.id}`;
  },

  _getFileIcon(fileType) {
    if (!fileType) return '📄';
    const ext = fileType.toLowerCase().replace('.', '');
    const iconMap = {
      pdf: '📕', doc: '📘', docx: '📘',
      xls: '📗', xlsx: '📗', ppt: '📙', pptx: '📙',
      zip: '🗜', rar: '🗜', mp4: '🎬',
      png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼',
      html: '🌐', md: '📝', txt: '📝'
    };
    return iconMap[ext] || '📄';
  },

  _timeAgo(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    const months = Math.floor(days / 30);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 30) return `${days}天前`;
    if (months < 12) return `${months}个月前`;
    return `${Math.floor(days / 365)}年前`;
  },

  _escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }
};

window.Documents = Documents;

/**
 * Agent 产物模块 - 管理AI助手生成的文档交付物
 * 保存目录：默认 userData/agent-artifacts/，按时间子目录组织
 * 支持：HTML、Markdown、JSON、文本等文件
 */
const AgentArtifacts = {
  basePath: '',
  initialized: false,

  init() {
    if (this.initialized) return;
    this.initialized = true;

    // 更改保存目录
    document.getElementById('artifactsChangeDirBtn')?.addEventListener('click', async () => {
      if (window.electronAPI?.artifactsChangeDir) {
        const result = await window.electronAPI.artifactsChangeDir();
        if (result?.path) {
          this.basePath = result.path;
          this._updatePathDisplay();
          this.loadArtifacts();
        }
      }
    });

    // 在 Finder 中打开
    document.getElementById('artifactsOpenDirBtn')?.addEventListener('click', () => {
      if (window.electronAPI?.artifactsOpenDir) {
        window.electronAPI.artifactsOpenDir();
      }
    });

    // 刷新
    document.getElementById('artifactsRefreshBtn')?.addEventListener('click', () => {
      this.loadArtifacts();
    });
  },

  async onShow() {
    this.init();
    await this._loadBasePath();
    this.loadArtifacts();
  },

  async _loadBasePath() {
    if (window.electronAPI?.artifactsGetBasePath) {
      try {
        const result = await window.electronAPI.artifactsGetBasePath();
        this.basePath = result.path || '';
      } catch (e) {
        console.error('[AgentArtifacts] Failed to get base path:', e);
      }
    }
    this._updatePathDisplay();
  },

  _updatePathDisplay() {
    const el = document.getElementById('artifactsPathValue');
    if (el) el.textContent = this.basePath || '未设置';
  },

  async loadArtifacts() {
    const grid = document.getElementById('artifactsGrid');
    const empty = document.getElementById('artifactsEmpty');
    const loading = document.getElementById('artifactsLoading');

    if (!grid) return;
    grid.innerHTML = '';
    if (empty) empty.style.display = 'none';
    if (loading) loading.style.display = 'flex';

    try {
      if (!window.electronAPI?.artifactsList) {
        if (loading) loading.style.display = 'none';
        if (empty) empty.style.display = 'flex';
        return;
      }

      const result = await window.electronAPI.artifactsList();
      if (loading) loading.style.display = 'none';

      const artifacts = result.artifacts || [];
      if (artifacts.length === 0) {
        if (empty) empty.style.display = 'flex';
        return;
      }

      // 按日期分组
      const grouped = {};
      artifacts.forEach(a => {
        const dateKey = a.dateFolder || '未知日期';
        if (!grouped[dateKey]) grouped[dateKey] = [];
        grouped[dateKey].push(a);
      });

      // 按日期倒序渲染
      const sortedDates = Object.keys(grouped).sort().reverse();
      grid.innerHTML = sortedDates.map(date => {
        const items = grouped[date].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        return `
          <div class="artifact-date-group">
            <div class="artifact-date-header">📅 ${this._escapeHtml(date)}</div>
            ${items.map(item => this._renderArtifactCard(item)).join('')}
          </div>`;
      }).join('');

      // 绑定事件
      grid.querySelectorAll('.artifact-card').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.artifact-action-btn')) return;
          this._previewArtifact(card.dataset.path);
        });
      });
      grid.querySelectorAll('.artifact-action-btn[data-action="open"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._openInFinder(btn.dataset.path);
        });
      });
      grid.querySelectorAll('.artifact-action-btn[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm('确定删除此文件？')) {
            await this._deleteArtifact(btn.dataset.path);
          }
        });
      });
    } catch (err) {
      console.error('[AgentArtifacts] Load error:', err);
      if (loading) loading.style.display = 'none';
      grid.innerHTML = `<div class="artifacts-empty"><div class="empty-icon">⚠️</div><p>加载失败</p><span class="empty-hint">${err.message}</span></div>`;
    }
  },

  _renderArtifactCard(item) {
    const icon = this._getFileIcon(item.ext);
    const typeLabel = this._getTypeLabel(item.ext);
    const sizeStr = this._formatSize(item.size);
    const timeStr = this._formatTime(item.created_at);

    return `
      <div class="artifact-card" data-path="${this._escapeHtml(item.path)}">
        <div class="artifact-card-icon">${icon}</div>
        <div class="artifact-card-body">
          <div class="artifact-card-name" title="${this._escapeHtml(item.name)}">${this._escapeHtml(item.name)}</div>
          <div class="artifact-card-meta">
            <span class="artifact-card-type">${typeLabel}</span>
            <span class="artifact-card-size">${sizeStr}</span>
            <span class="artifact-card-time">${timeStr}</span>
          </div>
        </div>
        <div class="artifact-card-actions">
          <button class="artifact-action-btn" data-action="open" data-path="${this._escapeHtml(item.path)}" title="在 Finder 中显示">📁</button>
          <button class="artifact-action-btn danger" data-action="delete" data-path="${this._escapeHtml(item.path)}" title="删除">🗑️</button>
        </div>
      </div>`;
  },

  async _previewArtifact(filePath) {
    if (!window.electronAPI?.artifactsRead) return;

    const overlay = document.createElement('div');
    overlay.className = 'artifact-preview-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    const fileName = filePath.split('/').pop() || '预览';
    const ext = fileName.split('.').pop()?.toLowerCase() || '';

    let bodyContent = '';
    try {
      const result = await window.electronAPI.artifactsRead(filePath);
      if (result.success) {
        if (ext === 'html' || ext === 'htm') {
          bodyContent = `<iframe sandbox="allow-scripts allow-same-origin allow-popups allow-forms" srcdoc="${this._escapeAttr(result.content)}"></iframe>`;
        } else {
          bodyContent = `<pre>${this._escapeHtml(result.content)}</pre>`;
        }
      } else {
        bodyContent = `<pre style="color: #FF3B30;">读取失败: ${this._escapeHtml(result.error || '')}</pre>`;
      }
    } catch (err) {
      bodyContent = `<pre style="color: #FF3B30;">读取错误: ${this._escapeHtml(err.message)}</pre>`;
    }

    overlay.innerHTML = `
      <div class="artifact-preview-modal">
        <div class="artifact-preview-header">
          <span class="artifact-preview-title">${this._escapeHtml(fileName)}</span>
          <button class="artifact-preview-close" onclick="this.closest('.artifact-preview-overlay').remove()">×</button>
        </div>
        <div class="artifact-preview-body">${bodyContent}</div>
      </div>`;

    document.body.appendChild(overlay);
  },

  async _openInFinder(filePath) {
    if (window.electronAPI?.artifactsShowInFolder) {
      await window.electronAPI.artifactsShowInFolder(filePath);
    }
  },

  async _deleteArtifact(filePath) {
    if (window.electronAPI?.artifactsDelete) {
      const result = await window.electronAPI.artifactsDelete(filePath);
      if (result.success) {
        this.loadArtifacts();
      } else {
        alert('删除失败: ' + (result.error || ''));
      }
    }
  },

  _getFileIcon(ext) {
    const map = { html: '🌐', htm: '🌐', md: '📝', json: '📋', js: '💻', ts: '💻', css: '🎨', py: '🐍', txt: '📄', svg: '🖼', png: '🖼', jpg: '🖼', pdf: '📕', xlsx: '📊', docx: '📘' };
    return map[ext] || '📄';
  },

  _getTypeLabel(ext) {
    const map = { html: 'HTML', htm: 'HTML', md: 'Markdown', json: 'JSON', js: 'JavaScript', ts: 'TypeScript', css: 'CSS', py: 'Python', txt: 'Text', svg: 'SVG', pdf: 'PDF', xlsx: 'Excel' };
    return map[ext] || ext?.toUpperCase() || 'FILE';
  },

  _formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  },

  _formatTime(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const diff = now - d;
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return '刚刚';
      if (mins < 60) return mins + '分钟前';
      const hours = Math.floor(mins / 60);
      if (hours < 24) return hours + '小时前';
      const days = Math.floor(hours / 24);
      if (days < 30) return days + '天前';
      return d.toLocaleDateString('zh-CN');
    } catch { return dateStr; }
  },

  _escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  },

  _escapeAttr(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
};

window.AgentArtifacts = AgentArtifacts;
