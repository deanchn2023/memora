/**
 * Memora v2.4 — 洞察模块 (Insight Module)
 * 知识活化引擎 + 知识演化追踪 + 仪表盘 + 多模态知识库
 * 核心：AI 能力全部走 ADP 接口，客户端只做展示和交互
 */

const Insight = {
  currentTab: 'dashboard', // dashboard | multimodal | activation | evolution | conflicts
  isLoading: false,
  data: {
    stats: null,
    activations: [],
    evolutions: [],
    conflicts: [],
    entityCloud: [],
    multimodalAssets: [],
    multimodalFilter: 'all',
    multimodalBooks: []
  },
  initialized: false,
  _taskListenersBound: false,

  init() {
    if (this.initialized) return;
    this.initialized = true;
    console.log('[Insight] init() — binding tab events');

    // 子标签切换
    document.querySelectorAll('.insight-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const viewTab = e.currentTarget.closest('.insight-tab');
        if (!viewTab) return;

        document.querySelectorAll('.insight-tab').forEach(t => t.classList.remove('active'));
        viewTab.classList.add('active');
        this.currentTab = viewTab.dataset.tab;
        console.log('[Insight] Tab switched to:', this.currentTab);

        document.querySelectorAll('.insight-panel').forEach(p => p.classList.remove('active'));
        const panel = document.getElementById(`insightPanel_${this.currentTab}`);
        if (panel) {
          panel.classList.add('active');
        } else {
          console.error('[Insight] Panel not found: insightPanel_' + this.currentTab);
        }
        this.onTabSwitch(this.currentTab);
      });
    });

    // 全局事件委托：知识库面板所有按钮
    this._bindGlobalEvents();

    // 绑定异步任务 IPC 监听
    this._bindTaskListeners();

    console.log('[Insight] init() — bound', document.querySelectorAll('.insight-tab').length, 'tabs');
  },

  /** 绑定异步任务完成监听 — 切换标签后也能收到结果 */
  _bindTaskListeners() {
    if (this._taskListenersBound) return;
    this._taskListenersBound = true;

    // 监听任务完成推送
    window.electronAPI?.onInsightTaskComplete?.((data) => {
      console.log('[Insight] Task complete:', data.taskType, data.error ? 'ERROR' : 'OK');
      const { taskType, result, error } = data;

      switch (taskType) {
        case 'activations':
          if (!error && result) {
            this.data.activations = result.items || [];
            this._renderActivationsResult();
          } else if (error) {
            this._renderActivationsError(error);
          }
          break;
        case 'gap_analysis':
          if (!error && result) {
            this._renderGapAnalysisResult(result);
          } else if (error) {
            this._renderGapAnalysisError(error);
          }
          break;
        case 'evolutions':
          if (!error && result) {
            this.data.evolutions = result.items || [];
            this._renderEvolutionsResult();
          } else if (error) {
            this._renderEvolutionsError(error);
          }
          break;
        case 'conflict_detection':
          if (!error && result) {
            this.data.conflicts = result.items || [];
            this._renderConflictsResult();
          } else if (error) {
            this._renderConflictsError(error);
          }
          break;
      }

      // 无论在哪个标签，都显示 Toast 通知
      if (!error) {
        this._showToast(`${this._getTaskLabel(taskType)}分析完成`, 'success');
      } else {
        this._showToast(`${this._getTaskLabel(taskType)}分析失败：${error}`, 'error');
      }
    });

    // 监听进度推送（可选）
    window.electronAPI?.onInsightTaskProgress?.((data) => {
      console.log('[Insight] Task progress:', data.taskType, data.message);
    });
  },

  _getTaskLabel(taskType) {
    const labels = {
      activations: '知识活化',
      gap_analysis: '知识缺口',
      evolutions: '知识演化',
      conflict_detection: '冲突检测'
    };
    return labels[taskType] || taskType;
  },

  /** 发起异步任务 — 不阻塞前端，后台执行，结果通过 IPC 推送 */
  async _startInsightTask(taskType) {
    try {
      const response = await window.electronAPI?.insightStartTask?.(taskType);
      if (response?.status === 'already_running') {
        console.log('[Insight] Task already running:', taskType);
        return;
      }
      console.log('[Insight] Task started:', taskType, response?.taskId);
    } catch (err) {
      console.error('[Insight] Start task error:', err.message);
    }
  },

  /** 切换到某标签时，先检查缓存和运行状态 */
  async _checkTaskState(taskType) {
    try {
      const [status, cached] = await Promise.all([
        window.electronAPI?.insightGetTaskStatus?.(taskType) || Promise.resolve({ status: 'none' }),
        window.electronAPI?.insightGetCachedResult?.(taskType) || Promise.resolve(null)
      ]);

      if (cached && cached.result) {
        // 有缓存结果，直接用
        return { hasResult: true, result: cached.result, isRunning: status.status === 'running' };
      }

      if (status.status === 'running') {
        // 正在执行，无缓存
        return { hasResult: false, result: null, isRunning: true };
      }

      // 没有缓存也没运行
      return { hasResult: false, result: null, isRunning: false };
    } catch (err) {
      return { hasResult: false, result: null, isRunning: false };
    }
  },

  /** 全局事件委托 — 确保按钮始终可点击 */
  _bindGlobalEvents() {
    const insightView = document.getElementById('insightView');
    if (!insightView) return;

    insightView.addEventListener('click', (e) => {
      const target = e.target;

      // 多模态工具栏按钮
      // 点击导入区（排除隐藏的 file input）
      if (target.closest('#mmDropHint') && target.id !== 'mmFileInput') {
        e.preventDefault(); e.stopPropagation();
        const fileInput = document.getElementById('mmFileInput');
        if (fileInput) fileInput.click();
        return;
      }
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

      // 类型筛选标签
      const mmTypeTab = target.closest('.mm-type-tab');
      if (mmTypeTab) {
        e.preventDefault();
        document.querySelectorAll('.mm-type-tab').forEach(t => t.classList.remove('active'));
        mmTypeTab.classList.add('active');
        this.data.multimodalFilter = mmTypeTab.dataset.mmType;
        this._filterAssets();
        return;
      }

      // 书本查看按钮
      const bookViewBtn = target.closest('.mm-book-view-btn');
      if (bookViewBtn) {
        e.preventDefault();
        this._viewBook(bookViewBtn.dataset.bookId);
        return;
      }

      // 书本卡片点击
      const bookCard = target.closest('.mm-book-card');
      if (bookCard && !target.closest('.mm-book-view-btn')) {
        this._viewBook(bookCard.dataset.bookId);
        return;
      }

      // 资产操作按钮
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

      // 快速活化按钮
      if (target.id === 'quickActivationBtn' || target.closest('#quickActivationBtn')) {
        e.preventDefault();
        this.runQuickActivation();
        return;
      }

      // 冲突解决按钮
      const conflictBtn = target.closest('.conflict-actions .activation-card-action');
      if (conflictBtn && conflictBtn.dataset.resolution) {
        e.preventDefault();
        this._resolveConflict(conflictBtn, conflictBtn.dataset.resolution);
        return;
      }

      // 活化卡片操作
      const actionBtn = target.closest('.activation-card-action[data-action]');
      if (actionBtn) {
        e.preventDefault();
        this._handleAction(actionBtn, actionBtn.dataset.action);
        return;
      }

      // 活化卡片展开按钮
      const expandBtn = target.closest('.activation-card-expand');
      if (expandBtn) {
        e.preventDefault();
        const card = expandBtn.closest('.activation-card');
        if (card) {
          // 模拟点击第一个 action 按钮来展开详情
          const firstAction = card.querySelector('.activation-card-action[data-action]');
          if (firstAction) {
            this._handleAction(firstAction, firstAction.dataset.action);
          } else {
            // 没有 action 按钮，显示基本信息
            this._showActivationDetail(card);
          }
        }
        return;
      }

      // 冲突检测按钮
      if (target.id === 'runConflictDetectionBtn' || target.id === 'rerunConflictDetectionBtn' || target.id === 'rerunConflictBtn2') {
        e.preventDefault();
        const container = document.getElementById('insightConflictContent');
        if (container) {
          container.innerHTML = '<div class="insight-loading"><div class="spinner"></div><span>AI 正在扫描知识冲突...（可切换其他页面，完成后自动通知）</span></div>';
        }
        this._startInsightTask('conflict_detection');
        return;
      }

      // 活化刷新按钮
      if (target.id === 'activationRefreshBtn') {
        e.preventDefault();
        // 重新发起异步任务
        const container = document.getElementById('insightActivationContent');
        if (container) {
          container.innerHTML = '<div class="insight-loading"><div class="spinner"></div><span>AI 正在分析知识活化...（可切换其他页面，完成后自动通知）</span></div>';
        }
        this._startInsightTask('activations');
        return;
      }

      // 重试按钮
      if (target.closest('[data-retry]')) {
        const retryFn = target.closest('[data-retry]').dataset.retry;
        if (retryFn && typeof this[retryFn] === 'function') {
          this[retryFn]();
        }
        return;
      }
    });

    // 拖拽事件
    this._bindDragDrop(insightView);

    // 弹窗关闭事件（body 级别）
    document.body.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('[data-close]');
      if (closeBtn) {
        const overlayId = closeBtn.dataset.close;
        const overlay = document.getElementById(overlayId);
        if (overlay) overlay.style.display = 'none';
      }
    });
  },

  /** 拖拽导入功能 */
  _bindDragDrop(container) {
    let dragCounter = 0;

    container.addEventListener('dragenter', (e) => {
      e.preventDefault();
      // 只在知识库标签页激活时处理
      if (this.currentTab !== 'multimodal') return;
      dragCounter++;
      this._showDropZone();
    });

    container.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        this._hideDropZone();
      }
    });

    container.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    container.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragCounter = 0;
      this._hideDropZone();

      if (this.currentTab !== 'multimodal') return;

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      console.log('[Insight] Drop files:', files.length);
      await this._importDroppedFiles(files);
    });
  },

  _showDropZone() {
    // 高亮拖拽提示区
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
          <div class="mm-drop-zone-hint">支持图片、文档、音视频等文件</div></div>
        </div>`;
      const panel = document.getElementById('insightPanel_multimodal');
      if (panel) panel.appendChild(dropZone);
    }
    dropZone.classList.add('active');
  },

  _hideDropZone() {
    const dropZone = document.getElementById('mmDropZone');
    if (dropZone) dropZone.classList.remove('active');
    // 取消高亮拖拽提示区
    const dropHint = document.getElementById('mmDropHint');
    if (dropHint) dropHint.classList.remove('drag-over');
  },

  async _importDroppedFiles(fileList) {
    const results = { success: 0, failed: 0, errors: [] };

    // 显示进度
    const container = document.getElementById('insightMultimodalContent');
    const progressEl = document.createElement('div');
    progressEl.className = 'mm-import-progress';
    progressEl.innerHTML = `<div class="insight-loading"><div class="spinner"></div><span>正在导入 ${fileList.length} 个文件...</span></div>`;
    container?.appendChild(progressEl);

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      try {
        // 读取文件为 Uint8Array（Electron IPC 支持 Uint8Array 零拷贝传输）
        const arrayBuffer = await file.arrayBuffer();

        const result = await window.electronAPI?.multimodalImportBuffer?.({
          name: file.name,
          type: file.type,
          size: file.size,
          buffer: arrayBuffer
        });

        if (result?.success) {
          results.success++;
        } else {
          results.failed++;
          results.errors.push(`${file.name}: ${result?.error || '未知错误'}`);
        }
      } catch (err) {
        results.failed++;
        results.errors.push(`${file.name}: ${err.message}`);
      }
    }

    progressEl.remove();

    // 显示结果
    if (results.success > 0) {
      this.loadMultimodal();
    }
    if (results.failed > 0) {
      this._showToast(`导入完成：${results.success} 成功，${results.failed} 失败`, 'warning');
    } else if (results.success > 0) {
      this._showToast(`成功导入 ${results.success} 个文件`, 'success');
    }
  },

  /** 简易 Toast 提示 */
  _showToast(message, type = 'info') {
    let toast = document.getElementById('insightToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'insightToast';
      toast.className = 'mm-toast';
      document.body.appendChild(toast);
    }

    const colors = { success: '#34C759', warning: '#FF9500', error: '#FF3B30', info: '#007AFF' };
    const icons = { success: '✓', warning: '⚠', error: '✕', info: 'ℹ' };
    toast.innerHTML = `<span style="color:${colors[type] || colors.info}">${icons[type] || icons.info}</span> ${this._escapeHtml(message)}`;
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  },

  onShow() {
    console.log('[Insight] onShow()');
    this.init();
    this.loadDashboard();
  },

  onTabSwitch(tab) {
    console.log('[Insight] onTabSwitch:', tab);
    try {
      switch (tab) {
        case 'dashboard': this.loadDashboard(); break;
        case 'multimodal': this.loadMultimodal(); break;
        case 'activation': this.loadActivations(); break;
        case 'evolution': this.loadEvolutions(); break;
        case 'conflicts': this.loadConflicts(); break;
      }
    } catch (err) {
      console.error('[Insight] onTabSwitch error:', err);
    }
  },

  // 安全调用 IPC — 单个调用失败不影响其他
  async _safeCall(fn, fallback) {
    try {
      const result = await fn();
      return result || fallback;
    } catch (err) {
      console.warn('[Insight] IPC call failed:', err.message);
      return fallback;
    }
  },

  // ========== 仪表盘 ==========
  async loadDashboard() {
    const container = document.getElementById('insightDashboardContent');
    if (!container) return;

    container.innerHTML = '<div class="insight-loading"><div class="spinner"></div><span>加载洞察数据...</span></div>';

    try {
      // 并行加载统计数据（每个独立容错）
      const [knowledgeStats, memoryStats, graphStats, multimodalStats] = await Promise.all([
        this._safeCall(() => window.electronAPI?.knowledgeGetStats?.(), { totalAtoms: 0, totalClusters: 0, totalArticles: 0 }),
        this._safeCall(() => window.electronAPI?.getMemoryStats?.(), { total: 0, byType: {} }),
        this._safeCall(() => window.electronAPI?.graphStats?.(), { nodeCount: 0, edgeCount: 0 }),
        this._safeCall(() => window.electronAPI?.multimodalStats?.(), { total: 0, byType: {}, totalSize: 0, bookCount: 0 })
      ]);

      this.data.stats = { knowledgeStats, memoryStats, graphStats, multimodalStats };

      const mmByType = multimodalStats.byType || {};
      const mmTotal = multimodalStats.total || 0;

      container.innerHTML = `
        <div class="dashboard-grid">
          ${this._renderStatCard('🧠', '知识原子', knowledgeStats.totalAtoms || 0, '个')}
          ${this._renderStatCard('🔗', '知识簇', knowledgeStats.totalClusters || 0, '个')}
          ${this._renderStatCard('📝', '知识文章', knowledgeStats.totalArticles || 0, '篇')}
          ${this._renderStatCard('💭', '记忆总数', memoryStats.total || 0, '条')}
          ${this._renderStatCard('📚', '多模态资产', mmTotal, '个')}
          ${this._renderStatCard('📖', '知识书本', multimodalStats.bookCount || 0, '本')}
          ${this._renderStatCard('🕸', '图谱实体', graphStats.nodeCount || 0, '个')}
          ${this._renderStatCard('↔️', '图谱关系', graphStats.edgeCount || 0, '条')}
        </div>

        ${this._renderDistribution(memoryStats)}

        ${mmTotal > 0 ? this._renderMultimodalDistribution(mmByType, multimodalStats.totalSize || 0) : ''}
        
        <div class="activation-section">
          <div class="activation-section-header">
            <h3>⚡ 快速活化</h3>
            <button class="activation-refresh-btn" id="quickActivationBtn">扫描知识缺口</button>
          </div>
          <div id="quickActivationContent">
            <div class="insight-empty" style="padding:30px">
              <div class="insight-empty-icon">🔍</div>
              <div class="insight-empty-desc">点击"扫描知识缺口"，AI 将分析你的知识库，找出需要关注的知识盲区</div>
            </div>
          </div>
        </div>
      `;
    } catch (err) {
      console.error('[Insight] Dashboard load error:', err);
      container.innerHTML = `
        <div class="insight-empty">
          <div class="insight-empty-icon">⚠️</div>
          <div class="insight-empty-title">加载失败</div>
          <div class="insight-empty-desc">${this._escapeHtml(err.message || '请稍后重试')}</div>
          <button class="activation-refresh-btn" style="margin-top:12px" data-retry="loadDashboard">重新加载</button>
        </div>`;
    }
  },

  _renderStatCard(icon, label, value, unit) {
    return `
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-icon">${icon}</span>
          <span class="stat-card-label">${label}</span>
        </div>
        <div class="stat-card-value">${value}<span style="font-size:14px;font-weight:400;color:var(--text-tertiary,#aeaeb2);margin-left:2px">${unit}</span></div>
      </div>`;
  },

  _renderDistribution(memoryStats) {
    const types = memoryStats.byType || memoryStats.byLayer || {};
    const instant = types.instant || 0;
    const short = types.short || 0;
    const long = types.long || 0;
    const total = instant + short + long || 1;

    const pInstant = Math.round((instant / total) * 100);
    const pShort = Math.round((short / total) * 100);
    const pLong = 100 - pInstant - pShort;

    const gradient = `conic-gradient(#FF9500 0% ${pInstant}%, #007AFF ${pInstant}% ${pInstant + pShort}%, #34C759 ${pInstant + pShort}% 100%)`;

    return `
      <div class="distribution-section">
        <h3>📊 记忆分布</h3>
        <div class="distribution-row">
          <div class="distribution-chart" style="background:${gradient}">
            <div class="distribution-chart-center">
              <div class="value">${instant + short + long}</div>
              <div class="label">总记忆</div>
            </div>
          </div>
          <div class="distribution-legend">
            <div class="distribution-legend-item">
              <span class="distribution-legend-dot" style="background:#FF9500"></span>
              瞬时记忆
              <span class="distribution-legend-value">${instant}</span>
            </div>
            <div class="distribution-legend-item">
              <span class="distribution-legend-dot" style="background:#007AFF"></span>
              短期记忆
              <span class="distribution-legend-value">${short}</span>
            </div>
            <div class="distribution-legend-item">
              <span class="distribution-legend-dot" style="background:#34C759"></span>
              长期记忆
              <span class="distribution-legend-value">${long}</span>
            </div>
          </div>
        </div>
      </div>`;
  },

  // ========== 知识活化 ==========
  async loadActivations() {
    const container = document.getElementById('insightActivationContent');
    if (!container) return;

    // 先检查缓存和任务状态
    const state = await this._checkTaskState('activations');

    if (state.hasResult) {
      this.data.activations = state.result.items || [];
      this._renderActivationsResult();
      // 如果同时有运行中的任务，显示刷新提示
      if (state.isRunning) {
        this._showToast('正在更新活化推荐...', 'info');
      }
      return;
    }

    if (state.isRunning) {
      container.innerHTML = '<div class="insight-loading"><div class="spinner"></div><span>AI 正在分析知识活化...（可切换其他页面，完成后自动通知）</span></div>';
      return;
    }

    // 无缓存无运行 → 注入测试数据（开发阶段，避免每次调 AI）
    await this._injectActivationTestData();
  },

  // 注入测试数据到缓存（开发阶段使用，避免消耗 AI 额度）
  async _injectActivationTestData() {
    const testData = {
      activations: [
        {
          type: "deepen",
          title: "提炼ADP通用卖点与竞对话术库",
          desc: `近期您密集接触了大量ADP中标案例，对手常为火山引擎、Dify、百度等。但现状是这些信息分散在多个喜报中，尚未提炼成一套可复用的\u201c赢单话术\u201d和ADP差异化卖点列表。`,
          entity: "ADP",
          confidence: 0.95,
          actions: [
            `整理最近一周所有喜报，提取每个案例中ADP击败竞对的\u201c杀手锏\u201d（如RAG能力、私有化、建管一体）`,
            "将竞对（火山引擎、Dify、字节）的弱点与ADP的优势汇总，形成一张竞品对比表",
            "撰写一篇名为《ADP赢单案例复盘：如何击败火山引擎和Dify》的知识原子"
          ]
        },
        {
          type: "connection",
          title: `连接\u201cADP二期\u201d与\u201c动态工作流/多Agent协同\u201d`,
          desc: `您收藏了关于\u201cLLM动态路由\u201d、\u201cMulti-Agent编排\u201d和\u201cDynamic Workflow\u201d的笔记，而ADP二期立项恰好包含\u201c多智能体协同\u201d和\u201c技能资产\u201d。这表明二期方向与您近期兴趣点高度吻合。`,
          entity: "ADP二期",
          confidence: 0.9,
          actions: [
            `回顾\u201cLLM驱动路由\u201d和\u201cMulti-Agent编排\u201d的笔记`,
            "将笔记中的概念与ADP二期规划关联，思考这些技术如何落地为二期功能",
            "向团队提议，在二期设计中参考这些前沿模式"
          ]
        },
        {
          type: "gap",
          title: `建立\u201cADP战略项目\u201d知识簇`,
          desc: `您的记忆里充满了\u201c中标\u201d、\u201c突破\u201d、\u201c首单\u201d等高频词，但知识库中没有将这些关键项目聚合为一个\u201c标杆案例库\u201d，导致其商业价值未被体系化利用。`,
          entity: "银保信项目",
          confidence: 0.9,
          actions: [
            "创建一个名为《ADP灯塔客户与标杆案例集》的知识簇",
            "将近期所有重大中标项目作为原子加入该簇",
            "为每个案例原子标注：行业、金额、竞对、战略意义"
          ]
        },
        {
          type: "outdated",
          title: `审核并更新\u201cADP演示场景\u201d知识点`,
          desc: `知识原子中有一条关于\u201cADP 4.0演示场景\u201d的详细记录。考虑到您新中标项目和二期规划，原有演示场景可能已无法完全覆盖当前最佳实践和卖点。`,
          entity: "产品-智能体",
          confidence: 0.85,
          actions: [
            `定位到\u201cADP 4.0演示场景\u201d相关的知识原子`,
            `评估\u201c银保信审核Agent\u201d和\u201c瑞幸咖啡\u201d等场景是否可以作为新的演示案例加入`,
            `如有必要，撰写一个\u201cADP 5.0演示场景规划\u201d的新原子`
          ]
        },
        {
          type: "connection",
          title: `连接\u201c专有云/私有化\u201d项目与\u201c信创/数据安全\u201d卖点`,
          desc: `您的多个项目都强调\u201c专有云\u201d和\u201c私有化\u201d。而知识库中有关于ADP比拼\u201c信创适配\u201d和\u201c企业级治理\u201d的优势。将这些点连接起来，能形成一套针对金融、国央企、医疗等强监管行业的完整销售故事。`,
          entity: "私有化部署",
          confidence: 0.85,
          actions: [
            `回顾知识原子中关于ADP对标Anthropic和OpenAI的\u201c私有化\u201d、\u201c信创\u201d、\u201c治理\u201d优势`,
            "撰写一篇名为《ADP私有化方案在强监管行业的价值与案例》的知识原子",
            `新建原子时，引用\u201c南网\u201d、\u201c渤海银行\u201d、\u201c武汉新芯\u201d等案例作为支撑`
          ]
        },
        {
          type: "deepen",
          title: `将\u201c三晋文化项目\u201d沉淀为行业解决方案指南`,
          desc: `\u201c三晋文化\u201d项目首次将ADP与\u201c数字人\u201d产品打包，金额高达150W，是一个跨产品组合销售的典型案例。这代表了一种高价值的销售模式，不应只作为一条喜报被遗忘。`,
          entity: "三晋文化大模型项目",
          confidence: 0.8,
          actions: [
            "创建一个名为《ADP + X 组合销售案例》的知识原子",
            "分析该案例中ADP与数字人结合的技术方案和商务策略",
            "思考其他产品与ADP组合的可能性，并记录下来"
          ]
        },
        {
          type: "gap",
          title: `构建\u201cBSC填写\u201d任务与\u201c项目成果\u201d的价值关联`,
          desc: `知识库中详细记录了\u201cBSC填写\u201d的分工和截止日期，但这只是一个行政管理任务。它的价值和最终产出是什么？目前没有与任何具体项目成果或健康指标相连。`,
          entity: "项目-管理",
          confidence: 0.8,
          actions: [
            "查找BSC填写对应的具体指标",
            "将这些指标分析的结果补充到BSC原子中",
            `在\u201c竞品情况\u201d原子旁，关联您整理的竞对手册`
          ]
        },
        {
          type: "outdated",
          title: `更新\u201c竞品对比\u201d知识原子`,
          desc: `知识原子中提到ADP对标\u201cAnthropic Managed Agents\u201d等。但近期您频繁与\u201c火山引擎、Dify、百度\u201d竞争，这些才是更直接、更现实的对手。原有的竞品对比可能只具有历史参考价值。`,
          entity: "产品-竞品",
          confidence: 0.9,
          actions: [
            `立即更新竞品对比相关的知识原子，将\u201c火山引擎\u201d、\u201cDify\u201d作为主要对标对象`,
            `参考各中标案例的\u201c击败原因\u201d，丰富对主要竞品弱点的描述`,
            "删除或归档过时的竞品对比，保持知识的时效性"
          ]
        }
      ],
      summary: `知识库当前处于高活跃度状态，但信息碎片化严重。核心挑战是从\u2018密集的事件流\u2019中提炼出\u2018可复用的方法论和结构化知识\u2019，从而将零散的中标喜讯，转变为ADP持续制胜的战略资产。`
    };

    // 注入到后端缓存
    const cacheResult = { items: testData.activations, summary: testData.summary };
    try {
      await window.electronAPI?.insightInjectTestData?.({
        taskType: 'activations',
        result: cacheResult
      });
      this.data.activations = testData.activations;
      this._renderActivationsResult();
      console.log('[Insight] Test data injected for activations');
    } catch (err) {
      console.warn('[Insight] Inject test data failed:', err.message);
      // fallback: 直接渲染
      this.data.activations = testData.activations;
      this._renderActivationsResult();
    }
  },

  _renderActivationsResult() {
    const container = document.getElementById('insightActivationContent');
    if (!container) return;

    if (this.data.activations.length === 0) {
      container.innerHTML = `
        <div class="insight-empty">
          <div class="insight-empty-icon">💡</div>
          <div class="insight-empty-title">暂无活化推荐</div>
          <div class="insight-empty-desc">知识活化引擎会根据你的工作上下文，主动推荐相关历史知识。积累更多记忆和知识后，活化推荐会自动出现。</div>
        </div>
        <div style="text-align:center;margin-top:12px">
          <button class="activation-refresh-btn" id="activationRefreshBtn">重新扫描</button>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div style="text-align:center;margin-bottom:12px">
        <button class="activation-refresh-btn" id="activationRefreshBtn">重新扫描</button>
      </div>
      ${this.data.activations.map(item => this._renderActivationCard(item)).join('')}`;
  },

  _renderActivationsError(error) {
    const container = document.getElementById('insightActivationContent');
    if (!container) return;
    container.innerHTML = `
      <div class="insight-empty">
        <div class="insight-empty-icon">⚠️</div>
        <div class="insight-empty-title">活化分析失败</div>
        <div class="insight-empty-desc">${this._escapeHtml(error || '请稍后重试')}</div>
      </div>
      <div style="text-align:center;margin-top:12px">
        <button class="activation-refresh-btn" id="activationRefreshBtn">重新扫描</button>
      </div>`;
  },

  async runQuickActivation() {
    const btn = document.getElementById('quickActivationBtn');
    const content = document.getElementById('quickActivationContent');
    if (!btn || !content) return;

    btn.disabled = true;
    btn.textContent = '扫描中...';
    content.innerHTML = '<div class="insight-loading"><div class="spinner"></div><span>AI 正在分析知识缺口...（可切换其他页面，完成后自动通知）</span></div>';

    // 发起异步任务
    await this._startInsightTask('gap_analysis');
  },

  _renderGapAnalysisResult(result) {
    const content = document.getElementById('quickActivationContent');
    const btn = document.getElementById('quickActivationBtn');
    if (btn) { btn.disabled = false; btn.textContent = '扫描知识缺口'; }
    if (!content) return;

    if (result.gaps && result.gaps.length > 0) {
      content.innerHTML = result.gaps.map(gap => this._renderActivationCard({
        type: 'gap',
        title: `知识缺口：${gap.entity}`,
        desc: gap.reason || `"${gap.entity}" 频繁出现但知识库中无相关记录`,
        actions: gap.suggestedActions || []
      })).join('');
    } else if (result.suggestions) {
      content.innerHTML = `
        <div class="activation-card">
          <div class="activation-card-header">
            <span class="activation-card-type gap">AI分析</span>
          </div>
          <div class="activation-card-desc">${this._escapeHtml(result.suggestions)}</div>
        </div>`;
    } else {
      content.innerHTML = `
        <div class="activation-card">
          <div class="activation-card-header">
            <span class="activation-card-type" style="background:rgba(52,199,89,0.1);color:#34C759">✓</span>
          </div>
          <div class="activation-card-title">知识库状态良好</div>
          <div class="activation-card-desc">未发现明显的知识缺口，继续积累知识吧！</div>
        </div>`;
    }
  },

  _renderGapAnalysisError(error) {
    const content = document.getElementById('quickActivationContent');
    const btn = document.getElementById('quickActivationBtn');
    if (btn) { btn.disabled = false; btn.textContent = '扫描知识缺口'; }
    if (!content) return;

    content.innerHTML = `
      <div class="activation-card">
        <div class="activation-card-title">扫描失败</div>
        <div class="activation-card-desc">${this._escapeHtml(error || '请稍后重试')}</div>
      </div>`;
  },

  _renderActivationCard(item) {
    const typeClass = item.type || 'atom';
    const actions = (item.actions || []).slice(0, 3);
    const itemId = item.id || ('act_' + Math.random().toString(36).substr(2, 9));
    return `
      <div class="activation-card" data-id="${itemId}" data-entity="${this._escapeHtml(item.entity || '')}" data-confidence="${item.confidence || 0}">
        <div class="activation-card-header">
          <span class="activation-card-type ${typeClass}">${this._getTypeLabel(typeClass)}</span>
          ${item.entity ? `<span class="activation-card-entity">${this._escapeHtml(item.entity)}</span>` : ''}
          ${item.confidence ? `<span class="activation-card-confidence">${Math.round(item.confidence * 100)}%</span>` : ''}
          ${item.timeAgo ? `<span class="activation-card-time">${item.timeAgo}</span>` : ''}
        </div>
        <div class="activation-card-title">${this._escapeHtml(item.title || '')}</div>
        ${item.desc ? `<div class="activation-card-desc">${this._escapeHtml(item.desc)}</div>` : ''}
        ${actions.length > 0 ? `
          <div class="activation-card-actions">
            ${actions.map((a, i) => `<button class="activation-card-action${i === 0 ? ' primary' : ''}" data-action="${this._escapeHtml(a)}" title="点击执行：${this._escapeHtml(a)}">${this._escapeHtml(a)}</button>`).join('')}
          </div>` : ''}
        <button class="activation-card-expand" title="展开详情">▶</button>
      </div>`;
  },

  _getTypeLabel(type) {
    const labels = {
      memory: '记忆', atom: '知识', article: '文章',
      conflict: '冲突', gap: '缺口', outdated: '过时',
      activation: '活化', merge: '合并', update: '更新',
      deepen: '深化', connection: '关联'
    };
    return labels[type] || type;
  },

  _handleAction(btn, action) {
    const card = btn.closest('.activation-card');
    if (!card) return;

    // 关闭已展开的详情
    const existingOverlay = card.querySelector('.activation-detail-overlay');
    if (existingOverlay) existingOverlay.remove();

    // 创建详情面板
    const entity = card.dataset.entity || '';
    const confidence = card.dataset.confidence || '0';
    const title = card.querySelector('.activation-card-title')?.textContent || '';
    const desc = card.querySelector('.activation-card-desc')?.textContent || '';
    const allActions = [...card.querySelectorAll('.activation-card-action')].map(b => b.dataset.action).filter(Boolean);

    const overlay = document.createElement('div');
    overlay.className = 'activation-detail-overlay';
    overlay.innerHTML = `
      <div class="activation-detail-content">
        <div class="activation-detail-header">
          <h3>${this._escapeHtml(title)}</h3>
          <button class="activation-detail-close">✕</button>
        </div>
        ${entity ? `<div class="activation-detail-entity">关联实体：${this._escapeHtml(entity)}</div>` : ''}
        ${confidence !== '0' ? `<div class="activation-detail-confidence">置信度：${Math.round(parseFloat(confidence) * 100)}%</div>` : ''}
        ${desc ? `<div class="activation-detail-desc">${this._escapeHtml(desc)}</div>` : ''}
        ${allActions.length > 0 ? `
          <div class="activation-detail-actions">
            <h4>建议操作</h4>
            ${allActions.map(a => `
              <div class="activation-detail-action-item">
                <span>${this._escapeHtml(a)}</span>
                <button class="activation-detail-do-btn" data-do-action="${this._escapeHtml(a)}">执行</button>
              </div>`).join('')}
          </div>` : ''}
      </div>`;

    document.body.appendChild(overlay);

    // 绑定关闭
    overlay.querySelector('.activation-detail-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      overlay.remove();
    });

    // 绑定"执行"按钮
    overlay.querySelectorAll('.activation-detail-do-btn').forEach(doBtn => {
      doBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const doAction = doBtn.dataset.doAction;
        this._executeAction(doAction, entity, title);
        overlay.remove();
      });
    });

    // 点击 overlay 背景关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });
  },

  /** 执行活化的建议操作 */
  _executeAction(action, entity, title) {
    console.log('[Insight] Execute action:', action, 'entity:', entity);

    // 1. 搜索/查找 → 跳转知识跟随搜索
    if (action.includes('搜索') || action.includes('查找') || action.includes('定位') || action.includes('回顾') || action.includes('参考')) {
      const searchInput = document.getElementById('knowledgeFollowInput');
      if (searchInput) {
        const keyword = action.replace(/搜索关于|的资料|查找|定位到|回顾|参考/g, '').replace(/["\u201c\u201d""]/g, '').trim();
        searchInput.value = keyword;
        document.querySelector('.view-tab[data-view="knowledge"]')?.click();
        // 触发搜索
        const searchBtn = document.getElementById('knowledgeFollowBtn');
        if (searchBtn) searchBtn.click();
        this._showToast(`正在搜索：${keyword}`, 'info');
      }
      return;
    }

    // 2. 创建/撰写/整理/构建 → 跳转记事本
    if (action.includes('记录') || action.includes('添加') || action.includes('创建') || action.includes('撰写') || action.includes('整理') || action.includes('构建') || action.includes('新建')) {
      document.querySelector('.view-tab[data-view="notebook"]')?.click();
      this._showToast(`建议在记事本中：${action.substring(0, 30)}`, 'info');
      return;
    }

    // 3. 更新/删除/审核/归档 → 提示操作
    if (action.includes('更新') || action.includes('删除') || action.includes('审核') || action.includes('归档')) {
      this._showToast(`操作提示：${action}`, 'info');
      return;
    }

    // 4. 分析/评估/思考 → 跳转 AI 助手
    if (action.includes('分析') || action.includes('评估') || action.includes('思考') || action.includes('提议')) {
      this._navigateToAIAssistant(action);
      return;
    }

    // 5. 默认：显示 toast 提示
    this._showToast(`建议操作：${action.substring(0, 50)}`, 'info');
  },

  /** 导航到 AI 助手视图并填入内容 */
  _navigateToAIAssistant(text) {
    // 方式1：通过 app.js 的全局方法
    if (window.app?.showAIAssistantView) {
      window.app.showAIAssistantView();
      setTimeout(() => {
        const aiInput = document.getElementById('aiChatInput');
        if (aiInput) {
          aiInput.value = text;
          aiInput.focus();
        }
      }, 150);
      this._showToast('已填入 AI 助手，按回车发送', 'info');
      return;
    }

    // 方式2：直接操作 DOM 切换视图
    const allViews = ['calendarView', 'notebookView', 'knowledgeView', 'documentsView', 'insightView'];
    allViews.forEach(id => document.getElementById(id)?.classList.add('hidden'));

    document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));

    const aiView = document.getElementById('aiAssistantView');
    if (aiView) {
      aiView.classList.remove('hidden');
    }

    // 隐藏日期导航栏
    const dateNav = document.querySelector('.date-navigator');
    if (dateNav) dateNav.style.display = 'none';

    setTimeout(() => {
      const aiInput = document.getElementById('aiChatInput');
      if (aiInput) {
        aiInput.value = text;
        aiInput.focus();
      }
    }, 150);
    this._showToast('已填入 AI 助手，按回车发送', 'info');
  },

  /** 显示活化卡片详情（无 action 按钮时使用） */
  _showActivationDetail(card) {
    const existingOverlay = card.querySelector('.activation-detail-overlay');
    if (existingOverlay) { existingOverlay.remove(); return; }

    const title = card.querySelector('.activation-card-title')?.textContent || '';
    const desc = card.querySelector('.activation-card-desc')?.textContent || '';
    const entity = card.dataset.entity || '';
    const confidence = card.dataset.confidence || '0';

    const overlay = document.createElement('div');
    overlay.className = 'activation-detail-overlay';
    overlay.innerHTML = `
      <div class="activation-detail-content">
        <div class="activation-detail-header">
          <h3>${this._escapeHtml(title)}</h3>
          <button class="activation-detail-close">✕</button>
        </div>
        ${entity ? `<div class="activation-detail-entity">关联实体：${this._escapeHtml(entity)}</div>` : ''}
        ${confidence !== '0' ? `<div class="activation-detail-confidence">置信度：${Math.round(parseFloat(confidence) * 100)}%</div>` : ''}
        ${desc ? `<div class="activation-detail-desc">${this._escapeHtml(desc)}</div>` : ''}
      </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector('.activation-detail-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      overlay.remove();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  },

  // ========== 知识演化 ==========
  async loadEvolutions() {
    const container = document.getElementById('insightEvolutionContent');
    if (!container) return;

    // 先检查缓存和任务状态
    const state = await this._checkTaskState('evolutions');

    if (state.hasResult) {
      this.data.evolutions = state.result.items || [];
      this._renderEvolutionsResult();
      if (state.isRunning) {
        this._showToast('正在更新演化数据...', 'info');
      }
      return;
    }

    if (state.isRunning) {
      container.innerHTML = '<div class="insight-loading"><div class="spinner"></div><span>AI 正在分析知识演化...（可切换其他页面，完成后自动通知）</span></div>';
      return;
    }

    // 无缓存无运行 → 发起异步任务
    container.innerHTML = '<div class="insight-loading"><div class="spinner"></div><span>正在发起知识演化分析...（可切换其他页面，完成后自动通知）</span></div>';
    await this._startInsightTask('evolutions');
  },

  _renderEvolutionsResult() {
    const container = document.getElementById('insightEvolutionContent');
    if (!container) return;

    if (this.data.evolutions.length === 0) {
      container.innerHTML = `
        <div class="insight-empty">
          <div class="insight-empty-icon">🌱</div>
          <div class="insight-empty-title">暂无演化记录</div>
          <div class="insight-empty-desc">当你持续积累知识、记忆后，知识演化时间线会自动记录知识的合并、更新和冲突事件。</div>
        </div>`;
      return;
    }

    container.innerHTML = `<div class="evolution-timeline">${this.data.evolutions.map(e => this._renderEvolutionNode(e)).join('')}</div>`;
  },

  _renderEvolutionsError(error) {
    const container = document.getElementById('insightEvolutionContent');
    if (!container) return;
    container.innerHTML = `
      <div class="insight-empty">
        <div class="insight-empty-icon">⚠️</div>
        <div class="insight-empty-title">演化分析失败</div>
        <div class="insight-empty-desc">${this._escapeHtml(error || '请稍后重试')}</div>
      </div>`;
  },

  _renderEvolutionNode(node) {
    const typeClass = node.type || 'new';
    return `
      <div class="evolution-node ${typeClass}">
        <div class="evolution-node-header">
          <span class="evolution-node-type ${typeClass}">${this._getTypeLabel(typeClass)}</span>
          <span class="evolution-node-date">${node.timeAgo || ''}</span>
        </div>
        <div class="evolution-node-content">${this._escapeHtml(node.content || '')}</div>
        ${node.detail ? `<div class="evolution-node-detail">${this._escapeHtml(node.detail)}</div>` : ''}
      </div>`;
  },

  // ========== 冲突检测 ==========
  async loadConflicts() {
    const container = document.getElementById('insightConflictContent');
    if (!container) return;

    // 先检查缓存和任务状态
    const state = await this._checkTaskState('conflict_detection');

    if (state.hasResult) {
      this.data.conflicts = state.result.items || [];
      this._renderConflictsResult();
      if (state.isRunning) {
        this._showToast('正在更新冲突检测...', 'info');
      }
      return;
    }

    if (state.isRunning) {
      container.innerHTML = '<div class="insight-loading"><div class="spinner"></div><span>AI 正在扫描知识冲突...（可切换其他页面，完成后自动通知）</span></div>';
      return;
    }

    // 无缓存无运行 → 尝试从本地文件加载旧缓存
    try {
      const localResult = await this._safeCall(
        () => window.electronAPI?.insightGetConflicts?.(),
        { items: [] }
      );
      this.data.conflicts = localResult.items || [];
      if (this.data.conflicts.length > 0) {
        this._renderConflictsResult();
        return;
      }
    } catch (_) {}

    // 完全没有数据
    container.innerHTML = `
      <div class="insight-empty">
        <div class="insight-empty-icon">✅</div>
        <div class="insight-empty-title">暂无知识冲突</div>
        <div class="insight-empty-desc">知识冲突检测会自动发现同一主题下的矛盾信息。点击"运行检测"主动扫描。</div>
      </div>
      <div style="text-align:center;margin-top:12px">
        <button class="activation-refresh-btn" id="runConflictDetectionBtn">运行冲突检测</button>
      </div>`;
  },

  _renderConflictsResult() {
    const container = document.getElementById('insightConflictContent');
    if (!container) return;

    if (this.data.conflicts.length === 0) {
      container.innerHTML = `
        <div class="insight-empty">
          <div class="insight-empty-icon">🎉</div>
          <div class="insight-empty-title">知识库一致性良好</div>
          <div class="insight-empty-desc">未发现知识冲突，所有知识条目相互一致。</div>
        </div>
        <div style="text-align:center;margin-top:12px">
          <button class="activation-refresh-btn" id="rerunConflictDetectionBtn">重新检测</button>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div style="text-align:center;margin-bottom:16px">
        <button class="activation-refresh-btn" id="rerunConflictDetectionBtn">重新检测</button>
      </div>
      ${this.data.conflicts.map(c => this._renderConflictCard(c)).join('')}`;
  },

  _renderConflictsError(error) {
    const container = document.getElementById('insightConflictContent');
    if (!container) return;
    container.innerHTML = `
      <div class="insight-empty">
        <div class="insight-empty-icon">⚠️</div>
        <div class="insight-empty-title">冲突检测失败</div>
        <div class="insight-empty-desc">${this._escapeHtml(error || '请稍后重试')}</div>
      </div>
      <div style="text-align:center;margin-top:12px">
        <button class="activation-refresh-btn" id="rerunConflictDetectionBtn">重新检测</button>
      </div>`;
  },

  async runConflictDetection() {
    const container = document.getElementById('insightConflictContent');
    if (!container) return;

    container.innerHTML = '<div class="insight-loading"><div class="spinner"></div><span>AI 正在扫描知识冲突...（可切换其他页面，完成后自动通知）</span></div>';

    // 发起异步任务
    await this._startInsightTask('conflict_detection');
  },

  _renderConflictCard(conflict) {
    return `
      <div class="conflict-card">
        <div class="conflict-header">
          <span class="conflict-icon">⚡</span>
          <span class="conflict-entity">${this._escapeHtml(conflict.entity || conflict.title || '')}</span>
          <span class="conflict-confidence">置信度 ${Math.round((conflict.confidence || 0.5) * 100)}%</span>
        </div>
        <div class="conflict-diff">
          <div class="conflict-diff-side old">
            <div class="conflict-diff-label">旧信息</div>
            ${this._escapeHtml(conflict.oldValue || conflict.old || '')}
          </div>
          <div class="conflict-diff-side new">
            <div class="conflict-diff-label">新信息</div>
            ${this._escapeHtml(conflict.newValue || conflict.new || '')}
          </div>
        </div>
        <div class="conflict-actions">
          <button class="activation-card-action primary" data-resolution="keep_new">保留新信息</button>
          <button class="activation-card-action" data-resolution="keep_old">保留旧信息</button>
          <button class="activation-card-action" data-resolution="keep_both">两者都保留</button>
        </div>
      </div>`;
  },

  async _resolveConflict(btn, resolution) {
    const card = btn.closest('.conflict-card');
    if (!card) return;

    try {
      await window.electronAPI?.insightResolveConflict?.({
        entity: card.querySelector('.conflict-entity')?.textContent,
        resolution
      });
      card.style.transition = 'all 0.3s ease';
      card.style.opacity = '0';
      card.style.transform = 'translateX(20px)';
      setTimeout(() => card.remove(), 300);
      this._showToast('冲突已解决', 'success');
    } catch (err) {
      console.error('[Insight] Resolve conflict error:', err);
      this._showToast('解决冲突失败：' + err.message, 'error');
    }
  },

  // ========== 工具方法 ==========
  _escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  },

  // ========== 多模态分布 ==========
  _renderMultimodalDistribution(byType, totalSize) {
    const sizeMB = (totalSize / 1024 / 1024).toFixed(1);
    const types = [
      { key: 'image', label: '图片', icon: '🖼', color: '#007AFF' },
      { key: 'document', label: '文档', icon: '📄', color: '#FF9500' },
      { key: 'audio', label: '音频', icon: '🎵', color: '#AF52DE' },
      { key: 'video', label: '视频', icon: '🎬', color: '#FF3B30' },
      { key: 'url', label: 'URL', icon: '🔗', color: '#34C759' },
      { key: 'meeting', label: '会议', icon: '📹', color: '#5856D6' }
    ];
    const total = Object.values(byType).reduce((s, v) => s + v, 0) || 1;

    let gradientParts = [];
    let currentP = 0;
    types.forEach(t => {
      const count = byType[t.key] || 0;
      if (count > 0) {
        const p = Math.round((count / total) * 100);
        gradientParts.push(`${t.color} ${currentP}% ${currentP + p}%`);
        currentP += p;
      }
    });
    const gradient = gradientParts.length > 0
      ? `conic-gradient(${gradientParts.join(', ')})`
      : 'conic-gradient(#ddd 0% 100%)';

    return `
      <div class="distribution-section">
        <h3>📚 多模态资产分布 <span style="font-size:11px;color:var(--text-tertiary,#aeaeb2);margin-left:8px">存储 ${sizeMB} MB</span></h3>
        <div class="distribution-row">
          <div class="distribution-chart" style="background:${gradient}">
            <div class="distribution-chart-center">
              <div class="value">${total}</div>
              <div class="label">总资产</div>
            </div>
          </div>
          <div class="distribution-legend">
            ${types.map(t => `
              <div class="distribution-legend-item">
                <span class="distribution-legend-dot" style="background:${t.color}"></span>
                ${t.icon} ${t.label}
                <span class="distribution-legend-value">${byType[t.key] || 0}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>`;
  },

  // ========== 多模态知识库 ==========
  async loadMultimodal() {
    const container = document.getElementById('insightMultimodalContent');
    if (!container) return;

    container.innerHTML = '<div class="insight-loading"><div class="spinner"></div><span>加载知识库...</span></div>';

    try {
      const [stats, assetsResult, booksResult] = await Promise.all([
        this._safeCall(() => window.electronAPI?.multimodalStats?.(), { total: 0, byType: {} }),
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

        <!-- 资产列表 -->
        <div class="mm-assets-section">
          <div class="activation-section-header">
            <h3>📚 资产库 <span style="font-size:12px;color:var(--text-tertiary,#aeaeb2);font-weight:400">${assetsResult.total || 0} 个</span></h3>
            <input type="text" id="mmSearchInput" class="mm-search-input" placeholder="搜索资产..." style="width:200px;padding:6px 12px;border-radius:8px;border:0.5px solid var(--border-color);background:var(--bg-glass,rgba(255,255,255,0.6));font-size:12px">
          </div>
          <div id="mmAssetsGrid" class="mm-assets-grid">
            ${this._renderAssets(this.data.multimodalAssets)}
          </div>
        </div>
      `;

      // 绑定搜索事件
      const searchInput = document.getElementById('mmSearchInput');
      if (searchInput) {
        let timer;
        searchInput.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(() => this._filterAssets(), 300);
        });
      }

      // 绑定文件选择事件
      const fileInput = document.getElementById('mmFileInput');
      if (fileInput) {
        fileInput.addEventListener('change', (e) => {
          const files = e.target.files;
          if (files && files.length > 0) {
            this._importDroppedFiles(files);
          }
          e.target.value = ''; // 重置以便重复选择
        });
      }

      console.log('[Insight] Multimodal loaded, events bound via global delegation');
    } catch (err) {
      console.error('[Insight] Multimodal load error:', err);
      container.innerHTML = `
        <div class="insight-empty">
          <div class="insight-empty-icon">⚠️</div>
          <div class="insight-empty-title">加载失败</div>
          <div class="insight-empty-desc">${this._escapeHtml(err.message || '请稍后重试')}</div>
          <button class="activation-refresh-btn" style="margin-top:12px" data-retry="loadMultimodal">重新加载</button>
        </div>`;
    }
  },

  _renderBooks(books) {
    if (!books || books.length === 0) {
      return `
        <div class="insight-empty" style="padding:24px">
          <div class="insight-empty-icon" style="font-size:32px">📖</div>
          <div class="insight-empty-desc">点击"生成知识体系"，AI 将根据你的知识库自动整理成一本书</div>
        </div>`;
    }
    return `<div class="mm-books-list">${books.map(book => `
      <div class="mm-book-card" data-book-id="${book.id}">
        <div class="mm-book-icon">📖</div>
        <div class="mm-book-info">
          <div class="mm-book-title">${this._escapeHtml(book.title || '未命名')}</div>
          <div class="mm-book-meta">${(book.chapters || []).length} 章 · ${book.atomCount || 0} 原子 · ${this._escapeHtml(this._formatTimeAgo(book.generatedAt))}</div>
        </div>
        <button class="mm-book-view-btn" data-book-id="${book.id}">查看</button>
      </div>`).join('')}</div>`;
  },

  _renderAssets(assets) {
    if (!assets || assets.length === 0) {
      return `
        <div class="insight-empty" style="padding:30px">
          <div class="insight-empty-icon" style="font-size:36px">📚</div>
          <div class="insight-empty-title">暂无资产</div>
          <div class="insight-empty-desc">点击"导入文件"添加图片、文档、音视频等，或拖拽文件到此区域</div>
        </div>`;
    }

    const typeIcons = { image: '🖼', audio: '🎵', video: '🎬', document: '📄', url: '🔗', meeting: '📹' };
    const typeColors = { image: '#007AFF', audio: '#AF52DE', video: '#FF3B30', document: '#FF9500', url: '#34C759', meeting: '#5856D6' };

    return assets.map(asset => {
      const icon = typeIcons[asset.type] || '📄';
      const color = typeColors[asset.type] || '#8E8E93';
      const sizeStr = asset.fileSize ? `${(asset.fileSize / 1024).toFixed(0)}KB` : '';
      const tags = (asset.tags || []).slice(0, 3).map(t => `<span class="mm-asset-tag">${this._escapeHtml(t)}</span>`).join('');
      const statusDot = asset.processingStatus === 'completed' ? '🟢' : asset.processingStatus === 'processing' ? '🟡' : asset.processingStatus === 'failed' ? '🔴' : '⚪';
      const safeId = asset.id || '';

      return `
        <div class="mm-asset-card" data-asset-id="${safeId}">
          <div class="mm-asset-header">
            <span class="mm-asset-icon" style="color:${color}">${icon}</span>
            <span class="mm-asset-type-badge" style="background:${color}15;color:${color}">${asset.type || 'unknown'}</span>
            <span class="mm-asset-status">${statusDot}</span>
          </div>
          <div class="mm-asset-title">${this._escapeHtml(asset.title || '未命名')}</div>
          ${asset.description ? `<div class="mm-asset-desc">${this._escapeHtml(asset.description.substring(0, 80))}</div>` : ''}
          <div class="mm-asset-footer">
            <span class="mm-asset-size">${sizeStr}</span>
            <span class="mm-asset-time">${this._formatTimeAgo(asset.createdAt)}</span>
            <div class="mm-asset-tags">${tags}</div>
          </div>
          <div class="mm-asset-actions">
            ${asset.filePath ? `<button class="mm-asset-action" data-action="open" data-asset-id="${safeId}">打开</button>` : ''}
            ${asset.type === 'url' && asset.url ? `<button class="mm-asset-action" data-action="visit" data-url="${this._escapeHtml(asset.url)}">访问</button>` : ''}
            <button class="mm-asset-action" data-action="process" data-asset-id="${safeId}">AI处理</button>
            <button class="mm-asset-action danger" data-action="delete" data-asset-id="${safeId}">删除</button>
          </div>
        </div>`;
    }).join('');
  },

  async _filterAssets() {
    const searchInput = document.getElementById('mmSearchInput');
    const keyword = searchInput?.value?.trim() || '';
    const result = await this._safeCall(
      () => window.electronAPI?.multimodalList?.({
        type: this.data.multimodalFilter,
        keyword: keyword || undefined,
        page: 1,
        pageSize: 50
      }),
      { assets: [] }
    );

    this.data.multimodalAssets = result.assets || [];
    const grid = document.getElementById('mmAssetsGrid');
    if (grid) grid.innerHTML = this._renderAssets(this.data.multimodalAssets);
  },

  async _importFiles() {
    try {
      const result = await this._safeCall(
        () => window.electronAPI?.multimodalPickFiles?.(),
        { files: [] }
      );
      if (!result.files || result.files.length === 0) return;

      let successCount = 0;
      let failCount = 0;
      for (const filePath of result.files) {
        try {
          const importResult = await window.electronAPI?.multimodalImport?.({ filePath });
          if (importResult?.success) successCount++;
          else failCount++;
        } catch (e) {
          failCount++;
        }
      }

      if (successCount > 0) {
        this._showToast(`成功导入 ${successCount} 个文件${failCount > 0 ? `，${failCount} 个失败` : ''}`, failCount > 0 ? 'warning' : 'success');
        this.loadMultimodal();
      } else if (failCount > 0) {
        this._showToast(`导入失败 ${failCount} 个文件`, 'error');
      }
    } catch (err) {
      console.error('[Insight] Import files error:', err);
      this._showToast('导入失败：' + err.message, 'error');
    }
  },

  _showAddUrlDialog() {
    let overlay = document.getElementById('mmUrlOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'mmUrlOverlay';
      overlay.className = 'mm-dialog-overlay';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="mm-dialog">
        <div class="mm-dialog-header">
          <h3>🔗 保存 URL</h3>
          <button class="mm-dialog-close" data-close="mmUrlOverlay">✕</button>
        </div>
        <div class="mm-dialog-body">
          <div class="mm-dialog-field">
            <label>URL 地址</label>
            <input type="url" id="mmUrlInput" placeholder="https://example.com" autofocus>
          </div>
          <div class="mm-dialog-field">
            <label>标题（可选）</label>
            <input type="text" id="mmUrlTitleInput" placeholder="页面标题">
          </div>
        </div>
        <div class="mm-dialog-footer">
          <button class="mm-dialog-btn cancel" data-close="mmUrlOverlay">取消</button>
          <button class="mm-dialog-btn confirm" id="mmUrlConfirmBtn">保存</button>
        </div>
      </div>`;
    overlay.style.display = 'flex';

    const confirmBtn = document.getElementById('mmUrlConfirmBtn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        const url = document.getElementById('mmUrlInput')?.value?.trim();
        const title = document.getElementById('mmUrlTitleInput')?.value?.trim() || url;
        if (!url) {
          this._showToast('请输入 URL 地址', 'warning');
          return;
        }
        overlay.style.display = 'none';
        try {
          await this._safeCall(
            () => window.electronAPI?.multimodalSaveUrl?.({ url, title }),
            null
          );
          this._showToast('URL 已保存', 'success');
          this.loadMultimodal();
        } catch (err) {
          this._showToast('保存URL失败：' + err.message, 'error');
        }
      });
    }

    // 回车确认
    document.getElementById('mmUrlInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirmBtn?.click();
    });
  },

  _showAddMeetingDialog() {
    let overlay = document.getElementById('mmMeetingOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'mmMeetingOverlay';
      overlay.className = 'mm-dialog-overlay';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="mm-dialog">
        <div class="mm-dialog-header">
          <h3>📹 会议记录</h3>
          <button class="mm-dialog-close" data-close="mmMeetingOverlay">✕</button>
        </div>
        <div class="mm-dialog-body">
          <div class="mm-dialog-field">
            <label>会议标题</label>
            <input type="text" id="mmMeetingTitleInput" value="腾讯会议 ${new Date().toLocaleDateString('zh-CN')}" autofocus>
          </div>
          <div class="mm-dialog-field">
            <label>转译文本（可选）</label>
            <textarea id="mmMeetingTranscriptInput" rows="6" placeholder="粘贴会议转译文本..." style="width:100%;padding:8px 12px;border-radius:8px;border:0.5px solid var(--border-color);background:var(--bg-glass,rgba(255,255,255,0.6));font-size:12px;resize:vertical;font-family:inherit"></textarea>
          </div>
        </div>
        <div class="mm-dialog-footer">
          <button class="mm-dialog-btn cancel" data-close="mmMeetingOverlay">取消</button>
          <button class="mm-dialog-btn confirm" id="mmMeetingConfirmBtn">保存</button>
        </div>
      </div>`;
    overlay.style.display = 'flex';

    const confirmBtn = document.getElementById('mmMeetingConfirmBtn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        const title = document.getElementById('mmMeetingTitleInput')?.value?.trim();
        const transcript = document.getElementById('mmMeetingTranscriptInput')?.value || '';
        if (!title) {
          this._showToast('请输入会议标题', 'warning');
          return;
        }
        overlay.style.display = 'none';
        try {
          await this._safeCall(
            () => window.electronAPI?.multimodalSaveMeeting?.({ title, transcript }),
            null
          );
          this._showToast('会议记录已保存', 'success');
          this.loadMultimodal();
        } catch (err) {
          this._showToast('保存会议记录失败：' + err.message, 'error');
        }
      });
    }
  },

  async _generateBook() {
    const btn = document.getElementById('mmGenBookBtn');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = '生成中...';

    try {
      const result = await this._safeCall(
        () => window.electronAPI?.multimodalGenerateBook?.({}),
        { success: false, error: '未知错误' }
      );
      console.log('[Insight] Generate book result:', {
        success: result?.success,
        bookId: result?.book?.id,
        bookTitle: result?.book?.title,
        bookChapters: result?.book?.chapters?.length || 0,
        error: result?.error
      });
      if (result?.success) {
        const chCount = result?.book?.chapters?.length || 0;
        if (chCount > 0) {
          this._showToast(`知识体系生成成功！共 ${chCount} 章`, 'success');
        } else {
          this._showToast('知识体系已生成，但 AI 未能返回有效的章节内容，请稍后重试', 'warning');
        }
        this.loadMultimodal();
      } else {
        this._showToast(result?.error || '生成失败', 'error');
      }
    } catch (err) {
      this._showToast('生成失败：' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '📝 生成知识体系';
    }
  },

  async _viewBook(bookId) {
    let book = this.data.multimodalBooks.find(b => b.id === bookId);

    // 如果内存中的 book 没有 chapters，尝试从后端重新获取完整数据
    if (book && (!book.chapters || book.chapters.length === 0)) {
      console.log('[Insight] Book has no chapters in memory, re-fetching from backend...', bookId);
      try {
        const booksResult = await this._safeCall(
          () => window.electronAPI?.multimodalGetBooks?.(),
          { books: [] }
        );
        const freshBook = (booksResult.books || []).find(b => b.id === bookId);
        if (freshBook && freshBook.chapters && freshBook.chapters.length > 0) {
          book = freshBook;
          // 更新内存中的数据
          const idx = this.data.multimodalBooks.findIndex(b => b.id === bookId);
          if (idx >= 0) this.data.multimodalBooks[idx] = freshBook;
          console.log('[Insight] Re-fetched book with', freshBook.chapters.length, 'chapters');
        }
      } catch (err) {
        console.warn('[Insight] Re-fetch book failed:', err.message);
      }
    }

    if (!book) return;

    // 创建弹窗显示书本内容
    let overlay = document.getElementById('mmBookOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'mmBookOverlay';
      overlay.className = 'mm-book-overlay';
      document.body.appendChild(overlay);
    }

    const chapters = (book.chapters || []).map((ch) => `
      <div class="mm-book-chapter">
        <h3 class="mm-book-ch-title">${this._escapeHtml(ch.title)}</h3>
        <p class="mm-book-ch-summary">${this._escapeHtml(ch.summary || '')}</p>
        ${(ch.sections || []).map((sec) => `
          <div class="mm-book-section">
            <h4>${this._escapeHtml(sec.title)}</h4>
            <p>${this._escapeHtml(sec.content || '')}</p>
          </div>`).join('')}
      </div>`).join('');

    overlay.innerHTML = `
      <div class="mm-book-modal">
        <div class="mm-book-modal-header">
          <h2>📖 ${this._escapeHtml(book.title)}</h2>
          <button class="mm-book-modal-close" id="mmBookModalCloseBtn">✕</button>
        </div>
        <div class="mm-book-modal-body">
          ${chapters || '<p style="color:var(--text-secondary)">暂无章节内容</p>'}
        </div>
      </div>`;
    overlay.style.display = 'flex';

    // 关闭按钮
    document.getElementById('mmBookModalCloseBtn')?.addEventListener('click', () => {
      overlay.style.display = 'none';
    });

    // 点击背景关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.style.display = 'none';
      }
    });
  },

  async _openAssetFile(id) {
    try {
      const result = await window.electronAPI?.multimodalOpenFile?.(id);
      if (!result?.success && result?.error) {
        this._showToast(result.error, 'error');
      }
    } catch (err) {
      this._showToast('打开文件失败：' + err.message, 'error');
    }
  },

  _openUrl(url) {
    if (url) {
      window.electronAPI?.openExternal?.(url);
    }
  },

  async _processAsset(id) {
    // Electron 屏蔽原生 confirm，改用 toast + 直接处理
    this._showToast('AI 正在处理中...请稍候', 'info');
    try {
      const result = await this._safeCall(
        () => window.electronAPI?.multimodalProcess?.(id),
        { success: false, error: '处理失败（无响应）' }
      );
      console.log('[Insight] _processAsset result:', result);
      if (result?.success) {
        this._showToast('AI 处理完成', 'success');
        this.loadMultimodal();
      } else {
        this._showToast(result?.error || '处理失败', 'error');
      }
    } catch (err) {
      console.error('[Insight] _processAsset error:', err);
      this._showToast('AI 处理失败：' + err.message, 'error');
    }
  },

  async _deleteAsset(id) {
    // Electron 屏蔽原生 confirm，改用自定义确认弹窗
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

  // 自定义确认弹窗（替代被 Electron 屏蔽的原生 confirm）
  _customConfirm(message) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:99999;';
      overlay.innerHTML = `
        <div style="background:#fff;border-radius:16px;padding:24px;max-width:400px;width:90%;box-shadow:0 24px 48px rgba(0,0,0,0.2);">
          <div style="font-size:15px;line-height:1.6;color:#1d1d1f;margin-bottom:20px;">${this._escapeHtml(message)}</div>
          <div style="display:flex;justify-content:flex-end;gap:8px;">
            <button class="cc-cancel" style="padding:8px 18px;border-radius:8px;border:1px solid #d2d2d7;background:#fff;cursor:pointer;font-size:14px;">取消</button>
            <button class="cc-ok" style="padding:8px 18px;border-radius:8px;border:none;background:#FF3B30;color:#fff;cursor:pointer;font-size:14px;">确认删除</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const cleanup = (val) => { overlay.remove(); resolve(val); };
      overlay.querySelector('.cc-ok').onclick = () => cleanup(true);
      overlay.querySelector('.cc-cancel').onclick = () => cleanup(false);
      overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
    });
  },

  _formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    try {
      const diff = Date.now() - new Date(dateStr).getTime();
      if (diff < 0) return '';
      const minutes = Math.floor(diff / 60000);
      if (minutes < 1) return '刚刚';
      if (minutes < 60) return `${minutes}分钟前`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}小时前`;
      const days = Math.floor(hours / 24);
      if (days < 30) return `${days}天前`;
      return `${Math.floor(days / 30)}个月前`;
    } catch (_) {
      return '';
    }
  }
};

window.Insight = Insight;
console.log('[Insight] Module loaded');
