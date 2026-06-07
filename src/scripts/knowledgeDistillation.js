/**
 * 知识萃取 - 前端逻辑
 * 负责：知识图谱视图、知识簇管理、原子展示、文章阅读
 */

class KnowledgeDistillation {
  constructor() {
    this.atoms = [];
    this.clusters = [];
    this.articles = [];
    this.questions = []; // 未解答问题
    this.domains = [];
    this.stats = {};
    this.currentDomain = null;
    this.currentCluster = null;
    this.initialized = false;
    this.activeSubview = 'graph'; // graph / articles / questions / search / article-detail / cluster-detail
    this.previousSubview = 'graph'; // 记录上一个子视图，用于返回
  }

  init() {
    this.bindEvents();
    this.setupIPCListeners();
    this.loadStats();
    this.initialized = true;
    console.log('[KnowledgeDistillation] Initialized');
  }

  onShow() {
    this.loadStats();
    this.loadClusters();
    this.loadArticles();
    this.loadQuestions();
    // 重新绑定直接按钮（视图切换后 DOM 可能已变化）
    this._bindDirectButtons();
  }

  // ========== 事件绑定 ==========

  bindEvents() {
    // 使用事件委托，绑定在 knowledgeView 容器上，避免重复绑定
    const knowledgeView = document.getElementById('knowledgeView');
    if (!knowledgeView) {
      console.warn('[KnowledgeDistillation] knowledgeView not found');
      return;
    }

    // 如果已经委托绑定过，跳过
    if (knowledgeView._kdDelegated) return;
    knowledgeView._kdDelegated = true;

    knowledgeView.addEventListener('click', (e) => {
      const target = e.target;

      // 子视图 Tab 切换
      const tab = target.closest('[data-knowledge-tab]');
      if (tab) {
        const view = tab.dataset.knowledgeTab;
        this.switchSubview(view);
        return;
      }

      // 一键萃取
      if (target.closest('#knowledgeDistillBtn')) {
        this.distillAll();
        return;
      }

      // 新建簇
      if (target.closest('#knowledgeCreateClusterBtn')) {
        this.showCreateClusterModal();
        return;
      }

      // 记录问题
      if (target.closest('#knowledgeAddQuestionBtn')) {
        this.showAddQuestionModal();
        return;
      }

      // 返回按钮
      if (target.closest('#knowledgeDetailBack')) {
        this.switchSubview(this.previousSubview);
        return;
      }

      // 内联 onclick 按钮的兼容处理（通过 data-kd-action 属性）
      const actionBtn = target.closest('[data-kd-action]');
      if (actionBtn) {
        const action = actionBtn.dataset.kdAction;
        const id = actionBtn.dataset.kdId;
        if (action && typeof this[action] === 'function') {
          this[action](id);
        }
        return;
      }
    });

    // 领域筛选（change 事件需要单独处理）
    const domainFilter = document.getElementById('knowledgeDomainFilter');
    if (domainFilter && !domainFilter._kdBound) {
      domainFilter._kdBound = true;
      domainFilter.addEventListener('change', (e) => {
        this.currentDomain = e.target.value || null;
        this.loadClusters();
      });
    }

    // 搜索输入框
    const searchInput = document.getElementById('knowledgeGraphSearch');
    if (searchInput && !searchInput._kdBound) {
      searchInput._kdBound = true;
      searchInput.addEventListener('input', (e) => {
        this.filterClusters(e.target.value);
      });
    }

    // 问题搜索输入框
    const questionSearchInput = document.getElementById('knowledgeQuestionSearch');
    if (questionSearchInput && !questionSearchInput._kdBound) {
      questionSearchInput._kdBound = true;
      questionSearchInput.addEventListener('input', (e) => {
        this.filterQuestions(e.target.value);
      });
    }

    // 直接绑定关键按钮（防止事件委托失效）
    this._bindDirectButtons();
  }

