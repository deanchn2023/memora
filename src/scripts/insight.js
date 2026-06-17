/**
 * Memora v2.4 — 洞察模块 (Insight Module)
 * 知识活化引擎 + 知识演化追踪 + 仪表盘 + 多模态知识库
 * 核心：AI 能力全部走 ADP 接口，客户端只做展示和交互
 */

const Insight = {
  currentTab: 'dashboard', // dashboard | activation | evolution | conflicts
  isLoading: false,
  data: {
    stats: null,
    activations: [],
    evolutions: [],
    conflicts: [],
    entityCloud: []
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

        // 关系人脉面板需要撑满容器（去除 padding/overflow）
        const insightContent = panel?.closest('.insight-content');
        if (insightContent) {
          insightContent.classList.toggle('fullscreen-panel', this.currentTab === 'relationship');
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

      // 知识演化按钮
      if (target.id === 'runEvolutionBtn' || target.id === 'rerunEvolutionBtn') {
        e.preventDefault();
        const container = document.getElementById('insightEvolutionContent');
        if (container) {
          container.innerHTML = '<div class="insight-loading"><div class="spinner"></div><span>AI 正在分析知识演化...（可切换其他页面，完成后自动通知）</span></div>';
        }
        this._startInsightTask('evolutions');
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

  // 展示 AI 处理结果弹窗
  _showProcessResult(title, details) {
    let modal = document.getElementById('insightProcessModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'insightProcessModal';
      modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10000;min-width:320px;max-width:480px;background:var(--bg-primary,#fff);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.3);padding:24px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;';
      document.body.appendChild(modal);
    }
    const detailHtml = details.map(d => `<div style="padding:6px 0;color:var(--text-secondary,#86868b);font-size:13px;line-height:1.5;white-space:pre-wrap;">${this._escapeHtml(d)}</div>`).join('<div style="border-top:0.5px solid var(--border-light,#e5e5ea);margin:4px 0;"></div>');
    modal.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="margin:0;font-size:16px;color:var(--text-primary,#1d1d1f);">${this._escapeHtml(title)}</h3>
        <button id="insightProcessModalClose" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-tertiary,#aeaeb2);padding:4px 8px;">✕</button>
      </div>
      <div>${detailHtml}</div>
    `;
    // 添加背景遮罩
    let overlay = document.getElementById('insightProcessOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'insightProcessOverlay';
      overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:9999;';
      document.body.appendChild(overlay);
    }
    overlay.style.display = '';
    modal.style.display = '';
    const close = () => {
      modal.style.display = 'none';
      overlay.style.display = 'none';
    };
    document.getElementById('insightProcessModalClose')?.addEventListener('click', close);
    overlay.addEventListener('click', close);
    // 10秒后自动关闭
    clearTimeout(this._processModalTimer);
    this._processModalTimer = setTimeout(close, 10000);
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
        case 'activation': this.loadActivations(); break;
        case 'evolution': this.loadEvolutions(); break;
        case 'conflicts': this.loadConflicts(); break;
        case 'relationship': window.Relationship?.load(); break;
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
      const [knowledgeStats, memoryStats, graphStats] = await Promise.all([
        this._safeCall(() => window.electronAPI?.knowledgeGetStats?.(), { totalAtoms: 0, totalClusters: 0, totalArticles: 0 }),
        this._safeCall(() => window.electronAPI?.getMemoryStats?.(), { total: 0, byType: {} }),
        this._safeCall(() => window.electronAPI?.graphStats?.(), { nodeCount: 0, edgeCount: 0 })
      ]);

      this.data.stats = { knowledgeStats, memoryStats, graphStats };

      container.innerHTML = `
        <div class="dashboard-grid">
          ${this._renderStatCard('🧠', '知识原子', knowledgeStats.totalAtoms || 0, '个')}
          <span class="stat-dot">·</span>
          ${this._renderStatCard('🔗', '知识簇', knowledgeStats.totalClusters || 0, '个')}
          <span class="stat-dot">·</span>
          ${this._renderStatCard('📝', '知识文章', knowledgeStats.totalArticles || 0, '篇')}
          <span class="stat-dot">·</span>
          ${this._renderStatCard('💭', '记忆总数', memoryStats.total || 0, '条')}
          <span class="stat-dot">·</span>
          ${this._renderStatCard('🕸', '图谱实体', graphStats.nodeCount || 0, '个')}
          <span class="stat-dot">·</span>
          ${this._renderStatCard('↔️', '图谱关系', graphStats.edgeCount || 0, '条')}
        </div>

        ${this._renderDistribution(memoryStats)}

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
    return `<span class="stat-item"><span class="stat-num">${value}</span> ${label}</span>`;
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
        </div>`;
      return;
    }

    container.innerHTML = this.data.activations.map(item => this._renderActivationCard(item)).join('');
  },

  _renderActivationsError(error) {
    const container = document.getElementById('insightActivationContent');
    if (!container) return;
    container.innerHTML = `
      <div class="insight-empty">
        <div class="insight-empty-icon">⚠️</div>
        <div class="insight-empty-title">活化分析失败</div>
        <div class="insight-empty-desc">${this._escapeHtml(error || '请稍后重试')}</div>
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

    // 尝试从本地加载历史演化记录
    try {
      const localResult = await this._safeCall(
        () => window.electronAPI?.insightGetEvolutions?.(),
        { items: [] }
      );
      this.data.evolutions = localResult.items || [];
      if (this.data.evolutions.length > 0) {
        this._renderEvolutionsResult();
        return;
      }
    } catch (_) {}

    // 无缓存无运行 → 显示空状态+按钮，不自动发起任务
    container.innerHTML = `
      <div class="insight-empty">
        <div class="insight-empty-icon">🌱</div>
        <div class="insight-empty-title">暂无演化记录</div>
        <div class="insight-empty-desc">知识演化分析会追踪知识的合并、更新和冲突事件。点击"开始演化分析"主动触发。</div>
      </div>
      <div style="text-align:center;margin-top:12px">
        <button class="activation-refresh-btn" id="runEvolutionBtn">开始演化分析</button>
      </div>`;
  },

  _renderEvolutionsResult() {
    const container = document.getElementById('insightEvolutionContent');
    if (!container) return;

    if (this.data.evolutions.length === 0) {
      container.innerHTML = `
        <div class="insight-empty">
          <div class="insight-empty-icon">🌱</div>
          <div class="insight-empty-title">暂无演化记录</div>
          <div class="insight-empty-desc">知识演化分析会追踪知识的合并、更新和冲突事件。点击"开始演化分析"主动触发。</div>
        </div>
        <div style="text-align:center;margin-top:12px">
          <button class="activation-refresh-btn" id="runEvolutionBtn">开始演化分析</button>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div style="text-align:center;margin-bottom:12px">
        <button class="activation-refresh-btn" id="rerunEvolutionBtn">重新分析</button>
      </div>
      <div class="evolution-timeline">${this.data.evolutions.map(e => this._renderEvolutionNode(e)).join('')}</div>`;
  },

  _renderEvolutionsError(error) {
    const container = document.getElementById('insightEvolutionContent');
    if (!container) return;
    container.innerHTML = `
      <div class="insight-empty">
        <div class="insight-empty-icon">⚠️</div>
        <div class="insight-empty-title">演化分析失败</div>
        <div class="insight-empty-desc">${this._escapeHtml(error || '请稍后重试')}</div>
      </div>
      <div style="text-align:center;margin-top:12px">
        <button class="activation-refresh-btn" id="runEvolutionBtn">重试</button>
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
