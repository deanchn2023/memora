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
      }
    }
    await this.loadGraph();
  }

  onHide() {
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

      // 刷新按钮
      if (target.closest('#graphRefreshBtn') || target.closest('#graphRefreshBtn2')) {
        this.loadGraph(true);
        return;
      }

      // 重新体检按钮
      if (target.closest('#graphRecheckBtn')) {
        this.loadGraph(true);
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

  async loadGraph(forceRefresh = false) {
    if (this.isLoading) return;

    const emptyEl = document.getElementById('graphEmptyState');
    const loadingEl = document.getElementById('graphLoading');

    try {
      // 先检查缓存
      if (!forceRefresh) {
        const result = await window.electronAPI?.graphBuild({ forceRefresh: false });
        if (result?.stats?.nodeCount > 0) {
          this._loadFromDB();
          return;
        }
      }

      // 需要调用 ADP
      this.isLoading = true;
      if (emptyEl) emptyEl.classList.add('hidden');
      if (loadingEl) loadingEl.classList.remove('hidden');

      const result = await window.electronAPI?.graphBuild({ forceRefresh: true });

      if (loadingEl) loadingEl.classList.add('hidden');
      this.isLoading = false;

      if (result?.stats?.nodeCount > 0) {
        this._loadFromDB();
      } else {
        if (emptyEl) emptyEl.classList.remove('hidden');
        this._showEmptyWithMessage(result?.error || '暂无图谱数据');
      }
    } catch (e) {
      this.isLoading = false;
      if (loadingEl) loadingEl.classList.add('hidden');
      if (emptyEl) emptyEl.classList.remove('hidden');
      console.error('[GraphView] loadGraph error:', e);
      this._showEmptyWithMessage('加载出错：' + e.message);
    }
  }

  async _loadFromDB() {
    const emptyEl = document.getElementById('graphEmptyState');
    if (emptyEl) emptyEl.classList.add('hidden');

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

    if (this.forceLayout && this.graphData.nodes.length > 0) {
      this.forceLayout.setData(this.graphData);
    }

    this._updateStatsBar(statsResult?.stats);
    this._updateHealthBar();
    this._updateBuiltAt();
  }

  _updateStatsBar(stats) {
    if (!stats) return;
    const el = document.getElementById('graphStatsBar');
    if (!el) return;
    const d = stats.densityDist || {};
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
        this.loadGraph(true);
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

  _showEmptyWithMessage(msg) {
    const el = document.getElementById('graphEmptyState');
    if (!el) return;
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="ge-inner">
        <div class="ge-icon">🗺</div>
        <h3 class="ge-title">知识图谱</h3>
        <p class="ge-desc">${this._esc(msg)}</p>
        <button class="ge-build-btn" data-gp-action="build_graph">🚀 构建图谱</button>
        <p class="ge-hint">需要登录并配置 ADP，AI 将分析你的知识体系并构建图谱</p>
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
}

window.graphView = new GraphView();