  _bindDirectButtons() {
    // 直接绑定按钮，作为事件委托的备选方案
    const createClusterBtn = document.getElementById('knowledgeCreateClusterBtn');
    if (createClusterBtn && !createClusterBtn._kdDirectBound) {
      createClusterBtn._kdDirectBound = true;
      createClusterBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showCreateClusterModal();
      });
    }

    const addQuestionBtn = document.getElementById('knowledgeAddQuestionBtn');
    if (addQuestionBtn && !addQuestionBtn._kdDirectBound) {
      addQuestionBtn._kdDirectBound = true;
      addQuestionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showAddQuestionModal();
      });
    }

    const distillBtn = document.getElementById('knowledgeDistillBtn');
    if (distillBtn && !distillBtn._kdDirectBound) {
      distillBtn._kdDirectBound = true;
      distillBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.distillAll();
      });
    }
  }

  setupIPCListeners() {
    if (window.electronAPI?.onKnowledgeAtomsUpdated) {
      window.electronAPI.onKnowledgeAtomsUpdated(() => {
        this.loadStats();
        this.loadClusters();
      });
    }
    if (window.electronAPI?.onKnowledgeClustersUpdated) {
      window.electronAPI.onKnowledgeClustersUpdated(() => {
        this.loadClusters();
      });
    }
    if (window.electronAPI?.onKnowledgeArticleGenerated) {
      window.electronAPI.onKnowledgeArticleGenerated((data) => {
        this.loadArticles();
        this.loadClusters();
        this.showToast('知识文章已生成：' + (data.article?.title || ''));
      });
    }
  }

  // ========== 子视图切换 ==========

  switchSubview(view) {
    // 记住上一个视图（仅当离开详情类视图时不覆盖）
    if (!['article-detail', 'cluster-detail'].includes(this.activeSubview)) {
      this.previousSubview = this.activeSubview;
    }

    this.activeSubview = view;

    // 切换 tab 激活状态
    document.querySelectorAll('[data-knowledge-tab]').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.knowledgeTab === view);
    });

    // 切换视图
    const graphView = document.getElementById('knowledgeGraphView');
    const articlesView = document.getElementById('knowledgeArticlesView');
    const questionsView = document.getElementById('knowledgeQuestionsView');
    const searchView = document.getElementById('knowledgeSearchView');
    const detailView = document.getElementById('knowledgeDetailView');

    if (graphView) graphView.classList.toggle('hidden', view !== 'graph');
    if (articlesView) articlesView.classList.toggle('hidden', view !== 'articles');
    if (questionsView) questionsView.classList.toggle('hidden', view !== 'questions');
    if (searchView) searchView.classList.toggle('hidden', view !== 'search');
    // 详情视图在 article-detail 和 cluster-detail 时都显示
    if (detailView) detailView.classList.toggle('hidden', !['article-detail', 'cluster-detail'].includes(view));

    if (view === 'graph') this.loadClusters();
    if (view === 'articles') this.loadArticles();
    if (view === 'questions') this.loadQuestions();
    if (view === 'search' && window.knowledgeFollow) {
      window.knowledgeFollow.init();
      window.knowledgeFollow.onShow();
    }
  }

  // ========== 数据加载 ==========

  async loadStats() {
    try {
      if (window.electronAPI?.knowledgeGetStats) {
        this.stats = await window.electronAPI.knowledgeGetStats();
      }
      if (window.electronAPI?.knowledgeGetDomains) {
        const result = await window.electronAPI.knowledgeGetDomains();
        this.domains = result.domains || [];
      }
      // 加载问题数量用于统计
      if (window.electronAPI?.knowledgeGetAtoms) {
        const qResult = await window.electronAPI.knowledgeGetAtoms({ type: 'question' });
        this.questions = qResult.atoms || [];
      }
      this.renderStats();
      this.renderDomainFilter();
    } catch (e) {
      console.error('[KnowledgeDistillation] loadStats error:', e);
    }
  }

  async loadClusters() {
    try {
      const filter = {};
      if (this.currentDomain) filter.domain = this.currentDomain;
      if (window.electronAPI?.knowledgeGetClusters) {
        const result = await window.electronAPI.knowledgeGetClusters(filter);
        this.clusters = result.clusters || [];
      }
      // 同时加载未归簇的原子
      if (window.electronAPI?.knowledgeGetAtoms) {
        const atomResult = await window.electronAPI.knowledgeGetAtoms({ unclustered: true });
        this.atoms = atomResult.atoms || [];
      }
      this.renderClusterGrid();
    } catch (e) {
      console.error('[KnowledgeDistillation] loadClusters error:', e);
    }
  }

  async loadArticles() {
    try {
      if (window.electronAPI?.knowledgeGetArticles) {
        const result = await window.electronAPI.knowledgeGetArticles({});
        this.articles = result.articles || [];
      }
      this.renderArticleList();
    } catch (e) {
      console.error('[KnowledgeDistillation] loadArticles error:', e);
    }
  }

  async loadQuestions() {
    try {
      if (window.electronAPI?.knowledgeGetAtoms) {
        const result = await window.electronAPI.knowledgeGetAtoms({ type: 'question' });
        this.questions = result.atoms || [];
      }
      this.renderQuestionList();
    } catch (e) {
      console.error('[KnowledgeDistillation] loadQuestions error:', e);
    }
  }

  // ========== 渲染 ==========

  renderStats() {
    const statsEl = document.getElementById('knowledgeStats');
    if (!statsEl) return;
    const s = this.stats;
    const questionCount = this.questions.length || (s.totalAtoms ? s.unclusteredAtoms : 0);
    statsEl.innerHTML = `
      <span class="stat-item"><span class="stat-num">${s.totalAtoms || 0}</span> 知识原子</span>
      <span class="stat-dot">·</span>
      <span class="stat-item"><span class="stat-num">${s.totalClusters || 0}</span> 知识簇</span>
      <span class="stat-dot">·</span>
      <span class="stat-item"><span class="stat-num">${s.totalArticles || 0}</span> 知识文章</span>
      <span class="stat-dot">·</span>
      <span class="stat-item"><span class="stat-num">${questionCount}</span> 待解决</span>
    `;
  }

  renderDomainFilter() {
    const select = document.getElementById('knowledgeDomainFilter');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">全部领域</option>' +
      this.domains.map(d => `<option value="${d}" ${d === current ? 'selected' : ''}>${d}</option>`).join('');
  }

  renderClusterGrid() {
    const grid = document.getElementById('knowledgeClusterGrid');
    if (!grid) return;

    if (this.clusters.length === 0 && this.atoms.length === 0) {
      grid.innerHTML = `
        <div class="knowledge-empty">
          <div class="empty-icon">🧠</div>
          <p>暂无知识簇</p>
          <span class="empty-hint">复制内容到剪贴板，系统会自动提取知识原子并聚类</span>
        </div>`;
      return;
    }

    let html = '';

    // 知识簇卡片
    for (const cluster of this.clusters) {
      const statusMap = {
        growing: { icon: '🔵', label: '积累中', cls: 'status-growing' },
        mature: { icon: '🟡', label: '可萃取', cls: 'status-mature' },
        distilled: { icon: '🟢', label: '已萃取', cls: 'status-distilled' }
      };
      const st = statusMap[cluster.status] || statusMap.growing;
      const atomCount = (cluster.atom_ids || []).length;

      html += `
        <div class="kd-cluster-card ${st.cls}" data-cluster-id="${cluster.id}">
          <div class="kd-cluster-header">
            <span class="kd-cluster-status">${st.icon}</span>
            <h4 class="kd-cluster-name">${this.escHtml(cluster.name)}</h4>
          </div>
          <p class="kd-cluster-desc">${this.escHtml(cluster.description || cluster.domain)}</p>
          <div class="kd-cluster-meta">
            <span class="kd-meta-item">${atomCount} 原子</span>
            <span class="kd-meta-item">${st.label}</span>
          </div>
          <div class="kd-cluster-keywords">
            ${(cluster.keywords || []).slice(0, 3).map(k => `<span class="kd-keyword">${this.escHtml(k)}</span>`).join('')}
          </div>
          <div class="kd-cluster-actions">
            <button class="kd-action-btn" data-kd-action="viewClusterDetail" data-kd-id="${cluster.id}">查看</button>
            ${cluster.status === 'mature' || (atomCount >= 2 && cluster.status === 'growing') ? `<button class="kd-action-btn primary" data-kd-action="generateArticle" data-kd-id="${cluster.id}">生成文章</button>` : ''}
            ${cluster.status === 'distilled' ? `<button class="kd-action-btn" data-kd-action="viewArticle" data-kd-id="${cluster.article_id}">阅读文章</button>` : ''}
          </div>
        </div>`;
    }

    // 未归簇原子
    if (this.atoms.length > 0) {
      html += `
        <div class="kd-cluster-card status-unclustered">
          <div class="kd-cluster-header">
            <span class="kd-cluster-status">⚪</span>
            <h4 class="kd-cluster-name">待整理</h4>
          </div>
          <p class="kd-cluster-desc">${this.atoms.length} 个知识原子待归类</p>
          <div class="kd-cluster-meta">
            <span class="kd-meta-item">${this.atoms.length} 原子</span>
            <span class="kd-meta-item">待聚类</span>
          </div>
          <div class="kd-cluster-actions">
            <button class="kd-action-btn primary" data-kd-action="autoCluster">智能聚类</button>
          </div>
        </div>`;
    }

    grid.innerHTML = html;
  }

  renderArticleList() {
    const list = document.getElementById('knowledgeArticleList');
    if (!list) return;

    if (this.articles.length === 0) {
      list.innerHTML = `
        <div class="knowledge-empty">
          <div class="empty-icon">📚</div>
          <p>暂无知识文章</p>
          <span class="empty-hint">知识簇成熟后可生成文章</span>
        </div>`;
      return;
    }

    list.innerHTML = this.articles.map(article => `
      <div class="kd-article-card" data-article-id="${article.id}">
        <h4 class="kd-article-title">${this.escHtml(article.title)}</h4>
        <div class="kd-article-meta">
          <span>${article.atom_count || 0} 原子</span>
          <span>${article.source_note_count || 0} 条来源</span>
          <span>${this.formatDate(article.created_at)}</span>
        </div>
        <div class="kd-article-tags">
          ${(article.tags || []).map(t => `<span class="kd-keyword">${this.escHtml(t)}</span>`).join('')}
        </div>
        <div class="kd-article-actions">
          <button class="kd-action-btn" data-kd-action="viewArticle" data-kd-id="${article.id}">阅读</button>
          <button class="kd-action-btn" data-kd-action="exportArticle" data-kd-id="${article.id}">导出</button>
        </div>
      </div>
    `).join('');
  }

  renderQuestionList() {
    const list = document.getElementById('knowledgeQuestionList');
    if (!list) return;

    if (this.questions.length === 0) {
      list.innerHTML = `
        <div class="knowledge-empty">
          <div class="empty-icon">❓</div>
          <p>暂无待解决问题</p>
          <span class="empty-hint">记录工作中遇到的问题，后续集中解决形成知识</span>
        </div>`;
      return;
    }

    list.innerHTML = this.questions.map(q => {
      const resolved = q.cluster_id ? true : false;
      return `
        <div class="kd-question-card ${resolved ? 'resolved' : 'pending'}" data-atom-id="${q.id}">
          <div class="kd-question-header">
            <span class="kd-question-status">${resolved ? '✅' : '❓'}</span>
            <span class="kd-question-domain">${this.escHtml(q.domain)}</span>
          </div>
          <p class="kd-question-content">${this.escHtml(q.content)}</p>
          <div class="kd-question-meta">
            <span>${this.formatRelativeTime(q.created_at)}</span>
            <span title="${q.created_at}">${resolved ? '已解决' : '待解决'}</span>
          </div>
          <div class="kd-question-actions">
            ${!resolved ? `<button class="kd-action-btn primary" data-kd-action="resolveQuestion" data-kd-id="${q.id}">💡 寻找答案</button>` : ''}
            <button class="kd-action-btn" data-kd-action="viewAtomDetail" data-kd-id="${q.id}">查看</button>
            <button class="kd-action-btn danger" data-kd-action="deleteAtom" data-kd-id="${q.id}">删除</button>
          </div>
        </div>`;
    }).join('');
  }

  // ========== 操作 ==========

  async viewClusterDetail(clusterId) {
    try {
      if (!window.electronAPI?.knowledgeGetClusterById) return;
      const result = await window.electronAPI.knowledgeGetClusterById(clusterId);
      if (!result.cluster) return;

      this.currentCluster = result;
      this.renderClusterDetail(result);
      this.switchSubview('cluster-detail');
    } catch (e) {
      console.error('[KnowledgeDistillation] viewClusterDetail error:', e);
    }
  }

  renderClusterDetail(data) {
    const { cluster, atoms } = data;
    const detailContent = document.getElementById('knowledgeDetailContent');
    if (!detailContent) return;

    const statusMap = {
      growing: { icon: '🔵', label: '积累中' },
      mature: { icon: '🟡', label: '可萃取' },
      distilled: { icon: '🟢', label: '已萃取' }
    };
    const st = statusMap[cluster.status] || statusMap.growing;

    const typeMap = {
      fact: { icon: '📋', label: '事实' },
      rule: { icon: '🔴', label: '规则' },
      insight: { icon: '💡', label: '洞察' },
      procedure: { icon: '🔧', label: '步骤' },
      question: { icon: '❓', label: '问题' }
    };

    detailContent.innerHTML = `
      <div class="kd-detail-header">
        <h3>${this.escHtml(cluster.name)}</h3>
        <span class="kd-detail-status">${st.icon} ${st.label}</span>
      </div>
      <p class="kd-detail-desc">${this.escHtml(cluster.description || '')}</p>
      <div class="kd-detail-meta">
        <span>领域：${this.escHtml(cluster.domain)}</span>
        <span>${atoms.length} 个知识原子</span>
      </div>

      <div class="kd-detail-section">
        <h4>📝 知识原子</h4>
        <div class="kd-atom-list">
          ${atoms.length === 0 ? '<p class="kd-empty-text">暂无知识原子</p>' :
            atoms.map(atom => {
              const tp = typeMap[atom.type] || typeMap.fact;
              return `
                <div class="kd-atom-item" data-atom-id="${atom.id}">
                  <span class="kd-atom-type">${tp.icon} ${tp.label}</span>
                  <span class="kd-atom-content">${this.escHtml(atom.content)}</span>
                  <span class="kd-atom-importance">${atom.importance}</span>
                  <button class="kd-atom-delete" data-kd-action="deleteAtom" data-kd-id="${atom.id}" title="删除">×</button>
                </div>`;
            }).join('')
          }
        </div>
      </div>

      ${cluster.article_id ? `
        <div class="kd-detail-section">
          <h4>📄 知识文章</h4>
          <button class="kd-action-btn" data-kd-action="viewArticle" data-kd-id="${cluster.article_id}">阅读文章</button>
        </div>` : ''}

      <div class="kd-detail-section" id="kdClusterSourceNotes">
        <h4>📎 原始笔记</h4>
        <div class="kd-source-notes">
          ${this.renderSourceNotes(atoms)}
        </div>
      </div>

      <div class="kd-detail-actions">
        ${cluster.status === 'mature' || (atoms.length >= 2 && cluster.status === 'growing') ? `<button class="kd-action-btn primary" data-kd-action="generateArticle" data-kd-id="${cluster.id}">生成文章</button>` : ''}
        ${cluster.status === 'distilled' ? `<button class="kd-action-btn" data-kd-action="regenerateArticle" data-kd-id="${cluster.id}">重新萃取</button>` : ''}
        <button class="kd-action-btn danger" data-kd-action="deleteCluster" data-kd-id="${cluster.id}">删除簇</button>
      </div>
    `;
  }

  renderSourceNotes(atoms) {
    const noteIds = new Set();
    for (const atom of atoms) {
      for (const nid of (atom.source_note_ids || [])) noteIds.add(nid);
    }
    if (noteIds.size === 0) return '<p class="kd-empty-text">无关联笔记</p>';
    return `<span class="kd-source-count">${noteIds.size} 条笔记</span>`;
  }

  async viewArticle(articleId) {
    if (!articleId || !window.electronAPI?.knowledgeGetArticle) return;
    try {
      const result = await window.electronAPI.knowledgeGetArticle(articleId);
      if (!result.article) return;

      this.renderArticleDetail(result.article);
      this.switchSubview('article-detail');
    } catch (e) {
      console.error('[KnowledgeDistillation] viewArticle error:', e);
    }
  }

  renderArticleDetail(article) {
    const detailContent = document.getElementById('knowledgeDetailContent');
    if (!detailContent) return;

    detailContent.innerHTML = `
      <div class="kd-detail-header">
        <h3>${this.escHtml(article.title)}</h3>
        <div class="kd-detail-meta">
          <span>${article.atom_count || 0} 原子</span>
          <span>v${article.version || 1}</span>
          <span>${this.formatDate(article.created_at)}</span>
        </div>
      </div>
      <div class="kd-article-tags">
        ${(article.tags || []).map(t => `<span class="kd-keyword">${this.escHtml(t)}</span>`).join('')}
      </div>
      <div class="kd-article-content markdown-body">
        ${this.renderMarkdown(article.content || '')}
      </div>
      <div class="kd-detail-actions">
        <button class="kd-action-btn" data-kd-action="exportArticle" data-kd-id="${article.id}">导出 MD</button>
        <button class="kd-action-btn danger" data-kd-action="deleteArticle" data-kd-id="${article.id}">删除</button>
      </div>
    `;
  }

  async generateArticle(clusterId) {
    if (!window.electronAPI?.knowledgeGenerateArticle) return;
    this.showActionProgress('正在生成知识文章...', 'AI 正在分析知识簇并合成文章');
    try {
      const result = await window.electronAPI.knowledgeGenerateArticle(clusterId);
      this.hideActionProgress();
      if (result.success) {
        this.showToast('文章生成成功！');
        this.loadClusters();
        this.loadArticles();
        // 自动打开文章
        if (result.article) {
          this.viewArticle(result.article.id);
        }
      } else {
        this.showToast('生成失败：' + (result.error || '未知错误'));
      }
    } catch (e) {
      this.hideActionProgress();
      this.showToast('生成出错：' + e.message);
    }
  }

  async autoCluster() {
    if (!window.electronAPI?.knowledgeAutoCluster) return;

    // 记录聚类前的簇 ID，用于后续高亮新建的簇
    const beforeClusterIds = new Set(this.clusters.map(c => c.id));

    // 先注册完成监听（防止竞态：IPC 返回前事件就已发出）
    let completeFired = false;
    const completeHandler = async (data) => {
      if (completeFired) return; // 防止重复触发
      completeFired = true;

      // 清理监听
      if (window.electronAPI?.removeKnowledgeClusteringCompleteListeners) {
        window.electronAPI.removeKnowledgeClusteringCompleteListeners();
      }

      // 刷新所有数据
      await Promise.all([
        this.loadClusters(),
        this.loadStats(),
        this.loadArticles()
      ]);

      // 找出新建的簇
      const newClusters = this.clusters.filter(c => !beforeClusterIds.has(c.id));

      // 隐藏进度，显示结果
      this.hideClusteringProgress();
      this.showClusteringResult(data, newClusters);
    };

    if (window.electronAPI?.onKnowledgeClusteringComplete) {
      window.electronAPI.onKnowledgeClusteringComplete(completeHandler);
    }

    // 显示进度面板
    this.showClusteringProgress();

    try {
      // 异步启动聚类（IPC 立即返回，不等待完成）
      const startResult = await window.electronAPI.knowledgeAutoCluster();
      if (!startResult.started) {
        // 清理监听
        if (window.electronAPI?.removeKnowledgeClusteringCompleteListeners) {
          window.electronAPI.removeKnowledgeClusteringCompleteListeners();
        }
        this.hideClusteringProgress();
        this.showClusteringResult({ clustersCreated: 0, atomsAssigned: 0, message: startResult.message || '无法启动聚类' }, []);
        return;
      }

    } catch (e) {
      if (window.electronAPI?.removeKnowledgeClusteringCompleteListeners) {
        window.electronAPI.removeKnowledgeClusteringCompleteListeners();
      }
      this.hideClusteringProgress();
      this.showClusteringResult({ clustersCreated: 0, atomsAssigned: 0, message: '聚类出错：' + e.message }, []);
    }
  }

  cancelClustering() {
    if (window.electronAPI?.knowledgeCancelClustering) {
      window.electronAPI.knowledgeCancelClustering();
      this._updateClusteringProgressText('正在取消...');
    }
  }

  showClusteringProgress() {
    const grid = document.getElementById('knowledgeClusterGrid');
    if (!grid) return;

    // 移除旧进度
    const old = document.getElementById('kdClusteringProgress');
    if (old) old.remove();

    const progressEl = document.createElement('div');
    progressEl.id = 'kdClusteringProgress';
    progressEl.className = 'kd-clustering-progress';
    progressEl.innerHTML = `
      <div class="kd-clustering-inner">
        <div class="kd-clustering-spinner"></div>
        <h4 class="kd-clustering-title">🧠 智能聚类进行中</h4>
        <div class="kd-clustering-batch-progress">
          <div class="kd-batch-bar-track">
            <div class="kd-batch-bar-fill" id="kdBatchBarFill" style="width: 0%"></div>
          </div>
          <div class="kd-batch-info">
            <span id="kdBatchProgress">准备中...</span>
            <span id="kdBatchAtomCount">0 个原子已归类</span>
          </div>
        </div>
        <p class="kd-clustering-status" id="kdClusteringStatus">正在分析知识原子...</p>
        <button class="kd-clustering-cancel-btn" id="kdCancelClusteringBtn">取消聚类</button>
      </div>
    `;
    grid.prepend(progressEl);

    // 绑定取消按钮
    const cancelBtn = document.getElementById('kdCancelClusteringBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.cancelClustering());
    }

    // 监听后端进度推送
    if (window.electronAPI?.onKnowledgeClusteringProgress) {
      this._clusteringProgressHandler = (data) => {
        this._handleClusteringProgress(data);
      };
      window.electronAPI.onKnowledgeClusteringProgress(this._clusteringProgressHandler);
    }
  }

  _handleClusteringProgress(data) {
    if (data.done) {
      // 聚类完成 — 进度条拉满，但结果展示由 clustering-complete 事件处理
      const barFill = document.getElementById('kdBatchBarFill');
      if (barFill) barFill.style.width = '100%';
      const progressText = document.getElementById('kdBatchProgress');
      if (progressText) progressText.textContent = '聚类完成';
      const atomCount = document.getElementById('kdBatchAtomCount');
      if (atomCount) atomCount.textContent = `${data.atomsAssigned || 0} 个原子已归类`;
      const statusEl = document.getElementById('kdClusteringStatus');
      if (statusEl) statusEl.textContent = `新建 ${data.clustersCreated || 0} 个知识簇`;
      // 隐藏取消按钮
      const cancelBtn = document.getElementById('kdCancelClusteringBtn');
      if (cancelBtn) cancelBtn.style.display = 'none';
      return;
    }

    // 更新进度条
    const { currentBatch, totalBatches, atomsAssigned, message } = data;
    const progress = totalBatches > 0 ? (currentBatch / totalBatches * 100) : 0;

    const barFill = document.getElementById('kdBatchBarFill');
    if (barFill) barFill.style.width = `${progress}%`;

    const progressText = document.getElementById('kdBatchProgress');
    if (progressText) progressText.textContent = currentBatch > 0 ? `${currentBatch}/${totalBatches} 批` : '准备中...';

    const atomCount = document.getElementById('kdBatchAtomCount');
    if (atomCount) atomCount.textContent = `${atomsAssigned || 0} 个原子已归类`;

    const statusEl = document.getElementById('kdClusteringStatus');
    if (statusEl) statusEl.textContent = message || '正在聚类...';
  }

  _updateClusteringProgressText(message) {
    const statusEl = document.getElementById('kdClusteringStatus');
    if (statusEl) statusEl.textContent = message;
  }

  _updateClusteringStep(step, message) {
    // 保留兼容性，现在由 _handleClusteringProgress 处理
    const statusEl = document.getElementById('kdClusteringStatus');
    if (statusEl) statusEl.textContent = message;
  }

  hideClusteringProgress() {
    // 移除进度监听
    if (window.electronAPI?.removeKnowledgeClusteringProgressListeners) {
      window.electronAPI.removeKnowledgeClusteringProgressListeners();
    }
    if (window.electronAPI?.removeKnowledgeClusteringCompleteListeners) {
      window.electronAPI.removeKnowledgeClusteringCompleteListeners();
    }
    this._clusteringProgressHandler = null;
    const el = document.getElementById('kdClusteringProgress');
    if (el) el.remove();
  }

  showClusteringResult(result, newClusters) {
    const grid = document.getElementById('knowledgeClusterGrid');
    if (!grid) return;

    // 移除旧的结果面板
    const oldResult = document.getElementById('kdClusteringResult');
    if (oldResult) oldResult.remove();

    const resultEl = document.createElement('div');
    resultEl.id = 'kdClusteringResult';
    resultEl.className = 'kd-clustering-result';

    const hasNewClusters = newClusters.length > 0;
    const hasAssignments = result.atomsAssigned > 0;
    const hasMessage = !!result.message;

    // 判断结果类型
    const isSuccess = hasNewClusters || hasAssignments;
    const isWarning = !isSuccess && hasMessage;
    const isInfo = !isSuccess && !hasMessage;

    let clustersHtml = '';
    if (hasNewClusters) {
      clustersHtml = newClusters.map(c => `
        <div class="kd-result-cluster-item" data-cluster-id="${c.id}">
          <span class="kd-result-cluster-dot">🔵</span>
          <span class="kd-result-cluster-name">${this.escHtml(c.name)}</span>
          <span class="kd-result-cluster-count">${(c.atom_ids || []).length} 原子</span>
          <button class="kd-action-btn small" data-kd-action="viewClusterDetail" data-kd-id="${c.id}">查看</button>
        </div>
      `).join('');
    }

    // 确定图标和标题
    let icon, title;
    if (isSuccess) {
      icon = '🎉';
      title = '聚类完成';
    } else if (isWarning) {
      icon = '⚠️';
      title = '聚类未完成';
    } else {
      icon = 'ℹ️';
      title = '聚类结果';
    }

    resultEl.innerHTML = `
      <div class="kd-result-inner ${isWarning ? 'warning' : ''}">
        <div class="kd-result-header">
          <span class="kd-result-icon">${icon}</span>
          <h4>${title}</h4>
          <button class="kd-result-close" data-kd-action="dismissClusteringResult" title="关闭">✕</button>
        </div>
        <div class="kd-result-stats">
          <div class="kd-result-stat">
            <span class="kd-result-stat-num">${result.clustersCreated || 0}</span>
            <span class="kd-result-stat-label">新建簇</span>
          </div>
          <div class="kd-result-stat">
            <span class="kd-result-stat-num">${result.atomsAssigned || 0}</span>
            <span class="kd-result-stat-label">归类原子</span>
          </div>
          ${result.unclusteredBefore !== undefined ? `
          <div class="kd-result-stat">
            <span class="kd-result-stat-num">${result.unclusteredBefore}</span>
            <span class="kd-result-stat-label">待处理原子</span>
          </div>` : ''}
        </div>
        ${hasNewClusters ? `
          <div class="kd-result-clusters">
            <h5>新建知识簇</h5>
            ${clustersHtml}
          </div>
        ` : ''}
        ${hasMessage ? `
          <div class="kd-result-message ${isWarning ? 'warning' : 'info'}">${this.escHtml(result.message)}</div>
        ` : !hasNewClusters && !hasAssignments ? `
          <p class="kd-result-hint">所有知识原子都已归入知识簇，无需聚类</p>
        ` : !hasNewClusters && hasAssignments ? `
          <p class="kd-result-hint">原子已归入已有知识簇</p>
        ` : ''}
      </div>
    `;

    grid.prepend(resultEl);

    // 高亮新建的簇卡片
    setTimeout(() => {
      newClusters.forEach(c => {
        const card = grid.querySelector(`.kd-cluster-card[data-cluster-id="${c.id}"]`);
        if (card) card.classList.add('kd-highlight-new');
      });
    }, 100);

    // 10秒后自动移除结果面板（如果用户没手动关闭）
    setTimeout(() => {
      const el = document.getElementById('kdClusteringResult');
      if (el) el.remove();
    }, 10000);

    // 5秒后自动移除高亮
    setTimeout(() => {
      document.querySelectorAll('.kd-highlight-new').forEach(el => {
        el.classList.remove('kd-highlight-new');
      });
    }, 5000);
  }

  dismissClusteringResult() {
    const el = document.getElementById('kdClusteringResult');
    if (el) el.remove();
  }

  async distillAll() {
    if (!window.electronAPI?.knowledgeDistillAll) return;

    const beforeClusterIds = new Set(this.clusters.map(c => c.id));

    // 先注册完成监听（防止竞态）
    let completeFired = false;
    const completeHandler = async (data) => {
      if (completeFired) return;
      completeFired = true;

      if (window.electronAPI?.removeKnowledgeClusteringCompleteListeners) {
        window.electronAPI.removeKnowledgeClusteringCompleteListeners();
      }

      // 刷新数据
      await Promise.all([
        this.loadStats(),
        this.loadClusters(),
        this.loadArticles()
      ]);

      const newClusters = this.clusters.filter(c => !beforeClusterIds.has(c.id));

      this.hideClusteringProgress();
      this.showToast(`萃取完成！新建 ${data.clustersCreated || 0} 簇，归类 ${data.atomsAssigned || 0} 原子，生成 ${data.articlesGenerated || 0} 篇文章`);

      if (newClusters.length > 0 || (data.articlesGenerated || 0) > 0) {
        this.showClusteringResult(data, newClusters);
      }
    };

    if (window.electronAPI?.onKnowledgeClusteringComplete) {
      window.electronAPI.onKnowledgeClusteringComplete(completeHandler);
    }

    this.showClusteringProgress();

    try {
      const startResult = await window.electronAPI.knowledgeDistillAll();
      if (!startResult.started) {
        if (window.electronAPI?.removeKnowledgeClusteringCompleteListeners) {
          window.electronAPI.removeKnowledgeClusteringCompleteListeners();
        }
        this.hideClusteringProgress();
        this.showToast(startResult.message || '无法启动萃取');
        return;
      }

    } catch (e) {
      if (window.electronAPI?.removeKnowledgeClusteringCompleteListeners) {
        window.electronAPI.removeKnowledgeClusteringCompleteListeners();
      }
      this.hideClusteringProgress();
      this.showToast('萃取出错：' + e.message);
    }
  }

  showActionProgress(title, subtitle) {
    const grid = document.getElementById('knowledgeClusterGrid');
    if (!grid) return;

    // 移除旧进度
    const old = document.getElementById('kdActionProgress');
    if (old) old.remove();

    const el = document.createElement('div');
    el.id = 'kdActionProgress';
    el.className = 'kd-clustering-progress';
    el.innerHTML = `
      <div class="kd-clustering-inner">
        <div class="kd-clustering-spinner"></div>
        <h4 class="kd-clustering-title">${title}</h4>
        <p class="kd-clustering-status">${subtitle || ''}</p>
      </div>
    `;
    grid.prepend(el);
  }

  hideActionProgress() {
    const el = document.getElementById('kdActionProgress');
    if (el) el.remove();
  }

  async deleteAtom(atomId) {
    const confirmed = await this.showConfirm('确定删除此知识原子？');
    if (!confirmed) return;
    try {
      await window.electronAPI.knowledgeDeleteAtom(atomId);
      this.showToast('已删除');
      if (this.currentCluster) {
        this.viewClusterDetail(this.currentCluster.cluster.id);
      }
      this.loadStats();
    } catch (e) {
      this.showToast('删除出错');
    }
  }

  async deleteCluster(clusterId) {
    const confirmed = await this.showConfirm('确定删除此知识簇？原子将变为待归类状态。');
    if (!confirmed) return;
    try {
      await window.electronAPI.knowledgeDeleteCluster(clusterId, 'release');
      this.showToast('已删除');
      this.switchSubview('graph');
      this.loadStats();
      this.loadClusters();
    } catch (e) {
      this.showToast('删除出错');
    }
  }

  async deleteArticle(articleId) {
    const confirmed = await this.showConfirm('确定删除此知识文章？');
    if (!confirmed) return;
    try {
      await window.electronAPI.knowledgeDeleteArticle(articleId);
      this.showToast('已删除');
      this.switchSubview('articles');
      this.loadArticles();
      this.loadClusters();
    } catch (e) {
      this.showToast('删除出错');
    }
  }

  async regenerateArticle(clusterId) {
    // 先删除旧文章，再生成新的
    const cluster = this.clusters.find(c => c.id === clusterId);
    if (cluster?.article_id) {
      await window.electronAPI.knowledgeDeleteArticle(cluster.article_id);
    }
    await this.generateArticle(clusterId);
  }

  async exportArticle(articleId) {
    if (!window.electronAPI?.knowledgeGetArticle) return;
    try {
      const result = await window.electronAPI.knowledgeGetArticle(articleId);
      if (result.article?.content) {
        // 复制到剪贴板
        await navigator.clipboard.writeText(result.article.content);
        this.showToast('Markdown 已复制到剪贴板');
      }
    } catch (e) {
      this.showToast('导出出错');
    }
  }

  async showCreateClusterModal() {
    const result = await this.showModal({
      title: '新建知识簇',
      fields: [
        { name: 'name', label: '簇名称', type: 'text', placeholder: '输入知识簇名称', required: true }
      ]
    });
    if (!result || !result.name?.trim()) return;
    try {
      await window.electronAPI.knowledgeCreateCluster({
        name: result.name.trim(),
        description: '',
        keywords: [],
        atom_ids: []
      });
      this.showToast('知识簇已创建');
      this.loadClusters();
      this.loadStats();
    } catch (e) {
      this.showToast('创建出错');
    }
  }

  filterClusters(query) {
    const cards = document.querySelectorAll('.kd-cluster-card');
    const q = (query || '').toLowerCase();
    cards.forEach(card => {
      const text = card.textContent.toLowerCase();
      card.style.display = (!q || text.includes(q)) ? '' : 'none';
    });
  }

  filterQuestions(query) {
    const cards = document.querySelectorAll('.kd-question-card');
    const q = (query || '').toLowerCase();
    cards.forEach(card => {
      const text = card.textContent.toLowerCase();
      card.style.display = (!q || text.includes(q)) ? '' : 'none';
    });
  }

  async showAddQuestionModal() {
    const result = await this.showModal({
      title: '记录问题',
      fields: [
        { name: 'content', label: '问题内容', type: 'textarea', placeholder: '记录你的问题', required: true },
        { name: 'domain', label: '问题领域', type: 'text', placeholder: '如：技术、业务、管理', defaultValue: '未分类' }
      ]
    });
    if (!result || !result.content?.trim()) return;

    try {
      if (!window.electronAPI?.knowledgeAddAtom) {
        this.showToast('API 不可用');
        return;
      }
      const addResult = await window.electronAPI.knowledgeAddAtom({
        content: result.content.trim(),
        domain: (result.domain || '未分类').trim(),
        type: 'question',
        importance: 0.7
      });
      if (addResult.success) {
        this.showToast('问题已记录');
        this.loadQuestions();
        this.loadStats();
      } else {
        this.showToast('记录失败');
      }
    } catch (e) {
      this.showToast('记录出错：' + e.message);
    }
  }

  async resolveQuestion(atomId) {
    // 使用 ADP 或本地 AI 寻找答案
    const atom = this.questions.find(q => q.id === atomId);
    if (!atom) return;

    this.showToast('正在寻找答案...');

    try {
      // 尝试使用知识跟随的 ADP 搜索
      if (window.knowledgeFollow && window.electronAPI?.knowledgeSearchADP) {
        // 切换到搜索视图并搜索
        this.switchSubview('search');
        const searchInput = document.getElementById('knowledgeSearchInput');
        if (searchInput) {
          searchInput.value = atom.content;
        }
        // 触发搜索
        setTimeout(() => {
          window.knowledgeFollow.handleADPSearch('query_question');
        }, 300);
      } else {
        this.showToast('暂无可用的 AI 搜索服务');
      }
    } catch (e) {
      this.showToast('搜索出错：' + e.message);
    }
  }

  async viewAtomDetail(atomId) {
    try {
      if (!window.electronAPI?.knowledgeGetAtomById) return;
      const result = await window.electronAPI.knowledgeGetAtomById(atomId);
      if (!result.atom) return;

      const atom = result.atom;
      const detailContent = document.getElementById('knowledgeDetailContent');
      if (!detailContent) return;

      const typeMap = {
        fact: { icon: '📋', label: '事实' },
        rule: { icon: '🔴', label: '规则' },
        insight: { icon: '💡', label: '洞察' },
        procedure: { icon: '🔧', label: '步骤' },
        question: { icon: '❓', label: '问题' }
      };
      const tp = typeMap[atom.type] || typeMap.fact;

      detailContent.innerHTML = `
        <div class="kd-detail-header">
          <h3>${tp.icon} ${tp.label}</h3>
          <span class="kd-detail-status">${atom.cluster_id ? '已归簇' : '待归类'}</span>
        </div>
        <div class="kd-detail-section">
          <h4>📝 内容</h4>
          <p style="font-size:14px;color:var(--text-primary);line-height:1.8;">${this.escHtml(atom.content)}</p>
        </div>
        <div class="kd-detail-meta">
          <span>领域：${this.escHtml(atom.domain)}</span>
          <span>重要度：${atom.importance}</span>
          <span>${this.formatRelativeTime(atom.created_at)}</span>
        </div>
        <div class="kd-detail-actions">
          <button class="kd-action-btn" data-kd-action="switchSubview" data-kd-id="questions">返回问题列表</button>
          <button class="kd-action-btn danger" data-kd-action="deleteAtom" data-kd-id="${atom.id}">删除</button>
        </div>`;

      this.switchSubview('cluster-detail');
    } catch (e) {
      console.error('[KnowledgeDistillation] viewAtomDetail error:', e);
    }
  }

  // ========== 模态对话框 ==========

  showModal({ title, fields }) {
    return new Promise((resolve) => {
      // 移除旧模态
      const old = document.getElementById('kdModal');
      if (old) old.remove();

      const overlay = document.createElement('div');
      overlay.id = 'kdModal';
      overlay.className = 'kd-modal-overlay';

      const fieldsHtml = fields.map(f => {
        if (f.type === 'textarea') {
          return `
            <div class="kd-modal-field">
              <label class="kd-modal-label">${f.label}</label>
              <textarea class="kd-modal-textarea" name="${f.name}" placeholder="${f.placeholder || ''}" rows="3">${f.defaultValue || ''}</textarea>
            </div>`;
        }
        return `
          <div class="kd-modal-field">
            <label class="kd-modal-label">${f.label}</label>
            <input class="kd-modal-input" type="text" name="${f.name}" placeholder="${f.placeholder || ''}" value="${f.defaultValue || ''}">
          </div>`;
      }).join('');

      overlay.innerHTML = `
        <div class="kd-modal">
          <div class="kd-modal-header">
            <h3>${title}</h3>
          </div>
          <div class="kd-modal-body">
            ${fieldsHtml}
          </div>
          <div class="kd-modal-footer">
            <button class="kd-modal-btn cancel" data-action="cancel">取消</button>
            <button class="kd-modal-btn confirm" data-action="confirm">确定</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      // 自动聚焦第一个输入框
      const firstInput = overlay.querySelector('input, textarea');
      if (firstInput) setTimeout(() => firstInput.focus(), 100);

      // 事件处理
      const closeModal = (result) => {
        overlay.remove();
        resolve(result);
      };

      overlay.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (action === 'cancel') {
          closeModal(null);
        } else if (action === 'confirm') {
          const data = {};
          overlay.querySelectorAll('input, textarea').forEach(el => {
            data[el.name] = el.value;
          });
          closeModal(data);
        } else if (e.target === overlay) {
          closeModal(null);
        }
      });

      // 回车确认
      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.target.matches('textarea')) {
          const data = {};
          overlay.querySelectorAll('input, textarea').forEach(el => {
            data[el.name] = el.value;
          });
          closeModal(data);
        } else if (e.key === 'Escape') {
          closeModal(null);
        }
      });
    });
  }

  showConfirm(message) {
    return new Promise((resolve) => {
      const old = document.getElementById('kdModal');
      if (old) old.remove();

      const overlay = document.createElement('div');
      overlay.id = 'kdModal';
      overlay.className = 'kd-modal-overlay';

      overlay.innerHTML = `
        <div class="kd-modal kd-modal-sm">
          <div class="kd-modal-body">
            <p class="kd-modal-message">${this.escHtml(message)}</p>
          </div>
          <div class="kd-modal-footer">
            <button class="kd-modal-btn cancel" data-action="cancel">取消</button>
            <button class="kd-modal-btn confirm danger" data-action="confirm">确定</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const closeModal = (result) => {
        overlay.remove();
        resolve(result);
      };

      overlay.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (action === 'cancel') closeModal(false);
        else if (action === 'confirm') closeModal(true);
        else if (e.target === overlay) closeModal(false);
      });

      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal(false);
      });
    });
  }

  // ========== Toast ==========

  escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  formatDate(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  formatRelativeTime(isoStr) {
    if (!isoStr) return '';
    const now = Date.now();
    const then = new Date(isoStr).getTime();
    const diff = now - then;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 30) return `${days}天前`;
    return this.formatDate(isoStr);
  }

  renderMarkdown(md) {
    // 简单 Markdown 渲染
    let html = this.escHtml(md);
    // 标题
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
    // 粗体
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // 代码
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');
    // 列表
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    // 换行
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = '<p>' + html + '</p>';
    // 清理
    html = html.replace(/<p><\/p>/g, '');
    html = html.replace(/<p>(<h[234]>)/g, '$1');
    html = html.replace(/(<\/h[234]>)<\/p>/g, '$1');
    return html;
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'kd-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }
}

// 全局实例
window.knowledgeDistillation = new KnowledgeDistillation();

// 全局函数（供 onclick 属性直接调用，确保事件绑定问题不影响功能）
window.kdShowCreateClusterModal = function() {
  if (window.knowledgeDistillation) {
    window.knowledgeDistillation.showCreateClusterModal();
  }
};

window.kdShowAddQuestionModal = function() {
  if (window.knowledgeDistillation) {
    window.knowledgeDistillation.showAddQuestionModal();
  }
};

window.kdDistillAll = function() {
  if (window.knowledgeDistillation) {
    window.knowledgeDistillation.distillAll();
  }
};
