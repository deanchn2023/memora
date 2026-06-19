/**
 * 知识文档模块 - 对接 ADP Toolkit 公开资源 API
 * BASE_URL 动态获取：优先使用登录环境的 toolkitUrl，未登录则使用默认地址
 */

const Documents = {
  BASE_URL: '', // 动态获取，不硬编码
  currentType: 'knowledge-base', // cloud | local | artifacts | knowledge-base
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

  // 多选发送 AI 相关
  _selectMode: false,
  _selectedItems: [], // [{ type, id, path, title, url, data }]

  // 允许访问云端资料的组织名单
  CLOUD_ALLOWED_ORGS: ['云智能 ADP 产品中心', '云智能架构师', 'CSIG 行业架构'],

  init() {
    if (this.initialized) return;
    this.initialized = true;

    // 初始化时根据用户组织控制云端资料标签可见性
    this._updateCloudTabVisibility();

    // 监听认证状态变化（登录/登出后更新云端资料可见性）
    if (window.electronAPI?.onAuthChanged) {
      window.electronAPI.onAuthChanged((data) => {
        console.log('[Documents] Auth changed, updating cloud tab visibility');
        this._applyCloudTabVisibility(data);
      });
    }

    // 顶级分类标签切换：知识库 | 云端资料 | 本地 | Agent 产物
    document.querySelectorAll('.doc-cat-tab:not(.send-to-ai-toggle)').forEach(tab => {
      tab.addEventListener('click', (e) => {
        // 切换标签时退出多选模式
        if (this._selectMode) this._exitSelectMode();
        document.querySelectorAll('.doc-cat-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        this.currentType = e.target.dataset.type;
        this.currentPage = 1;
        this.allData = [];
        this.hasMore = true;
        this.keyword = document.getElementById('documentsSearchInput')?.value || '';

        const localContainer = document.getElementById('localFilesContainer');
        const artifactsContainer = document.getElementById('agentArtifactsContainer');
        const kbContainer = document.getElementById('knowledgeBaseContainer');
        const skillContainer = document.getElementById('skillContainer');
        const normalElements = document.querySelectorAll('#documentsGrid, #documentsPagination, #documentsLoading');
        const cloudSubTabs = document.getElementById('cloudSubTabs');
        const sortTabs = document.getElementById('documentsSortTabs');

        // 隐藏所有子容器
        if (localContainer) localContainer.classList.add('hidden');
        if (artifactsContainer) artifactsContainer.classList.add('hidden');
        if (kbContainer) kbContainer.classList.add('hidden');
        if (skillContainer) skillContainer.classList.add('hidden');
        normalElements.forEach(el => el.classList.add('hidden'));
        if (cloudSubTabs) cloudSubTabs.classList.add('hidden');

        // 排序标签仅云端资料显示
        if (sortTabs) sortTabs.classList.toggle('hidden', this.currentType !== 'cloud');

        // 更新搜索框 placeholder
        this._updateSearchPlaceholder();

        if (this.currentType === 'knowledge-base') {
          if (kbContainer) kbContainer.classList.remove('hidden');
          if (cloudSubTabs) cloudSubTabs.classList.add('hidden');
          if (window.KnowledgeBase) KnowledgeBase.onShow();
        } else if (this.currentType === 'local') {
          if (localContainer) localContainer.classList.remove('hidden');
          if (window.LocalFiles) LocalFiles.onShow();
        } else if (this.currentType === 'artifacts') {
          if (artifactsContainer) artifactsContainer.classList.remove('hidden');
          AgentArtifacts.onShow();
        } else if (this.currentType === 'skill') {
          if (skillContainer) skillContainer.classList.remove('hidden');
          if (window.App) {
            App._loadSkillList();
            App._initSkillHub();
          }
        } else {
          // cloud
          normalElements.forEach(el => el.classList.remove('hidden'));
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

    // 搜索（根据当前标签路由到对应模块）
    document.getElementById('documentsSearchBtn')?.addEventListener('click', () => {
      this.keyword = document.getElementById('documentsSearchInput')?.value || '';
      this._executeSearch();
    });

    document.getElementById('documentsSearchInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.keyword = e.target.value || '';
        this._executeSearch();
      }
    });

    // 多选发送 AI 助手
    document.getElementById('sendToAIToggle')?.addEventListener('click', () => {
      this._toggleSelectMode();
    });
    document.getElementById('sendToAICancel')?.addEventListener('click', () => {
      this._exitSelectMode();
    });
    document.getElementById('sendToAIConfirm')?.addEventListener('click', () => {
      this._sendToAI();
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
    // 更新云端资料可见性
    this._updateCloudTabVisibility();
    // 根据当前类型加载数据并显示/隐藏容器
    this._showCurrentType();
  },

  /** 根据当前类型显示/隐藏容器并加载数据 */
  _showCurrentType() {
    const localContainer = document.getElementById('localFilesContainer');
    const artifactsContainer = document.getElementById('agentArtifactsContainer');
    const kbContainer = document.getElementById('knowledgeBaseContainer');
    const normalElements = document.querySelectorAll('#documentsGrid, #documentsPagination, #documentsLoading');
    const cloudSubTabs = document.getElementById('cloudSubTabs');
    const sortTabs = document.getElementById('documentsSortTabs');

    // 先隐藏所有
    if (localContainer) localContainer.classList.add('hidden');
    if (artifactsContainer) artifactsContainer.classList.add('hidden');
    if (kbContainer) kbContainer.classList.add('hidden');
    normalElements.forEach(el => el.classList.add('hidden'));
    if (cloudSubTabs) cloudSubTabs.classList.add('hidden');

    // 排序标签仅云端资料显示
    if (sortTabs) sortTabs.classList.toggle('hidden', this.currentType !== 'cloud');

    // 更新搜索框 placeholder
    this._updateSearchPlaceholder();

    if (this.currentType === 'knowledge-base') {
      if (kbContainer) kbContainer.classList.remove('hidden');
      if (cloudSubTabs) cloudSubTabs.classList.add('hidden');
      if (window.KnowledgeBase) KnowledgeBase.onShow();
    } else if (this.currentType === 'local') {
      if (localContainer) localContainer.classList.remove('hidden');
      if (window.LocalFiles) LocalFiles.onShow();
    } else if (this.currentType === 'artifacts') {
      if (artifactsContainer) artifactsContainer.classList.remove('hidden');
      AgentArtifacts.onShow();
    } else {
      // cloud
      normalElements.forEach(el => el.classList.remove('hidden'));
      if (cloudSubTabs) cloudSubTabs.classList.remove('hidden');
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

  /** 根据用户组织控制云端资料标签可见性 */
  async _updateCloudTabVisibility() {
    try {
      if (!window.electronAPI?.authGetState) return;
      const state = await window.electronAPI.authGetState();
      this._applyCloudTabVisibility(state);
    } catch (err) {
      console.warn('[Documents] Cloud tab visibility check failed:', err);
    }
  },

  /** 实际应用云端资料标签可见性逻辑 */
  _applyCloudTabVisibility(state) {
    const cloudTab = document.querySelector('.doc-cat-tab[data-type="cloud"]');
    const cloudSubTabs = document.getElementById('cloudSubTabs');

    if (!state || !state.isLoggedIn) {
      // 未登录 — 隐藏云端资料
      if (cloudTab) cloudTab.style.display = 'none';
      if (cloudSubTabs) cloudSubTabs.style.display = 'none';
      if (this.currentType === 'cloud') {
        this._switchToKnowledgeBase(cloudTab);
      }
      return;
    }

    // 兼容 ADPToolkit 返回的 organization 字段和 Config Server 返回的 org_name 字段
    const orgName = state.user?.org_name || state.user?.organization || '';
    const isAllowed = this.CLOUD_ALLOWED_ORGS.some(org => orgName.includes(org));
    console.log('[Documents] Cloud tab check:', { orgName, isAllowed });

    if (!isAllowed) {
      if (cloudTab) cloudTab.style.display = 'none';
      if (cloudSubTabs) cloudSubTabs.style.display = 'none';
      if (this.currentType === 'cloud') {
        this._switchToKnowledgeBase(cloudTab);
      }
    } else {
      if (cloudTab) cloudTab.style.display = '';
      if (cloudSubTabs) cloudSubTabs.style.display = '';
    }
  },

  /** 切换到知识库标签 */
  _switchToKnowledgeBase(cloudTab) {
    this.currentType = 'knowledge-base';
    const kbTab = document.querySelector('.doc-cat-tab[data-type="knowledge-base"]');
    if (kbTab) kbTab.classList.add('active');
    if (cloudTab) cloudTab.classList.remove('active');
  },

  /** 根据当前标签更新搜索框 placeholder */
  _updateSearchPlaceholder() {
    const input = document.getElementById('documentsSearchInput');
    if (!input) return;
    const placeholders = {
      'knowledge-base': '搜索知识库资产...',
      'cloud': '搜索文档、案例、Demo...',
      'local': '搜索本地文件...',
      'artifacts': '搜索 Agent 产物...'
    };
    input.placeholder = placeholders[this.currentType] || placeholders['cloud'];
  },

  /** 根据当前标签执行搜索 */
  _executeSearch() {
    this.currentPage = 1;
    this.allData = [];
    this.hasMore = true;

    if (this.currentType === 'cloud') {
      this.fetchData(true);
    } else if (this.currentType === 'knowledge-base') {
      if (window.KnowledgeBase) KnowledgeBase.searchFromExternal(this.keyword);
    } else if (this.currentType === 'local') {
      if (window.LocalFiles) LocalFiles.searchFromExternal(this.keyword);
    } else if (this.currentType === 'artifacts') {
      if (window.AgentArtifacts) AgentArtifacts.searchFromExternal?.(this.keyword);
    }
  },

  // ============= 多选发送 AI 助手 =============

  /** 切换多选模式 */
  _toggleSelectMode() {
    if (this._selectMode) {
      this._exitSelectMode();
    } else {
      this._enterSelectMode();
    }
  },

  /** 进入多选模式 */
  _enterSelectMode() {
    this._selectMode = true;
    this._selectedItems = [];
    const toggle = document.getElementById('sendToAIToggle');
    if (toggle) toggle.classList.add('active');
    this._updateSelectBar();
    // 重新渲染当前列表以显示复选框
    this._refreshCurrentList();
  },

  /** 退出多选模式 */
  _exitSelectMode() {
    this._selectMode = false;
    this._selectedItems = [];
    const toggle = document.getElementById('sendToAIToggle');
    if (toggle) toggle.classList.remove('active');
    const bar = document.getElementById('sendToAIBar');
    if (bar) bar.classList.add('hidden');
    // 重新渲染以移除复选框
    this._refreshCurrentList();
  },

  /** 刷新当前列表 */
  _refreshCurrentList() {
    if (this.currentType === 'cloud') {
      this.renderData();
    } else if (this.currentType === 'local') {
      if (window.LocalFiles) LocalFiles.renderFileList();
    } else if (this.currentType === 'artifacts') {
      AgentArtifacts.loadMultimodal();
    }
  },

  /** 切换卡片选中状态 */
  _toggleCardSelection(card, sourceType) {
    const key = this._getCardKey(card, sourceType);
    const idx = this._selectedItems.findIndex(s => s.key === key);

    if (idx >= 0) {
      this._selectedItems.splice(idx, 1);
      card.classList.remove('selected');
      this._updateCheckbox(card, false);
    } else {
      const item = this._buildSelectedItem(card, sourceType);
      if (item) {
        this._selectedItems.push(item);
        card.classList.add('selected');
        this._updateCheckbox(card, true);
      }
    }
    this._updateSelectBar();
  },

  /** 获取卡片唯一标识 */
  _getCardKey(card, sourceType) {
    if (sourceType === 'local' || sourceType === 'artifact') {
      return `${sourceType}:${card.dataset.path}`;
    }
    return `cloud:${card.dataset.type}:${card.dataset.id}`;
  },

  /** 构建选中的项目数据 */
  _buildSelectedItem(card, sourceType) {
    if (sourceType === 'local') {
      const name = card.querySelector('.local-file-name')?.textContent || '';
      return { key: `local:${card.dataset.path}`, source: 'local', path: card.dataset.path, title: name };
    }
    if (sourceType === 'artifact') {
      const name = card.querySelector('.artifact-card-name')?.textContent || '';
      return { key: `artifact:${card.dataset.path}`, source: 'artifact', path: card.dataset.path, title: name };
    }
    // cloud
    const id = card.dataset.id;
    const type = card.dataset.type;
    const title = card.querySelector('.doc-card-title')?.textContent || '';
    const desc = card.querySelector('.doc-card-desc')?.textContent || '';
    // 从 allData 中查找完整数据
    const data = this.allData.find(d => String(d.id) === String(id));
    const url = data?.html_url || data?.access_url || data?.file_url || '';
    return { key: `cloud:${type}:${id}`, source: 'cloud', id, type, title, desc, url, data };
  },

  /** 更新复选框视觉状态 */
  _updateCheckbox(card, checked) {
    const checkbox = card.querySelector('.doc-card-checkbox');
    if (!checkbox) return;
    checkbox.classList.toggle('checked', checked);
    checkbox.innerHTML = checked
      ? '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="2" y="2" width="20" height="20" rx="6" fill="#007AFF" stroke="#007AFF" stroke-width="2"/><path d="M7 12l3 3 7-7" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="2" y="2" width="20" height="20" rx="6" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  },

  /** 更新底部选择栏 */
  _updateSelectBar() {
    const bar = document.getElementById('sendToAIBar');
    const countEl = document.getElementById('sendToAICount');
    if (!bar) return;

    if (this._selectedItems.length > 0) {
      bar.classList.remove('hidden');
      if (countEl) countEl.textContent = this._selectedItems.length;
    } else {
      bar.classList.add('hidden');
    }
  },

  /** 切换知识库资产卡片选中状态 */
  _toggleKBAssetSelection(card, assetId, title) {
    const key = `kb:${assetId}`;
    const idx = this._selectedItems.findIndex(s => s.key === key);

    if (idx >= 0) {
      this._selectedItems.splice(idx, 1);
      card.classList.remove('selected');
      this._updateCheckbox(card, false);
    } else {
      this._selectedItems.push({ key, source: 'kb', id: assetId, title });
      card.classList.add('selected');
      this._updateCheckbox(card, true);
    }
    this._updateSelectBar();
  },

  /** 发送给 AI 助手 */
  async _sendToAI() {
    const items = this._selectedItems;
    if (items.length === 0) return;

    // 超过 5 个文件提醒
    if (items.length > 5) {
      const ok = await this._customConfirm(
        `已选择 ${items.length} 个文件，大量文件会带来大量 Token 消耗，且处理时间较久。确认继续？`
      );
      if (!ok) return;
    }

    const app = window.App;
    if (!app) return;

    // 清空当前附件
    app._chatAttachments = [];

    // 构建附件和上下文
    let contextText = '';
    for (const item of items) {
      if (item.source === 'cloud') {
        // 云端资料：将标题+描述+URL作为文本上下文
        const typeLabel = { document: '文档', case: '案例', demo: 'Demo', learning: '学习材料' }[item.type] || item.type;
        contextText += `\n【${typeLabel}】${item.title}`;
        if (item.desc) contextText += `\n描述：${item.desc}`;
        if (item.url) contextText += `\n链接：${item.url}`;
        contextText += '\n';
      } else if (item.source === 'local') {
        // 本地文件：读取内容作为附件
        try {
          if (window.electronAPI?.localFilesSearch) {
            // 通过 IPC 读取文件
            const result = await window.electronAPI.localFilesSearch({ paths: [item.path], limit: 1 });
            if (result?.files?.[0]) {
              const f = result.files[0];
              // 对于文本类文件，尝试读取内容
              const blob = new Blob([f.name], { type: 'text/plain' });
              const file = new File([blob], f.name, { type: 'text/plain' });
              app._chatAttachments.push({
                name: f.name,
                size: f.size || 0,
                mimeType: 'text/plain',
                type: 'text',
                file: file
              });
            }
          }
        } catch (e) {
          console.warn('[Documents] Failed to read local file:', item.path, e);
          contextText += `\n【本地文件】${item.title}\n路径：${item.path}\n`;
        }
      } else if (item.source === 'artifact') {
        // Agent 产物：读取内容作为附件
        try {
          if (window.electronAPI?.artifactsRead) {
            const result = await window.electronAPI.artifactsRead(item.path);
            if (result?.success && result.content) {
              const fileName = item.path.split('/').pop() || 'artifact';
              const ext = fileName.split('.').pop()?.toLowerCase() || '';
              const mimeType = ext === 'html' ? 'text/html' : ext === 'json' ? 'application/json' : ext === 'css' ? 'text/css' : 'text/plain';
              const blob = new Blob([result.content], { type: mimeType });
              const file = new File([blob], fileName, { type: mimeType });
              const fileType = app.getFileType(fileName, mimeType);
              app._chatAttachments.push({
                name: fileName,
                size: blob.size,
                mimeType: mimeType,
                type: fileType,
                file: file
              });
            }
          }
        } catch (e) {
          console.warn('[Documents] Failed to read artifact:', item.path, e);
          contextText += `\n【Agent产物】${item.title}\n路径：${item.path}\n`;
        }
      } else if (item.source === 'kb') {
        // 知识库资产：将标题和描述作为文本上下文
        // （知识库资产通过 multimodalOpenFile 在外部打开，无法直接读取内容）
        contextText += `\n【知识库资产】${item.title}`;
        if (item.desc) contextText += `\n描述：${item.desc}`;
        contextText += '\n';
      }
    }

    // 退出选择模式
    this._exitSelectMode();

    // 切换到 AI 助手视图
    app.showAIAssistantView();

    // 如果有文本上下文，填入输入框
    if (contextText) {
      const chatInput = document.getElementById('aiChatInput');
      if (chatInput) {
        chatInput.value = `请分析以下资料：\n${contextText}`;
        chatInput.style.height = 'auto';
        chatInput.style.height = chatInput.scrollHeight + 'px';
      }
    }

    // 渲染附件
    if (app._chatAttachments.length > 0) {
      app.renderChatAttachments();
    }

    // 提示
    const totalItems = items.length;
    app.showToast(`已添加 ${totalItems} 个文件，可编辑后发送`, 'success');
  },

  // 自定义确认弹窗
  _customConfirm(message) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:99999;';
      overlay.innerHTML = `
        <div style="background:var(--bg-elevated,#fff);border-radius:16px;padding:24px;max-width:400px;width:90%;box-shadow:0 24px 48px rgba(0,0,0,0.2);">
          <div style="font-size:15px;line-height:1.6;color:var(--text-primary,#1d1d1f);margin-bottom:20px;">${this._escapeHtml(message)}</div>
          <div style="display:flex;justify-content:flex-end;gap:8px;">
            <button class="cc-cancel" style="padding:8px 18px;border-radius:8px;border:1px solid var(--border-light,#d2d2d7);background:var(--bg-elevated,#fff);color:var(--text-primary,#1d1d1f);cursor:pointer;font-size:14px;">取消</button>
            <button class="cc-ok" style="padding:8px 18px;border-radius:8px;border:none;background:#FF9500;color:#fff;cursor:pointer;font-size:14px;">确认</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const cleanup = (val) => { overlay.remove(); resolve(val); };
      overlay.querySelector('.cc-ok').addEventListener('click', (e) => { e.stopPropagation(); cleanup(true); });
      overlay.querySelector('.cc-cancel').addEventListener('click', (e) => { e.stopPropagation(); cleanup(false); });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    });
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
      card.addEventListener('click', (e) => {
        // 多选模式：切换选中状态
        if (this._selectMode) {
          e.stopPropagation();
          this._toggleCardSelection(card);
          return;
        }
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
    let html;
    switch (subType) {
      case 'documents': html = this._renderDocumentCard(item); break;
      case 'cases': html = this._renderCaseCard(item); break;
      case 'demos': html = this._renderDemoCard(item); break;
      case 'learning': html = this._renderLearningCard(item); break;
      default: html = this._renderDocumentCard(item);
    }
    // 多选模式注入复选框
    if (this._selectMode) {
      const checkboxHtml = `<div class="doc-card-checkbox" data-id="${item.id}" data-type="${subType === 'documents' ? 'document' : subType === 'cases' ? 'case' : subType === 'demos' ? 'demo' : 'learning'}"><svg viewBox="0 0 24 24" width="20" height="20"><rect x="2" y="2" width="20" height="20" rx="6" fill="none" stroke="currentColor" stroke-width="2"/></svg></div>`;
      html = html.replace('<div class="doc-card"', checkboxHtml + '<div class="doc-card"');
    }
    return html;
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
          // 多选模式：切换选中状态
          if (Documents._selectMode) {
            e.stopPropagation();
            Documents._toggleCardSelection(card, 'artifact');
            return;
          }
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
          const ok = await AgentArtifacts._customConfirm('确定删除此文件？此操作不可撤销。');
          if (ok) {
            await this._deleteArtifact(btn.dataset.path);
          }
        });
      });

      // 多选模式：注入复选框
      if (Documents._selectMode) {
        grid.querySelectorAll('.artifact-card').forEach(card => {
          if (card.querySelector('.doc-card-checkbox')) return;
          const checkbox = document.createElement('div');
          checkbox.className = 'doc-card-checkbox';
          checkbox.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="2" y="2" width="20" height="20" rx="6" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
          card.style.position = 'relative';
          card.insertBefore(checkbox, card.firstChild);
        });
      }
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
        this._showToast('删除失败: ' + (result.error || ''), 'error');
      }
    }
  },

  // 自定义确认弹窗（适配暗色模式）
  _customConfirm(message) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:99999;';
      overlay.innerHTML = `
        <div style="background:var(--bg-elevated,#fff);border-radius:16px;padding:24px;max-width:400px;width:90%;box-shadow:0 24px 48px rgba(0,0,0,0.2);">
          <div style="font-size:15px;line-height:1.6;color:var(--text-primary,#1d1d1f);margin-bottom:20px;">${this._escapeHtml(message)}</div>
          <div style="display:flex;justify-content:flex-end;gap:8px;">
            <button class="cc-cancel" style="padding:8px 18px;border-radius:8px;border:1px solid var(--border-light,#d2d2d7);background:var(--bg-elevated,#fff);color:var(--text-primary,#1d1d1f);cursor:pointer;font-size:14px;">取消</button>
            <button class="cc-ok" style="padding:8px 18px;border-radius:8px;border:none;background:#FF3B30;color:#fff;cursor:pointer;font-size:14px;">确认删除</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const cleanup = (val) => { overlay.remove(); resolve(val); };
      overlay.querySelector('.cc-ok').addEventListener('click', (e) => { e.stopPropagation(); cleanup(true); });
      overlay.querySelector('.cc-cancel').addEventListener('click', (e) => { e.stopPropagation(); cleanup(false); });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    });
  },

  _showToast(message, type = 'info') {
    let toast = document.getElementById('artifactToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'artifactToast';
      toast.className = 'mm-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `mm-toast ${type}`;
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
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

// ========== 知识库子模块（从洞察模块迁移） ==========
const KnowledgeBase = {
  data: {
    multimodalAssets: [],
    multimodalFilter: 'all',
    multimodalBooks: []
  },
  _eventsBound: false,  // 防止重复绑定事件

  onShow() {
    this.loadMultimodal();
  },

  /** 从外部搜索接口调用（全局搜索框） */
  searchFromExternal(keyword) {
    // 同步顶部搜索框
    const topSearchInput = document.getElementById('documentsSearchInput');
    if (topSearchInput) topSearchInput.value = keyword;
    // 同一内部搜索框并触发筛选
    const searchInput = document.getElementById('mmSearchInput');
    if (searchInput) {
      searchInput.value = keyword;
      this._filterAssets();
    }
  },

  async _safeCall(fn, fallback) {
    try {
      const result = await fn();
      return result || fallback;
    } catch (err) {
      console.warn('[KnowledgeBase] IPC call failed:', err.message);
      return fallback;
    }
  },

  async loadMultimodal() {
    const container = document.getElementById('knowledgeBaseContent');
    if (!container) return;

    container.innerHTML = '<div class="insight-loading"><div class="spinner"></div><span>加载知识库...</span></div>';

    try {
      const [stats, assetsResult, booksResult] = await Promise.all([
        this._safeCall(() => window.electronAPI?.multimodalStats?.(), { total: 0, byType: {}, totalSize: 0, bookCount: 0 }),
        this._safeCall(() => window.electronAPI?.multimodalList?.({ type: this.data.multimodalFilter, page: 1, pageSize: 50 }), { assets: [], total: 0 }),
        this._safeCall(() => window.electronAPI?.multimodalGetBooks?.(), { books: [] })
      ]);

      this.data.multimodalAssets = assetsResult.assets || [];
      this.data.multimodalBooks = booksResult.books || [];

      container.innerHTML = `
        <div class="mm-toolbar">
          <div class="mm-toolbar-left">
            <div class="mm-type-tabs">
              <button class="mm-type-tab ${this.data.multimodalFilter === 'all' ? 'active' : ''}" data-mm-type="all">📂 全部</button>
              <button class="mm-type-tab ${this.data.multimodalFilter === 'image' ? 'active' : ''}" data-mm-type="image">🖼 图片</button>
              <button class="mm-type-tab ${this.data.multimodalFilter === 'document' ? 'active' : ''}" data-mm-type="document">📄 文档</button>
              <button class="mm-type-tab ${this.data.multimodalFilter === 'audio' ? 'active' : ''}" data-mm-type="audio">🎵 音频</button>
              <button class="mm-type-tab ${this.data.multimodalFilter === 'video' ? 'active' : ''}" data-mm-type="video">🎬 视频</button>
              <button class="mm-type-tab ${this.data.multimodalFilter === 'url' ? 'active' : ''}" data-mm-type="url">🔗 URL</button>
              <button class="mm-type-tab ${this.data.multimodalFilter === 'meeting' ? 'active' : ''}" data-mm-type="meeting">📹 会议</button>
            </div>
          </div>
          <div class="mm-toolbar-right">
            <button class="activation-refresh-btn" id="mmAddUrlBtn" style="background:#34C759">🔗 保存URL</button>
            <button class="activation-refresh-btn" id="mmAddMeetingBtn" style="background:#5856D6">📹 会议记录</button>
          </div>
        </div>

        <!-- 拖拽/点击导入区 -->
        <div class="mm-drop-hint" id="mmDropHint">
          <span class="mm-drop-hint-icon">📥</span>
          <span class="mm-drop-hint-text">拖拽文件到此处 或 点击选择文件导入</span>
          <input type="file" id="mmFileInput" multiple accept=".jpg,.jpeg,.png,.gif,.webp,.mp3,.wav,.m4a,.mp4,.mov,.pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.txt,.md,.csv" style="display:none">
        </div>

        <!-- 知识书本区 -->
        <div class="mm-books-section">
          <div class="activation-section-header">
            <h3>📖 知识书本</h3>
            <button class="activation-refresh-btn" id="mmGenBookBtn">📝 生成知识体系</button>
          </div>
          <div id="mmBooksContent">
            ${this._renderBooks(this.data.multimodalBooks)}
          </div>
        </div>

        <!-- 资产区 -->
        <div class="mm-assets-section">
          <div class="activation-section-header">
            <h3>📦 知识资产 <span style="font-size:12px;color:var(--text-tertiary,#aeaeb2);font-weight:400">(${assetsResult.total || 0})</span></h3>
            <div class="mm-search-box">
              <input type="text" class="mm-search-input" id="mmSearchInput" placeholder="搜索资产...">
            </div>
          </div>
          <div class="mm-assets-grid" id="mmAssetsGrid">
            ${this._renderAssets(this.data.multimodalAssets)}
          </div>
        </div>`;

      // 绑定事件
      this._bindMultimodalEvents();

    } catch (err) {
      console.error('[KnowledgeBase] Load error:', err);
      container.innerHTML = `
        <div class="insight-empty">
          <div class="insight-empty-icon">⚠️</div>
          <div class="insight-empty-title">加载失败</div>
          <div class="insight-empty-desc">${this._escapeHtml(err.message || '请稍后重试')}</div>
          <button class="activation-refresh-btn" style="margin-top:12px" data-retry="loadMultimodal">重新加载</button>
        </div>`;
    }
  },

  _bindMultimodalEvents() {
    // 防止重复绑定（loadMultimodal 每次渲染都会调用此方法）
    if (this._eventsBound) return;
    this._eventsBound = true;
    // 点击导入区
    const dropHint = document.getElementById('mmDropHint');
    const fileInput = document.getElementById('mmFileInput');
    if (dropHint && fileInput) {
      dropHint.addEventListener('click', (e) => {
        if (e.target.id !== 'mmFileInput') {
          e.preventDefault();
          fileInput.click();
        }
      });
    }

    // 搜索防抖
    const searchInput = document.getElementById('mmSearchInput');
    if (searchInput) {
      let searchTimer;
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          // 同一顶部搜索框
          const topSearchInput = document.getElementById('documentsSearchInput');
          if (topSearchInput) topSearchInput.value = searchInput.value;
          this._filterAssets();
        }, 300);
      });
    }

    // 文件选择
    if (fileInput) {
      fileInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (files && files.length > 0) {
          await this._importDroppedFiles(files);
        }
        fileInput.value = '';
      });
    }

    // 绑定按钮和资产操作（事件委托）
    const container = document.getElementById('knowledgeBaseContent');
    if (container) {
      container.addEventListener('click', (e) => {
        const target = e.target;

        if (target.id === 'mmAddUrlBtn' || target.closest('#mmAddUrlBtn')) {
          e.preventDefault(); e.stopPropagation();
          this._showAddUrlDialog();
          return;
        }
        if (target.id === 'mmAddMeetingBtn' || target.closest('#mmAddMeetingBtn')) {
          e.preventDefault(); e.stopPropagation();
          this._showAddMeetingDialog();
          return;
        }
        if (target.id === 'mmGenBookBtn' || target.closest('#mmGenBookBtn')) {
          e.preventDefault(); e.stopPropagation();
          this._generateBook();
          return;
        }

        const mmTypeTab = target.closest('.mm-type-tab');
        if (mmTypeTab) {
          e.preventDefault();
          document.querySelectorAll('.mm-type-tab').forEach(t => t.classList.remove('active'));
          mmTypeTab.classList.add('active');
          this.data.multimodalFilter = mmTypeTab.dataset.mmType;
          this._filterAssets();
          return;
        }

        const bookViewBtn = target.closest('.mm-book-view-btn');
        if (bookViewBtn) { e.preventDefault(); this._viewBook(bookViewBtn.dataset.bookId); return; }

        const bookCard = target.closest('.mm-book-card');
        if (bookCard && !target.closest('.mm-book-view-btn')) { this._viewBook(bookCard.dataset.bookId); return; }

        // 多选模式：点击资产卡片切换选中
        const assetCard = target.closest('.mm-asset-card');
        if (assetCard && !target.closest('.mm-asset-action') && !target.closest('.doc-card-checkbox') && Documents._selectMode) {
          e.preventDefault();
          // 从 assetId 获取卡片信息
          const assetId = assetCard.querySelector('.mm-asset-action[data-asset-id]')?.dataset.assetId;
          const title = assetCard.querySelector('.mm-asset-title')?.textContent || '';
          Documents._toggleKBAssetSelection(assetCard, assetId, title);
          return;
        }

        const assetAction = target.closest('.mm-asset-action');
        if (assetAction) {
          e.preventDefault();
          const action = assetAction.dataset.action;
          const assetId = assetAction.dataset.assetId;
          switch (action) {
            case 'open': this._openAssetFile(assetId); break;
            case 'visit': this._openUrl(assetAction.dataset.url); break;
            case 'process': this._processAsset(assetId); break;
            case 'delete': this._deleteAsset(assetId); break;
          }
          return;
        }

        // 重试按钮
        if (target.closest('[data-retry]')) {
          const retryFn = target.closest('[data-retry]').dataset.retry;
          if (retryFn && typeof this[retryFn] === 'function') this[retryFn]();
          return;
        }
      });

      // 拖拽事件
      this._bindDragDrop(container);
    }
  },

  _renderBooks(books) {
    if (!books || books.length === 0) {
      return '<div class="insight-empty" style="padding:20px"><div class="insight-empty-icon" style="font-size:24px">📖</div><div class="insight-empty-desc" style="font-size:12px">暂无知识书本</div></div>';
    }
    return `<div class="mm-books-list">${books.map(b => `
      <div class="mm-book-card" data-book-id="${this._escapeAttr(b.id)}">
        <div class="mm-book-icon">📖</div>
        <div class="mm-book-info">
          <div class="mm-book-title">${this._escapeHtml(b.title || '未命名')}</div>
          <div class="mm-book-meta">${(b.chapters || []).length} 章 · ${this._formatTimeAgo(b.created_at)}</div>
        </div>
        <button class="mm-book-view-btn" data-book-id="${this._escapeAttr(b.id)}">查看</button>
      </div>`).join('')}</div>`;
  },

  _renderAssets(assets) {
    if (!assets || assets.length === 0) {
      return '<div class="insight-empty" style="padding:30px"><div class="insight-empty-icon">📦</div><div class="insight-empty-desc">暂无知识资产</div></div>';
    }
    return assets.map(a => this._renderAssetCard(a)).join('');
  },

  _renderAssetCard(asset) {
    const typeIcons = { image: '🖼', document: '📄', audio: '🎵', video: '🎬', url: '🔗', meeting: '📹' };
    const typeLabels = { image: '图片', document: '文档', audio: '音频', video: '视频', url: 'URL', meeting: '会议' };
    const icon = typeIcons[asset.type] || '📄';
    const label = typeLabels[asset.type] || asset.type;
    const isProcessed = asset.title && asset.title !== asset.original_name;
    const sizeStr = asset.file_size ? this._formatFileSize(asset.file_size) : '';

    return `
      <div class="mm-asset-card">
        <div class="mm-asset-header">
          <span class="mm-asset-icon">${icon}</span>
          <span class="mm-asset-type-badge">${label}</span>
          <span class="mm-asset-status ${isProcessed ? 'processed' : ''}"></span>
        </div>
        <div class="mm-asset-title">${this._escapeHtml(asset.title || asset.original_name || '未命名')}</div>
        ${asset.description ? `<div class="mm-asset-desc">${this._escapeHtml(asset.description)}</div>` : ''}
        <div class="mm-asset-footer">
          ${sizeStr ? `<span class="mm-asset-meta">${sizeStr}</span>` : ''}
          <span class="mm-asset-meta">${this._formatTimeAgo(asset.created_at)}</span>
        </div>
        ${asset.tags && asset.tags.length > 0 ? `<div class="mm-asset-tags">${asset.tags.map(t => `<span class="mm-asset-tag">${this._escapeHtml(t)}</span>`).join('')}</div>` : ''}
        <div class="mm-asset-actions">
          ${asset.type === 'url' ? `<button class="mm-asset-action" data-action="visit" data-url="${this._escapeAttr(asset.url || '')}">🔗 访问</button>` : `<button class="mm-asset-action" data-action="open" data-asset-id="${this._escapeAttr(asset.id)}">📂 打开</button>`}
          <button class="mm-asset-action" data-action="process" data-asset-id="${this._escapeAttr(asset.id)}">🤖 AI处理</button>
          <button class="mm-asset-action danger" data-action="delete" data-asset-id="${this._escapeAttr(asset.id)}">🗑 删除</button>
        </div>
      </div>`;
  },

  async _filterAssets() {
    const keyword = document.getElementById('mmSearchInput')?.value || '';
    try {
      const result = await this._safeCall(
        () => window.electronAPI?.multimodalList?.({ type: this.data.multimodalFilter, page: 1, pageSize: 50, keyword }),
        { assets: [], total: 0 }
      );
      this.data.multimodalAssets = result.assets || [];
      const grid = document.getElementById('mmAssetsGrid');
      if (grid) {
        grid.innerHTML = this._renderAssets(this.data.multimodalAssets);
        // 多选模式注入复选框
        if (Documents._selectMode) {
          grid.querySelectorAll('.mm-asset-card').forEach(card => {
            if (card.querySelector('.doc-card-checkbox')) return;
            const checkbox = document.createElement('div');
            checkbox.className = 'doc-card-checkbox';
            checkbox.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="2" y="2" width="20" height="20" rx="6" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
            card.style.position = 'relative';
            card.insertBefore(checkbox, card.firstChild);
          });
        }
      }
    } catch (err) {
      console.error('[KnowledgeBase] Filter error:', err);
    }
  },

  async _importFiles() {
    try {
      const result = await window.electronAPI?.multimodalPickFiles?.();
      if (!result || !result.filePaths || result.filePaths.length === 0) return;

      let successCount = 0;
      let failCount = 0;
      for (const filePath of result.filePaths) {
        try {
          await window.electronAPI.multimodalImport({ filePath });
          successCount++;
        } catch (err) {
          console.error('[KnowledgeBase] Import error:', err);
          failCount++;
        }
      }
      if (successCount > 0) {
        this._showToast(`成功导入 ${successCount} 个文件`, 'success');
        this.loadMultimodal();
      }
      if (failCount > 0) {
        this._showToast(`导入失败 ${failCount} 个文件`, 'error');
      }
    } catch (err) {
      this._showToast('导入失败：' + err.message, 'error');
    }
  },

  async _importDroppedFiles(fileList) {
    const results = { success: 0, failed: 0 };
    const container = document.getElementById('knowledgeBaseContent');
    const progressEl = document.createElement('div');
    progressEl.className = 'mm-import-progress';
    progressEl.innerHTML = `<div class="insight-loading"><div class="spinner"></div><span>正在导入 ${fileList.length} 个文件...</span></div>`;
    container?.appendChild(progressEl);

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      try {
        const buffer = await file.arrayBuffer();
        await window.electronAPI?.multimodalImportBuffer?.({
          name: file.name,
          type: file.type,
          size: file.size,
          buffer: new Uint8Array(buffer)
        });
        results.success++;
      } catch (err) {
        console.error('[KnowledgeBase] Import buffer error:', err);
        results.failed++;
      }
    }
    progressEl.remove();

    if (results.success > 0) {
      this._showToast(`导入完成：${results.success} 成功`, 'success');
      this.loadMultimodal();
    }
    if (results.failed > 0) {
      this._showToast(`导入失败 ${results.failed} 个文件`, 'error');
    }
  },

  _showAddUrlDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'mm-dialog-overlay';
    overlay.innerHTML = `
      <div class="mm-dialog">
        <div class="mm-dialog-header"><h3>🔗 保存 URL</h3><button class="mm-dialog-close" data-close="mmUrlDialog">✕</button></div>
        <div class="mm-dialog-body">
          <div class="mm-dialog-field"><label>URL</label><input type="url" id="mmUrlInput" placeholder="https://..."></div>
          <div class="mm-dialog-field"><label>标题（可选）</label><input type="text" id="mmUrlTitleInput" placeholder="页面标题"></div>
        </div>
        <div class="mm-dialog-footer">
          <button class="mm-dialog-btn cancel" data-close="mmUrlDialog">取消</button>
          <button class="mm-dialog-btn confirm" id="mmUrlConfirmBtn">保存</button>
        </div>
      </div>`;
    overlay.id = 'mmUrlDialog';
    document.body.appendChild(overlay);

    overlay.querySelector('.mm-dialog-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#mmUrlConfirmBtn').addEventListener('click', async () => {
      const url = document.getElementById('mmUrlInput')?.value?.trim();
      const title = document.getElementById('mmUrlTitleInput')?.value?.trim();
      if (!url) { alert('请输入 URL'); return; }
      try {
        const result = await window.electronAPI?.multimodalSaveUrl?.({ url, title });
        if (result?.ok || result?.success) {
          this._showToast('URL 已保存', 'success');
          overlay.remove();
          this.loadMultimodal();
        } else {
          this._showToast(result?.error || '保存失败', 'error');
        }
      } catch (err) {
        this._showToast('保存URL失败：' + err.message, 'error');
      }
    });
    document.getElementById('mmUrlInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('mmUrlConfirmBtn')?.click();
    });
  },

  _showAddMeetingDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'mm-dialog-overlay';
    overlay.innerHTML = `
      <div class="mm-dialog">
        <div class="mm-dialog-header"><h3>📹 会议记录</h3><button class="mm-dialog-close" data-close="mmMeetingDialog">✕</button></div>
        <div class="mm-dialog-body">
          <div class="mm-dialog-field"><label>会议标题</label><input type="text" id="mmMeetingTitleInput" placeholder="例：周会 2026-06-16"></div>
          <div class="mm-dialog-field"><label>转译文本</label><textarea id="mmMeetingTranscriptInput" rows="6" placeholder="粘贴会议转译文本..."></textarea></div>
        </div>
        <div class="mm-dialog-footer">
          <button class="mm-dialog-btn cancel" data-close="mmMeetingDialog">取消</button>
          <button class="mm-dialog-btn confirm" id="mmMeetingConfirmBtn">保存</button>
        </div>
      </div>`;
    overlay.id = 'mmMeetingDialog';
    document.body.appendChild(overlay);

    overlay.querySelector('.mm-dialog-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#mmMeetingConfirmBtn').addEventListener('click', async () => {
      const title = document.getElementById('mmMeetingTitleInput')?.value?.trim();
      const transcript = document.getElementById('mmMeetingTranscriptInput')?.value?.trim();
      if (!title) { alert('请输入会议标题'); return; }
      try {
        const result = await window.electronAPI?.multimodalSaveMeeting?.({ title, transcript });
        if (result?.ok || result?.success) {
          this._showToast('会议记录已保存', 'success');
          overlay.remove();
          this.loadMultimodal();
        } else {
          this._showToast(result?.error || '保存失败', 'error');
        }
      } catch (err) {
        this._showToast('保存会议记录失败：' + err.message, 'error');
      }
    });
  },

  async _generateBook() {
    this._showToast('AI 正在生成知识体系...', 'info');
    try {
      const result = await window.electronAPI?.multimodalGenerateBook?.({});
      if (result?.ok || result?.success) {
        this._showToast('知识体系已生成', 'success');
        this.loadMultimodal();
      } else {
        const errMsg = result?.error || '生成失败';
        if (errMsg.includes('登录')) {
          this._showToast('请先登录再使用 AI 功能', 'warning');
        } else {
          this._showToast(errMsg, 'error');
        }
      }
    } catch (err) {
      this._showToast('生成失败：' + err.message, 'error');
    }
  },

  async _viewBook(bookId) {
    try {
      const result = await window.electronAPI?.multimodalGetBooks?.();
      const book = (result?.books || []).find(b => b.id === bookId);
      if (!book) { this._showToast('书本不存在', 'error'); return; }

      const overlay = document.createElement('div');
      overlay.className = 'mm-book-overlay';
      overlay.innerHTML = `
        <div class="mm-book-modal">
          <div class="mm-book-modal-header">
            <h2>📖 ${this._escapeHtml(book.title || '未命名')}</h2>
            <button class="mm-book-modal-close" id="mmBookModalCloseBtn">✕</button>
          </div>
          <div class="mm-book-modal-body">
            ${(book.chapters || []).map(ch => `
              <div class="mm-book-chapter">
                <div class="mm-book-ch-title">${this._escapeHtml(ch.title || '未命名章节')}</div>
                ${ch.summary ? `<div class="mm-book-ch-summary">${this._escapeHtml(ch.summary)}</div>` : ''}
                ${(ch.sections || []).map(sec => `
                  <div class="mm-book-section">
                    <h4>${this._escapeHtml(sec.title || '')}</h4>
                    <p>${this._escapeHtml(sec.content || '')}</p>
                  </div>`).join('')}
              </div>`).join('')}
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#mmBookModalCloseBtn').addEventListener('click', () => overlay.remove());
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    } catch (err) {
      this._showToast('查看书本失败：' + err.message, 'error');
    }
  },

  async _openAssetFile(id) {
    try {
      await window.electronAPI?.multimodalOpenFile?.(id);
    } catch (err) {
      this._showToast('打开文件失败：' + err.message, 'error');
    }
  },

  _openUrl(url) {
    if (url) window.electronAPI?.openExternal?.(url);
  },

  async _processAsset(id) {
    this._showToast('AI 正在处理资产...', 'info');
    try {
      const result = await window.electronAPI?.multimodalProcess?.(id);
      if (result?.ok || result?.success) {
        this._showToast('处理完成', 'success');
        this.loadMultimodal();
      } else {
        this._showToast(result?.error || '处理失败', 'error');
      }
    } catch (err) {
      this._showToast('处理失败：' + err.message, 'error');
    }
  },

  async _deleteAsset(id) {
    const ok = await this._customConfirm('确定删除此资产？文件将一并删除。');
    if (!ok) return;
    try {
      await window.electronAPI?.multimodalDelete?.(id);
      this._showToast('资产已删除', 'success');
      this.loadMultimodal();
    } catch (err) {
      this._showToast('删除失败：' + err.message, 'error');
    }
  },

  // 自定义确认弹窗（适配暗色模式）
  _customConfirm(message) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:99999;';
      overlay.innerHTML = `
        <div style="background:var(--bg-elevated,#fff);border-radius:16px;padding:24px;max-width:400px;width:90%;box-shadow:0 24px 48px rgba(0,0,0,0.2);">
          <div style="font-size:15px;line-height:1.6;color:var(--text-primary,#1d1d1f);margin-bottom:20px;">${this._escapeHtml(message)}</div>
          <div style="display:flex;justify-content:flex-end;gap:8px;">
            <button class="cc-cancel" style="padding:8px 18px;border-radius:8px;border:1px solid var(--border-light,#d2d2d7);background:var(--bg-elevated,#fff);color:var(--text-primary,#1d1d1f);cursor:pointer;font-size:14px;">取消</button>
            <button class="cc-ok" style="padding:8px 18px;border-radius:8px;border:none;background:#FF3B30;color:#fff;cursor:pointer;font-size:14px;">确认删除</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const cleanup = (val) => { overlay.remove(); resolve(val); };
      // 使用 addEventListener 而非 onclick，避免事件冲突
      overlay.querySelector('.cc-ok').addEventListener('click', (e) => { e.stopPropagation(); cleanup(true); });
      overlay.querySelector('.cc-cancel').addEventListener('click', (e) => { e.stopPropagation(); cleanup(false); });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    });
  },

  _showToast(message, type = 'info') {
    let toast = document.getElementById('kbToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'kbToast';
      toast.className = 'mm-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `mm-toast ${type}`;
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  },

  /** 拖拽导入功能 */
  _bindDragDrop(container) {
    let dragCounter = 0;

    container.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      this._showDropZone();
    });

    container.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) { dragCounter = 0; this._hideDropZone(); }
    });

    container.addEventListener('dragover', (e) => { e.preventDefault(); });

    container.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      this._hideDropZone();

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      await this._importDroppedFiles(files);
    });
  },

  _showDropZone() {
    const dropHint = document.getElementById('mmDropHint');
    if (dropHint) dropHint.classList.add('drag-over');

    let dropZone = document.getElementById('mmDropZone');
    if (!dropZone) {
      dropZone = document.createElement('div');
      dropZone.id = 'mmDropZone';
      dropZone.className = 'mm-drop-zone';
      dropZone.innerHTML = `
        <div class="mm-drop-zone-inner">
          <div class="mm-drop-zone-icon">📥</div>
          <div class="mm-drop-zone-text">释放文件以导入知识库</div>
          <div class="mm-drop-zone-hint">支持图片、文档、音视频等文件</div>
        </div>`;
      const container = document.getElementById('knowledgeBaseContainer');
      if (container) container.appendChild(dropZone);
    }
    dropZone.classList.add('active');
  },

  _hideDropZone() {
    const dropZone = document.getElementById('mmDropZone');
    if (dropZone) dropZone.classList.remove('active');
    const dropHint = document.getElementById('mmDropHint');
    if (dropHint) dropHint.classList.remove('drag-over');
  },

  _formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    try {
      const diff = Date.now() - new Date(dateStr).getTime();
      if (diff < 0) return '';
      const minutes = Math.floor(diff / 60000);
      if (minutes < 1) return '刚刚';
      if (minutes < 60) return minutes + '分钟前';
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return hours + '小时前';
      const days = Math.floor(hours / 24);
      if (days < 30) return days + '天前';
      return new Date(dateStr).toLocaleDateString('zh-CN');
    } catch { return dateStr; }
  },

  _formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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

window.KnowledgeBase = KnowledgeBase;
