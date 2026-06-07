/**
 * GraphView - 全局图谱视图控制器
 * 负责：Tab 切换、数据加载、筛选搜索、ADP 调用编排
 */

class GraphView {
  constructor() {
    this.forceLayout = null;
    this.graphData = null;
    this.healthReport = null;
    this.isLoading = false;
    this.filterType = 'all';
    this.initialized = false;
    // 知识漫游状态
    this._roaming = false;
    this._roamingPaused = false;
    this._roamingIndex = 0;
    this._roamingNodes = [];
    this._roamingTimer = null;
    this._isRoamingClick = false;
  }

  init() {
    this._bindEvents();
    this.initialized = true;
    console.log('[GraphView] Initialized');
  }

  async onShow() {
    if (!this.forceLayout) {
      const canvas = document.getElementById('graphCanvas');
      if (canvas) {
        this.forceLayout = new window.ForceLayout(canvas);
        this.forceLayout.onNodeClick = (node) => this._handleNodeClick(node);
        this.forceLayout.onNodeDblClick = (node) => this._handleNodeDblClick(node);
        this.forceLayout.onZoomChange = (scale) => this._syncZoomUI(scale);
      }
    }

    // 绑定缩放控件（只绑一次）
    this._bindZoomControls();

    // 检查构建限制
    await this._updateBuildLimitUI();

    // 先查本地缓存，有数据则直接展示
    const stats = await window.electronAPI?.graphStats();
    if (stats?.nodeCount > 0) {
      await this._loadFromDB();
      // 数据加载完成后，默认启动知识漫游
      setTimeout(() => this.startRoaming(), 1500);
    } else {
      const emptyEl = document.getElementById('graphEmptyState');
      if (emptyEl) emptyEl.classList.remove('hidden');
    }
  }

  async _updateBuildLimitUI() {
    try {
      const limit = await window.electronAPI?.graphBuildLimit();
      const btn = document.getElementById('graphRefreshBtn');
      if (!btn) return;

      if (limit && !limit.allowed) {
        btn.textContent = '🔄 已达今日上限';
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.pointerEvents = 'none';
      } else {
        btn.textContent = '🔄 重建';
        btn.disabled = false;
        btn.style.opacity = '';
        btn.style.pointerEvents = '';
      }
    } catch (e) {}
  }

  onHide() {
    this.stopRoaming();
    if (this.forceLayout) {
      this.forceLayout.destroy();
      this.forceLayout = null;
    }
  }

  _bindEvents() {
    const container = document.getElementById('globalGraphView');
    if (!container || container._gvBound) return;
    container._gvBound = true;

    container.addEventListener('click', e => {
      const target = e.target;

      // 一键布局按钮
      if (target.closest('#graphRelayoutBtn')) {
        if (this.forceLayout) {
          this.forceLayout.reLayout();
        }
        return;
      }

      // 聚拢按钮
      if (target.closest('#graphGatherBtn')) {
        if (this.forceLayout) {
          this.forceLayout.gather();
        }
        return;
      }

      // 扩散按钮
      if (target.closest('#graphScatterBtn')) {
        if (this.forceLayout) {
          this.forceLayout.scatter();
        }
        return;
      }

      // 漫游按钮
      if (target.closest('#graphRoamingBtn')) {
        if (this._roaming) {
          this.stopRoaming();
        } else {
          this.startRoaming();
        }
        return;
      }

      // 漫游控制：暂停/继续
      if (target.closest('#roamingPlayPause')) {
        if (this._roamingPaused) {
          this.resumeRoaming();
        } else {
          this.pauseRoaming();
        }
        return;
      }

      // 漫游控制：上一个
      if (target.closest('#roamingPrev')) {
        this.prevRoamingNode();
        return;
      }

      // 漫游控制：下一个
      if (target.closest('#roamingNext')) {
        this.nextRoamingNode();
        return;
      }

      // 漫游控制：关闭
      if (target.closest('#roamingClose')) {
        this.stopRoaming();
        return;
      }

      // 刷新按钮
      if (target.closest('#graphRefreshBtn') || target.closest('#graphRefreshBtn2')) {
        this._confirmRebuild();
        return;
      }

      // 重新体检按钮
      if (target.closest('#graphRecheckBtn')) {
        this._confirmRebuild();
        return;
      }

      // 筛选按钮
      const filterBtn = target.closest('[data-graph-filter]');
      if (filterBtn) {
        this.filterType = filterBtn.dataset.graphFilter;
        container.querySelectorAll('[data-graph-filter]').forEach(b => b.classList.remove('active'));
        filterBtn.classList.add('active');
        if (this.forceLayout) this.forceLayout.filter(this.filterType);
        this._updateStatsBar();
        // 如果正在漫游，更新漫游节点列表
        if (this._roaming) {
          this._updateRoamingNodeList();
        }
        return;
      }

      // 面板内操作
      const action = target.closest('[data-gp-action]');
      if (action) {
        const act = action.dataset.gpAction;
        const id = action.dataset.gpId;
        this._handlePanelAction(act, id);
        return;
      }

      // 关闭面板
      if (target.closest('#graphPanelClose')) {
        this._hidePanel();
        return;
      }
    });

    // 搜索
    const searchInput = document.getElementById('graphSearchInput');
    if (searchInput && !searchInput._gvBound) {
      searchInput._gvBound = true;
      let debounceTimer;
      searchInput.addEventListener('input', e => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (this.forceLayout) this.forceLayout.search(e.target.value);
        }, 200);
      });
    }
  }

  async _confirmRebuild() {
    // 重建图谱耗时较长且消耗 token，弹出确认框
    const confirmed = await this._showConfirmDialog(
      '重建知识图谱',
      '重建图谱需要调用 AI 分析知识库，耗时约 30-60 秒，将消耗较多 Token。每天仅可重建 1 次，确认要重建吗？',
      '确认重建',
      '取消'
    );
    if (confirmed) {
      this.loadGraph(true);
    }
  }

  _showConfirmDialog(title, message, confirmText, cancelText) {
    return new Promise(resolve => {
      // 移除已有弹窗
      const existing = document.getElementById('graphConfirmDialog');
      if (existing) existing.remove();

      const overlay = document.createElement('div');
      overlay.id = 'graphConfirmDialog';
      overlay.className = 'graph-confirm-overlay';
      overlay.innerHTML = `
        <div class="graph-confirm-dialog">
          <h4 class="graph-confirm-title">${title}</h4>
          <p class="graph-confirm-msg">${message}</p>
          <div class="graph-confirm-actions">
            <button class="gg-btn ghost graph-confirm-cancel">${cancelText}</button>
            <button class="gg-btn primary graph-confirm-ok">${confirmText}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.querySelector('.graph-confirm-cancel').onclick = () => {
        overlay.remove();
        resolve(false);
      };
      overlay.querySelector('.graph-confirm-ok').onclick = () => {
        overlay.remove();
        resolve(true);
      };
      overlay.addEventListener('click', e => {
        if (e.target === overlay) {
          overlay.remove();
          resolve(false);
        }
      });
    });
  }

  async loadGraph(forceRefresh = false) {
    if (this.isLoading) return;

    const emptyEl = document.getElementById('graphEmptyState');
    const loadingEl = document.getElementById('graphLoading');

    try {
      // 非强制刷新：先查本地缓存
      if (!forceRefresh) {
        const stats = await window.electronAPI?.graphStats();
        if (stats?.nodeCount > 0) {
          await this._loadFromDB();
          return;
        }
        // 无数据，显示空状态
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
      }

      // 强制刷新：调用 ADP 构建
      this.isLoading = true;
      this._disableRefreshBtn(true);
      if (emptyEl) emptyEl.classList.add('hidden');
      if (loadingEl) loadingEl.classList.remove('hidden');

      // 分步进度提示
      this._updateLoadingStep('step1');

      console.log('[GraphView] Calling graphBuild IPC...');
      const result = await window.electronAPI?.graphBuild({ forceRefresh: true });
      console.log('[GraphView] graphBuild IPC returned:', JSON.stringify(result?.stats || {}, null, 2), 'error:', result?.error);

      if (loadingEl) loadingEl.classList.add('hidden');
      this.isLoading = false;
      this._clearLoadingTimers();
      this._disableRefreshBtn(false);
      this._updateBuildLimitUI(); // 刷新限制状态

      if (result?.stats?.nodeCount > 0) {
        console.log('[GraphView] Loading from DB...');
        await this._loadFromDB();
      } else if (result?.error) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        this._showEmptyWithMessage(result.error);
      } else {
        if (emptyEl) emptyEl.classList.remove('hidden');
        this._showEmptyWithMessage('暂无图谱数据，请先积累更多知识');
      }
    } catch (e) {
      this.isLoading = false;
      this._clearLoadingTimers();
      this._disableRefreshBtn(false);
      if (loadingEl) loadingEl.classList.add('hidden');
      if (emptyEl) emptyEl.classList.remove('hidden');
      console.error('[GraphView] loadGraph error:', e);
      this._showEmptyWithMessage('加载出错：' + e.message);
    }
  }

  _disableRefreshBtn(disabled) {
    const btn1 = document.getElementById('graphRefreshBtn');
    const btn2 = document.getElementById('graphRefreshBtn2');
    [btn1, btn2].forEach(btn => {
      if (!btn) return;
      btn.disabled = disabled;
      btn.style.opacity = disabled ? '0.5' : '';
      btn.style.pointerEvents = disabled ? 'none' : '';
    });
  }

  _updateLoadingStep(step) {
    const titleEl = document.querySelector('#graphLoading .gl-title');
    const descEl = document.querySelector('#graphLoading .gl-desc');
    const steps = {
      step1: { title: '🗺 正在分析知识体系', desc: 'AI 正在读取你的知识库，分析知识结构...' },
      step2: { title: '🗺 正在构建图谱', desc: '正在识别领域、知识簇和关系网络...' },
      step3: { title: '🗺 正在知识体检', desc: '正在检测缺口、冲突、过时和重复知识...' },
    };
    const s = steps[step] || steps.step1;
    if (titleEl) titleEl.textContent = s.title;
    if (descEl) descEl.textContent = s.desc;

    // 自动推进步骤（模拟进度）
    if (step === 'step1') {
      this._loadingTimer1 = setTimeout(() => this._updateLoadingStep('step2'), 3000);
      this._loadingTimer2 = setTimeout(() => this._updateLoadingStep('step3'), 8000);
    }
  }

  _clearLoadingTimers() {
    clearTimeout(this._loadingTimer1);
    clearTimeout(this._loadingTimer2);
  }

  async _loadFromDB() {
    const emptyEl = document.getElementById('graphEmptyState');
    const loadingEl = document.getElementById('graphLoading');
    if (emptyEl) emptyEl.classList.add('hidden');
    if (loadingEl) loadingEl.classList.add('hidden');

    try {
      // 从 SQLite 加载
      const nodesResult = await window.electronAPI?.graphGetNodes({});
      const edgesResult = await window.electronAPI?.graphGetEdges({});
      const statsResult = await window.electronAPI?.graphStats();
      const reportResult = await window.electronAPI?.graphHealthReport();

      this.graphData = {
        nodes: nodesResult?.nodes || [],
        edges: edgesResult?.edges || []
      };
      this.healthReport = reportResult?.report || null;

      console.log('[GraphView] Loaded from DB: nodes=' + this.graphData.nodes.length + ' edges=' + this.graphData.edges.length);

      if (this.forceLayout && this.graphData.nodes.length > 0) {
        // 确保 canvas 尺寸正确
        this.forceLayout._resize();
        this.forceLayout.setData(this.graphData);
      } else if (this.graphData.nodes.length === 0) {
        // 数据库为空，显示空状态
        if (emptyEl) emptyEl.classList.remove('hidden');
      }

      this._updateStatsBar(statsResult);
      this._updateHealthBar();
      this._updateBuiltAt();
    } catch (e) {
      console.error('[GraphView] _loadFromDB error:', e);
    }
  }

  async _updateStatsBar(stats) {
    if (!stats) {
      try { stats = await window.electronAPI?.graphStats(); } catch (e) { return; }
    }
    const el = document.getElementById('graphStatsBar');
    if (!el) return;
    const d = stats.densityDist || stats.densityDist || {};
    el.innerHTML = `
      <span class="gs-stat"><span class="gs-stat-num">${stats.nodeCount || 0}</span> 节点</span>
      <span class="gs-dot">·</span>
      <span class="gs-stat"><span class="gs-stat-num">${stats.edgeCount || 0}</span> 关系</span>
      <span class="gs-dot">·</span>
      <span class="gs-stat gs-rich">🟢 ${d.rich || 0}</span>
      <span class="gs-stat gs-moderate">🔵 ${d.moderate || 0}</span>
      <span class="gs-stat gs-sparse">🟠 ${d.sparse || 0}</span>
      <span class="gs-stat gs-gap">🔴 ${d.gap || 0}</span>
    `;
  }

  _updateHealthBar() {
    const el = document.getElementById('graphHealthBar');
    if (!el || !this.healthReport) return;
    const report = this.healthReport;
    const summary = report.summary || {};
    const gaps = report.gaps || [];
    const outdated = report.outdated || [];
    const conflicts = report.conflicts || [];
    const duplicates = report.duplicates || [];

    const score = summary.knowledgeScore || 0;
    const unhealthyCount = (outdated.length + conflicts.length + duplicates.length);

    el.innerHTML = `
      <div class="gh-score">
        <span class="gh-score-label">健康评分</span>
        <span class="gh-score-num">${score}</span>
      </div>
      ${unhealthyCount > 0 ? `
        <div class="gh-issues">
          ${conflicts.length > 0 ? `<span class="gh-issue conflict">⚡${conflicts.length} 冲突</span>` : ''}
          ${outdated.length > 0 ? `<span class="gh-issue outdated">⚠️${outdated.length} 过时</span>` : ''}
          ${duplicates.length > 0 ? `<span class="gh-issue duplicate">🔄${duplicates.length} 重复</span>` : ''}
          ${gaps.length > 0 ? `<span class="gh-issue gap">🔴${gaps.length} 缺口</span>` : ''}
        </div>
      ` : '<span class="gh-healthy">✅ 知识库健康</span>'}
    `;
  }

  _updateBuiltAt() {
    const el = document.getElementById('graphBuiltAt');
    if (!el) return;
    window.electronAPI?.graphStats().then(stats => {
      if (stats?.builtAt) {
        const d = new Date(stats.builtAt);
        const diff = Date.now() - d.getTime();
        const mins = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        el.textContent = mins < 1 ? '刚刚' : mins < 60 ? `${mins}分钟前` : `${hours}小时前`;
      }
    }).catch(() => {});
  }

  _handleNodeClick(node) {
    // 如果正在漫游且未暂停，且不是漫游自动触发的点击，则暂停漫游
    if (this._roaming && !this._roamingPaused && !this._isRoamingClick) {
      this.pauseRoaming();
    }

    if (node.density === 'gap') {
      this._showGapPanel(node);
    } else if (node.health === 'conflicting') {
      this._showConflictPanel(node);
    } else if (node.health === 'outdated') {
      this._showOutdatedPanel(node);
    } else {
      this._showDetailPanel(node);
    }

    // 高亮关联节点
    if (this.forceLayout) {
      this.forceLayout.selectedNode = node;
      this.forceLayout.highlight(node.id);
    }
  }

  _handleNodeDblClick(node) {
    if (node.type === 'domain' && this.forceLayout) {
      // 双击领域节点：高亮子图
      this.forceLayout.highlight(node.id);
    }
  }

  _showDetailPanel(node) {
    const panel = document.getElementById('graphDetailPanel');
    const content = document.getElementById('graphPanelContent');
    if (!panel || !content) return;

    const densityLabel = { rich: '🟢 充足', moderate: '🔵 适中', sparse: '🟠 稀疏', gap: '🔴 缺口' };
    const healthLabel = { healthy: '✅ 健康', outdated: '⚠️ 过时', conflicting: '⚡ 冲突', duplicate: '🔄 重复', orphaned: '🏚 孤立', incomplete: '📝 不完整' };
    const typeLabel = { domain: '领域', cluster: '知识簇', atom: '知识原子', person: '人物', question: '问题', gap: '缺口' };

    content.innerHTML = `
      <div class="gp-header">
        <div class="gp-title-row">
          <span class="gp-type-badge" style="background:${this._nodeColorCSS(node)}20;color:${this._nodeColorCSS(node)}">${typeLabel[node.type] || node.type}</span>
          <h3 class="gp-title">${this._esc(node.label)}</h3>
        </div>
        <div class="gp-meta-row">
          <span class="gp-density">${densityLabel[node.density] || node.density}</span>
          ${node.health !== 'healthy' ? `<span class="gp-health">${healthLabel[node.health] || node.health}</span>` : ''}
          ${node.domain ? `<span class="gp-domain">${this._esc(node.domain)}</span>` : ''}
        </div>
      </div>

      ${node.summary ? `
        <div class="gp-section">
          <h4>摘要</h4>
          <p class="gp-summary">${this._esc(node.summary)}</p>
        </div>
      ` : ''}

      ${node.stats ? `
        <div class="gp-section">
          <h4>统计</h4>
          <div class="gp-stats-grid">
            ${Object.entries(node.stats).filter(([_, v]) => v !== undefined && v !== null).map(([k, v]) => `
              <div class="gp-stat-item">
                <span class="gp-stat-val">${v}</span>
                <span class="gp-stat-key">${k}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${node.health_detail ? `
        <div class="gp-section gp-health-detail">
          <h4>健康详情</h4>
          <p>${this._esc(node.health_detail.reason || node.health_detail.suggestion || '')}</p>
          ${node.health_detail.suggestion ? `<p class="gp-suggestion">💡 ${this._esc(node.health_detail.suggestion)}</p>` : ''}
        </div>
      ` : ''}
    `;

    panel.classList.remove('hidden');
  }

  _showGapPanel(node) {
    const panel = document.getElementById('graphDetailPanel');
    const content = document.getElementById('graphPanelContent');
    if (!panel || !content) return;

    const detail = node.health_detail || node.extra || {};
    content.innerHTML = `
      <div class="gp-header gp-gap-header">
        <div class="gp-title-row">
          <span class="gp-type-badge gap-badge">🔴 缺口</span>
          <h3 class="gp-title">${this._esc(node.label)}</h3>
        </div>
        <p class="gp-gap-reason">${this._esc(detail.reason || node.summary || '此领域知识不足')}</p>
      </div>

      <div class="gp-section">
        <h4>🎯 建议操作</h4>
        <div class="gp-actions-list">
          <button class="gp-action-card" data-gp-action="search" data-gp-id="${node.id}">
            <span class="gp-action-icon">🔍</span>
            <div class="gp-action-text">
              <span class="gp-action-title">搜索相关知识</span>
              <span class="gp-action-desc">在知识库中搜索"${this._esc(node.label)}"</span>
            </div>
          </button>
          <button class="gp-action-card" data-gp-action="ask_adp" data-gp-id="${node.id}">
            <span class="gp-action-icon">💬</span>
            <div class="gp-action-text">
              <span class="gp-action-title">请教 AI</span>
              <span class="gp-action-desc">让 AI 帮你了解"${this._esc(node.label)}"</span>
            </div>
          </button>
          <button class="gp-action-card" data-gp-action="record" data-gp-id="${node.id}">
            <span class="gp-action-icon">✏️</span>
            <div class="gp-action-text">
              <span class="gp-action-title">记录你的经验</span>
              <span class="gp-action-desc">打开记事本记录相关知识</span>
            </div>
          </button>
        </div>
      </div>

      ${detail.suggestion ? `
        <div class="gp-section">
          <p class="gp-suggestion">💡 ${this._esc(detail.suggestion)}</p>
        </div>
      ` : ''}
    `;

    panel.classList.remove('hidden');
  }

  _showConflictPanel(node) {
    const panel = document.getElementById('graphDetailPanel');
    const content = document.getElementById('graphPanelContent');
    if (!panel || !content) return;

    const detail = node.health_detail || {};
    content.innerHTML = `
      <div class="gp-header gp-conflict-header">
        <div class="gp-title-row">
          <span class="gp-type-badge conflict-badge">⚡ 冲突</span>
          <h3 class="gp-title">${this._esc(node.label)}</h3>
        </div>
        <p class="gp-conflict-reason">${this._esc(detail.reason || '存在矛盾的知识')}</p>
      </div>

      <div class="gp-section">
        <h4>🤖 AI 仲裁</h4>
        <button class="gp-action-card" data-gp-action="arbitrate" data-gp-id="${node.id}">
          <span class="gp-action-icon">⚖️</span>
          <div class="gp-action-text">
            <span class="gp-action-title">AI 分析冲突</span>
            <span class="gp-action-desc">让 AI 分析冲突原因并建议解决方案</span>
          </div>
        </button>
      </div>

      <div class="gp-section">
        <h4>手动处理</h4>
        <div class="gp-actions-list">
          <button class="gp-action-card" data-gp-action="merge" data-gp-id="${node.id}">
            <span class="gp-action-icon">🔗</span>
            <div class="gp-action-text">
              <span class="gp-action-title">合并知识</span>
              <span class="gp-action-desc">将冲突的知识整合为一条</span>
            </div>
          </button>
          <button class="gp-action-card" data-gp-action="keep_both" data-gp-id="${node.id}">
            <span class="gp-action-icon">✅</span>
            <div class="gp-action-text">
              <span class="gp-action-title">保留两者</span>
              <span class="gp-action-desc">标记为场景差异，不冲突</span>
            </div>
          </button>
        </div>
      </div>
    `;

    panel.classList.remove('hidden');
  }

  _showOutdatedPanel(node) {
    const panel = document.getElementById('graphDetailPanel');
    const content = document.getElementById('graphPanelContent');
    if (!panel || !content) return;

    const detail = node.health_detail || {};
    content.innerHTML = `
      <div class="gp-header gp-outdated-header">
        <div class="gp-title-row">
          <span class="gp-type-badge outdated-badge">⚠️ 过时</span>
          <h3 class="gp-title">${this._esc(node.label)}</h3>
        </div>
        <p class="gp-outdated-reason">${this._esc(detail.reason || '知识可能已过时')}</p>
      </div>

      <div class="gp-section">
        <h4>操作</h4>
        <div class="gp-actions-list">
          <button class="gp-action-card" data-gp-action="review" data-gp-id="${node.id}">
            <span class="gp-action-icon">📝</span>
            <div class="gp-action-text">
              <span class="gp-action-title">复审更新</span>
              <span class="gp-action-desc">检查并更新此知识</span>
            </div>
          </button>
          <button class="gp-action-card" data-gp-action="ignore" data-gp-id="${node.id}">
            <span class="gp-action-icon">👌</span>
            <div class="gp-action-text">
              <span class="gp-action-title">仍然有效</span>
              <span class="gp-action-desc">标记为仍然有效</span>
            </div>
          </button>
        </div>
      </div>
    `;

    panel.classList.remove('hidden');
  }

  _hidePanel() {
    const panel = document.getElementById('graphDetailPanel');
    if (panel) panel.classList.add('hidden');
    if (this.forceLayout) this.forceLayout.clearHighlight();
  }

  async _handlePanelAction(action, id) {
    switch (action) {
      case 'build_graph':
        this._confirmRebuild();
        return;
    }

    const node = this.graphData?.nodes?.find(n => n.id === id);
    if (!node) return;

    switch (action) {
      case 'search':
        // 跳转到知识搜索
        if (window.knowledgeDistillation) {
          window.knowledgeDistillation.switchSubview('search');
          const input = document.getElementById('knowledgeSearchInput');
          if (input) input.value = node.label;
          if (window.knowledgeFollow) {
            setTimeout(() => window.knowledgeFollow.handleADPSearch('graph_gap'), 300);
          }
        }
        break;

      case 'ask_adp':
        // 跳转到 AI 助手
        if (window.knowledgeDistillation) {
          window.knowledgeDistillation.switchSubview('search');
          const input = document.getElementById('knowledgeSearchInput');
          if (input) input.value = `请帮我了解"${node.label}"的核心概念和要点`;
          if (window.knowledgeFollow) {
            setTimeout(() => window.knowledgeFollow.handleADPSearch('graph_gap'), 300);
          }
        }
        break;

      case 'record':
        // 跳转到记事本
        const navTabs = document.querySelectorAll('.view-tab');
        navTabs.forEach(tab => {
          if (tab.dataset.view === 'notebook') tab.click();
        });
        break;

      case 'arbitrate':
        // AI 仲裁冲突
        try {
          this._showLoading('AI 正在分析冲突...');
          const result = await window.electronAPI?.graphConflictArbitrate({ conflictId: id });
          this._hideLoading();
          if (result?.resolution) {
            this._showArbitrationResult(result.resolution);
          } else {
            this._toast('仲裁失败，请稍后再试');
          }
        } catch (e) {
          this._hideLoading();
          this._toast('仲裁出错：' + e.message);
        }
        break;

      case 'merge':
      case 'keep_both':
        try {
          await window.electronAPI?.graphConflictResolve({ conflictId: id, action });
          this._toast(action === 'merge' ? '已合并' : '已标记为场景差异');
          this._hidePanel();
          this.loadGraph(false);
        } catch (e) {
          this._toast('操作出错');
        }
        break;

      case 'review':
        // 标记为已复审
        try {
          await window.electronAPI?.graphOutdatedReview({ nodeId: id, action: 'review' });
          this._toast('已标记为已复审');
          this._hidePanel();
          this.loadGraph(false);
        } catch (e) {
          this._toast('操作出错');
        }
        break;

      case 'ignore':
        try {
          await window.electronAPI?.graphOutdatedReview({ nodeId: id, action: 'ignore' });
          this._toast('已标记为仍然有效');
          this._hidePanel();
          this.loadGraph(false);
        } catch (e) {
          this._toast('操作出错');
        }
        break;
    }
  }

  _showArbitrationResult(resolution) {
    const content = document.getElementById('graphPanelContent');
    if (!content) return;
    content.innerHTML = `
      <div class="gp-header">
        <div class="gp-title-row">
          <span class="gp-type-badge">⚖️</span>
          <h3 class="gp-title">AI 仲裁结果</h3>
        </div>
      </div>
      <div class="gp-section">
        <h4>根本原因</h4>
        <p>${this._esc(resolution.root_cause || '')}</p>
      </div>
      ${resolution.viewpoints ? `
        <div class="gp-section">
          <h4>两种观点</h4>
          <div class="gp-viewpoints">
            ${resolution.viewpoints.map(v => `
              <div class="gp-viewpoint">
                <p class="gp-vp-content">${this._esc(v.content || '')}</p>
                <p class="gp-vp-applicable">适用：${this._esc(v.applicable || '')}</p>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      <div class="gp-section">
        <h4>推荐方案</h4>
        <p class="gp-resolution">${this._esc(resolution.resolution?.merged_content || resolution.resolution || '')}</p>
      </div>
      <div class="gp-section">
        <div class="gp-actions-list">
          <button class="gp-action-card" data-gp-action="merge" data-gp-id="${resolution.conflict_id || ''}">
            <span class="gp-action-icon">✅</span>
            <div class="gp-action-text"><span class="gp-action-title">采纳方案</span></div>
          </button>
          <button class="gp-action-card" data-gp-action="keep_both" data-gp-id="${resolution.conflict_id || ''}">
            <span class="gp-action-icon">✌️</span>
            <div class="gp-action-text"><span class="gp-action-title">保留两者</span></div>
          </button>
        </div>
      </div>
    `;
  }

  async _showEmptyWithMessage(msg) {
    const el = document.getElementById('graphEmptyState');
    if (!el) return;
    el.classList.remove('hidden');

    let limitInfo = '';
    try {
      const limit = await window.electronAPI?.graphBuildLimit();
      if (limit) {
        limitInfo = limit.allowed
          ? `今日可构建 ${limit.dailyLimit - limit.usedToday} 次`
          : limit.reason;
      }
    } catch (e) {}

    el.innerHTML = `
      <div class="ge-inner">
        <div class="ge-icon">🗺</div>
        <h3 class="ge-title">知识图谱</h3>
        <p class="ge-desc">${this._esc(msg)}</p>
        <button class="ge-build-btn" data-gp-action="build_graph">🚀 构建图谱</button>
        <p class="ge-cost-hint">⚠️ 构建 AI 图谱需约 30-60 秒，将消耗较多 Token，每天仅可构建 1 次</p>
        ${limitInfo ? `<p class="ge-hint">${this._esc(limitInfo)}</p>` : ''}
      </div>
    `;
  }

  _showLoading(msg) {
    let el = document.getElementById('graphLoadingOverlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'graphLoadingOverlay';
      el.className = 'graph-loading-overlay';
      const container = document.getElementById('globalGraphView');
      if (container) container.appendChild(el);
    }
    el.innerHTML = `
      <div class="glo-inner">
        <div class="glo-spinner"></div>
        <p>${msg || '正在构建图谱...'}</p>
      </div>
    `;
    el.classList.remove('hidden');
  }

  _hideLoading() {
    const el = document.getElementById('graphLoadingOverlay');
    if (el) el.classList.add('hidden');
  }

  _nodeColorCSS(node) {
    const colors = { domain: '#007AFF', cluster: '#5856D6', atom: '#34C759', person: '#AF52DE', question: '#FF9500', gap: '#FF3B30' };
    return colors[node.type] || '#86868b';
  }

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  _toast(msg) {
    const toast = document.createElement('div');
    toast.className = 'kd-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 2500);
  }

  _bindZoomControls() {
    const slider = document.getElementById('graphZoomSlider');
    const zoomIn = document.getElementById('graphZoomIn');
    const zoomOut = document.getElementById('graphZoomOut');
    if (!slider || slider._gvBound) return;
    slider._gvBound = true;

    // 滑块拖动
    slider.addEventListener('input', () => {
      if (!this.forceLayout) return;
      const scale = parseInt(slider.value) / 100;
      this.forceLayout.setZoom(scale);
      this._syncZoomLabel(scale);
    });

    // + 按钮
    zoomIn?.addEventListener('click', () => {
      if (!this.forceLayout) return;
      const newScale = Math.min(5, this.forceLayout.getZoom() * 1.2);
      this.forceLayout.setZoom(newScale);
      this._syncZoomUI(newScale);
    });

    // − 按钮
    zoomOut?.addEventListener('click', () => {
      if (!this.forceLayout) return;
      const newScale = Math.max(0.2, this.forceLayout.getZoom() / 1.2);
      this.forceLayout.setZoom(newScale);
      this._syncZoomUI(newScale);
    });
  }

  _syncZoomUI(scale) {
    const slider = document.getElementById('graphZoomSlider');
    if (slider) {
      slider.value = Math.round(scale * 100);
    }
    this._syncZoomLabel(scale);
  }

  _syncZoomLabel(scale) {
    const label = document.getElementById('graphZoomLabel');
    if (label) {
      label.textContent = Math.round(scale * 100) + '%';
    }
  }

  // ==================== 知识漫游 ====================

  startRoaming() {
    if (!this.graphData?.nodes?.length || !this.forceLayout) return;

    // 如果已在漫游，先停止
    this.stopRoaming();

    // 准备漫游节点列表：优先 domain → cluster → atom → 其他，按权重排序
    const typePriority = { domain: 0, cluster: 1, atom: 2, person: 3, question: 4, gap: 5 };
    this._roamingNodes = this.graphData.nodes
      .filter(n => n.visible !== false)
      .sort((a, b) => {
        const pa = typePriority[a.type] ?? 9;
        const pb = typePriority[b.type] ?? 9;
        if (pa !== pb) return pa - pb;
        return (b.weight || 0) - (a.weight || 0);
      });

    if (this._roamingNodes.length === 0) return;

    this._roaming = true;
    this._roamingPaused = false;
    this._roamingIndex = 0;

    // 显示漫游控件
    this._showRoamingUI();

    // 更新漫游按钮状态
    this._updateRoamingBtn();

    // 开始第一个节点
    this._roamingShowNode(0);
  }

  stopRoaming() {
    this._roaming = false;
    this._roamingPaused = false;
    clearTimeout(this._roamingTimer);
    this._roamingTimer = null;

    // 隐藏漫游控件
    this._hideRoamingUI();

    // 更新漫游按钮状态
    this._updateRoamingBtn();

    // 清除高亮
    if (this.forceLayout) this.forceLayout.clearHighlight();
  }

  pauseRoaming() {
    if (!this._roaming) return;
    this._roamingPaused = true;
    clearTimeout(this._roamingTimer);
    this._updateRoamingPlayPauseBtn();
  }

  resumeRoaming() {
    if (!this._roaming) return;
    this._roamingPaused = false;
    this._updateRoamingPlayPauseBtn();
    this._scheduleNextRoaming();
  }

  nextRoamingNode() {
    if (!this._roaming || this._roamingNodes.length === 0) return;
    this._roamingIndex = (this._roamingIndex + 1) % this._roamingNodes.length;
    clearTimeout(this._roamingTimer);
    this._roamingShowNode(this._roamingIndex);
  }

  prevRoamingNode() {
    if (!this._roaming || this._roamingNodes.length === 0) return;
    this._roamingIndex = (this._roamingIndex - 1 + this._roamingNodes.length) % this._roamingNodes.length;
    clearTimeout(this._roamingTimer);
    this._roamingShowNode(this._roamingIndex);
  }

  _roamingShowNode(index) {
    const node = this._roamingNodes[index];
    if (!node) return;

    // 标记为漫游触发的点击，避免 _handleNodeClick 暂停漫游
    this._isRoamingClick = true;

    // 聚焦到节点
    this.forceLayout.focusNode(node, 1.6, true);

    // 高亮关联节点
    this.forceLayout.selectedNode = node;
    this.forceLayout.highlight(node.id);

    // 显示详情面板
    this._handleNodeClick(node);

    this._isRoamingClick = false;

    // 更新漫游进度
    this._updateRoamingProgress();

    // 计划下一个节点（5秒后）
    this._scheduleNextRoaming();
  }

  _scheduleNextRoaming() {
    clearTimeout(this._roamingTimer);
    if (this._roamingPaused) return;
    this._roamingTimer = setTimeout(() => {
      if (!this._roaming || this._roamingPaused) return;
      this._roamingIndex = (this._roamingIndex + 1) % this._roamingNodes.length;
      this._roamingShowNode(this._roamingIndex);
    }, 5000);
  }

  _showRoamingUI() {
    let el = document.getElementById('graphRoamingControl');
    if (!el) {
      el = document.createElement('div');
      el.id = 'graphRoamingControl';
      el.className = 'gg-roaming-control';
      const container = document.querySelector('.gg-canvas-container');
      if (container) container.appendChild(el);
    }
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="gg-roaming-inner">
        <div class="gg-roaming-info">
          <span class="gg-roaming-icon">🧭</span>
          <span class="gg-roaming-label">知识漫游</span>
          <span class="gg-roaming-progress" id="roamingProgress">1/${this._roamingNodes.length}</span>
        </div>
        <div class="gg-roaming-actions">
          <button class="gg-roaming-btn" id="roamingPrev" title="上一个">◀</button>
          <button class="gg-roaming-btn gg-roaming-btn-primary" id="roamingPlayPause" title="暂停">⏸</button>
          <button class="gg-roaming-btn" id="roamingNext" title="下一个">▶</button>
          <button class="gg-roaming-btn" id="roamingClose" title="退出漫游">✕</button>
        </div>
      </div>
    `;
  }

  _hideRoamingUI() {
    const el = document.getElementById('graphRoamingControl');
    if (el) el.classList.add('hidden');
  }

  _updateRoamingBtn() {
    const btn = document.getElementById('graphRoamingBtn');
    if (!btn) return;
    if (this._roaming) {
      btn.textContent = '🧭 退出漫游';
      btn.classList.add('active');
    } else {
      btn.textContent = '🧭 知识漫游';
      btn.classList.remove('active');
    }
  }

  _updateRoamingProgress() {
    const el = document.getElementById('roamingProgress');
    if (el) {
      el.textContent = `${this._roamingIndex + 1}/${this._roamingNodes.length}`;
    }
  }

  _updateRoamingPlayPauseBtn() {
    const btn = document.getElementById('roamingPlayPause');
    if (!btn) return;
    btn.textContent = this._roamingPaused ? '▶' : '⏸';
    btn.title = this._roamingPaused ? '继续' : '暂停';
  }

  _updateRoamingNodeList() {
    // 根据当前筛选状态更新漫游节点列表
    const typePriority = { domain: 0, cluster: 1, atom: 2, person: 3, question: 4, gap: 5 };
    this._roamingNodes = this.graphData.nodes
      .filter(n => n.visible !== false)
      .sort((a, b) => {
        const pa = typePriority[a.type] ?? 9;
        const pb = typePriority[b.type] ?? 9;
        if (pa !== pb) return pa - pb;
        return (b.weight || 0) - (a.weight || 0);
      });
    this._roamingIndex = 0;
    this._updateRoamingProgress();
    if (this._roamingNodes.length === 0) {
      this.stopRoaming();
    }
  }
}

window.graphView = new GraphView();
