/**
 * AI 审计日志视图控制器
 */
const Audit = {
  _currentPage: 1,
  _pageSize: 20,
  _currentModule: '',
  _startDate: '',
  _endDate: '',
  _keyword: '',
  _stats: null,
  _recordsCache: [],

  init() {
    // 绑定按钮
    document.getElementById('openAuditBtn')?.addEventListener('click', () => this.show());
    document.getElementById('closeAuditBtn')?.addEventListener('click', () => this.hide());
    document.getElementById('auditOverlay')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.hide();
    });
    document.getElementById('auditSearchBtn')?.addEventListener('click', () => this.search());
    document.getElementById('auditSearchInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.search();
    });
    document.getElementById('auditModuleFilter')?.addEventListener('change', (e) => {
      this._currentModule = e.target.value;
      this._currentPage = 1;
      this.loadLogs();
    });
    document.getElementById('auditDateRange')?.addEventListener('change', (e) => {
      this._applyDateRange(e.target.value);
    });
    document.getElementById('auditPrevBtn')?.addEventListener('click', () => {
      if (this._currentPage > 1) { this._currentPage--; this.loadLogs(); }
    });
    document.getElementById('auditNextBtn')?.addEventListener('click', () => {
      this._currentPage++; this.loadLogs();
    });
  },

  show() {
    document.getElementById('auditOverlay')?.classList.remove('hidden');
    this._applyDateRange('7d');
    this.loadModules();
    this.loadDailyStats();
    this.loadLogs();
  },

  hide() {
    document.getElementById('auditOverlay')?.classList.add('hidden');
  },

  _applyDateRange(range) {
    const now = new Date();
    this._endDate = now.toISOString().slice(0, 10);
    const dateInput = document.getElementById('auditDateRange');
    dateInput.value = range || '7d';

    if (range === '7d') {
      this._startDate = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    } else if (range === '30d') {
      this._startDate = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    } else if (range === '1d') {
      this._startDate = this._endDate;
    } else if (range === '3d') {
      this._startDate = new Date(now.getTime() - 3 * 86400000).toISOString().slice(0, 10);
    }

    this._currentPage = 1;
  },

  async loadModules() {
    try {
      const modules = await window.electronAPI.auditModules();
      const select = document.getElementById('auditModuleFilter');
      if (!select) return;
      select.innerHTML = '<option value="">全部模块</option>';
      const moduleLabels = {
        clipboard_analysis: '📋 剪贴板分析',
        clipboard_memory: '🧠 剪贴板记忆',
        analyze_task: '✅ 任务分析',
        analyze_clipboard: '📋 剪贴板识别',
        estimate_duration: '⏱️ 时间预估',
        optimize_prompt: '🔧 Prompt优化',
        optimize_prompts: '🔧 批量优化',
        memory_extract: '🧠 记忆提取',
        memory_extract_ipc: '🧠 记忆提取(IPC)',
        memory_organize: '📚 记忆整理',
        agent: '🤖 Agent助手',
        adp_chat: '💬 ADP对话',
        knowledge_extract_atoms: '⚛️ 知识萃取',
        knowledge_clustering: '🔗 知识聚类',
        knowledge_article: '📄 知识文章',
        knowledge_search: '🔍 知识搜索',
        knowledge_recommend: '💡 知识推荐',
        search_keyword: '🔍 搜索关键词',
        profile_import: '👤 画像导入',
      };
      for (const mod of modules) {
        const opt = document.createElement('option');
        opt.value = mod;
        opt.textContent = moduleLabels[mod] || mod;
        select.appendChild(opt);
      }
    } catch (_) {}
  },

  async loadDailyStats() {
    try {
      const stats = await window.electronAPI.auditDailyStats(7);
      this._renderDailyChart(stats);
    } catch (_) {}
  },

  _renderDailyChart(stats) {
    const container = document.getElementById('auditDailyChart');
    if (!container || !stats || stats.length === 0) {
      if (container) container.innerHTML = '<div class="audit-chart-empty">暂无数据</div>';
      return;
    }
    const maxCount = Math.max(...stats.map(s => s.count), 1);
    let html = '<div class="audit-chart-bars">';
    for (const s of stats) {
      const pct = (s.count / maxCount) * 100;
      const dayLabel = s.date.slice(5);
      html += `
        <div class="audit-chart-col">
          <div class="audit-chart-bar-wrap">
            <div class="audit-chart-bar" style="height:${Math.max(pct, 4)}%;" title="${s.count}次调用"></div>
          </div>
          <div class="audit-chart-label">${dayLabel}</div>
        </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
  },

  async search() {
    const input = document.getElementById('auditSearchInput');
    this._keyword = input?.value?.trim() || '';
    this._currentPage = 1;
    await this.loadLogs();
  },

  async loadLogs() {
    const body = document.getElementById('auditLogsBody');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="6" class="audit-loading">加载中...</td></tr>';

    try {
      const result = await window.electronAPI.auditQuery({
        startDate: this._startDate,
        endDate: this._endDate,
        module: this._currentModule || undefined,
        page: this._currentPage,
        pageSize: this._pageSize,
        keyword: this._keyword || undefined,
      });

      this._stats = result.stats;
      this._recordsCache = result.records || [];
      this._renderStats(result.stats);
      this._renderLogs(result.records);
      this._renderPagination(result);
    } catch (e) {
      body.innerHTML = `<tr><td colspan="6" class="audit-error">加载失败: ${e.message}</td></tr>`;
    }
  },

  _renderStats(stats) {
    if (!stats) return;
    const el = document.getElementById('auditStatsSummary');
    if (!el) return;
    el.innerHTML = `
      <div class="audit-stat-card">
        <span class="audit-stat-value">${stats.totalCalls}</span>
        <span class="audit-stat-label">总调用</span>
      </div>
      <div class="audit-stat-card">
        <span class="audit-stat-value">${stats.successCount}</span>
        <span class="audit-stat-label">成功</span>
      </div>
      <div class="audit-stat-card audit-stat-error">
        <span class="audit-stat-value">${stats.errorCount}</span>
        <span class="audit-stat-label">失败</span>
      </div>
      <div class="audit-stat-card">
        <span class="audit-stat-value">${(stats.totalTokens || 0).toLocaleString()}</span>
        <span class="audit-stat-label">总Token</span>
      </div>
      <div class="audit-stat-card">
        <span class="audit-stat-value">${stats.avgLatencyMs}ms</span>
        <span class="audit-stat-label">平均耗时</span>
      </div>
    `;
  },

  _renderLogs(records) {
    const body = document.getElementById('auditLogsBody');
    if (!body) return;

    if (!records || records.length === 0) {
      body.innerHTML = '<tr><td colspan="6" class="audit-empty">暂无审计记录</td></tr>';
      return;
    }

    const moduleLabels = {
      clipboard_analysis: '📋 剪贴板分析',
      clipboard_memory: '🧠 记忆提取',
      analyze_task: '✅ 任务分析',
      analyze_clipboard: '📋 剪贴板识别',
      estimate_duration: '⏱️ 时间预估',
      optimize_prompt: '🔧 Prompt优化',
      optimize_prompts: '🔧 批量优化',
      memory_extract: '🧠 记忆提取',
      memory_extract_ipc: '🧠 记忆(IPC)',
      memory_organize: '📚 记忆整理',
      agent: '🤖 Agent',
      adp_chat: '💬 ADP对话',
      knowledge_extract_atoms: '⚛️ 知识萃取',
      knowledge_clustering: '🔗 知识聚类',
      knowledge_article: '📄 知识文章',
      knowledge_search: '🔍 知识搜索',
      knowledge_recommend: '💡 知识推荐',
      search_keyword: '🔍 搜索',
      profile_import: '👤 画像',
    };

    body.innerHTML = records.map(r => {
      const ts = new Date(r.timestamp);
      const timeStr = ts.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const statusClass = r.error ? 'audit-status-error' : (r.output?.status >= 200 && r.output?.status < 300 ? 'audit-status-ok' : 'audit-status-warn');
      const statusText = r.error ? '❌' : (r.output?.status === 200 ? '✅' : '⚠️');
      const tokenStr = r.tokens?.total_tokens ? r.tokens.total_tokens.toLocaleString() : '-';
      const latencyStr = r.latencyMs ? `${r.latencyMs}ms` : '-';
      const modLabel = moduleLabels[r.module] || r.module;

      return `<tr class="audit-log-row" data-id="${r.id}">
        <td class="audit-cell-time" title="${ts.toLocaleString('zh-CN')}">${timeStr}</td>
        <td class="audit-cell-module">${modLabel}</td>
        <td class="audit-cell-status ${statusClass}">${statusText} ${r.output?.status || '-'}</td>
        <td class="audit-cell-tokens">${tokenStr}</td>
        <td class="audit-cell-latency">${latencyStr}</td>
        <td class="audit-cell-preview" title="${this._escHtml(r.input?.userPromptPreview || '')}">${this._escHtml((r.input?.userPromptPreview || '').substring(0, 50))}</td>
      </tr>`;
    }).join('');

    // 点击行展开详情
    body.querySelectorAll('.audit-log-row').forEach(row => {
      row.addEventListener('click', () => this._toggleDetail(row));
    });
  },

  async _toggleDetail(row) {
    const existing = row.nextElementSibling?.classList.contains('audit-detail-row');
    if (existing) {
      row.nextElementSibling.remove();
      row.classList.remove('audit-row-expanded');
      return;
    }

    const id = row.dataset.id;
    // 优先从缓存查找记录
    let record = this._recordsCache.find(r => r.id === id);

    row.classList.add('audit-row-expanded');
    const detailRow = document.createElement('tr');
    detailRow.className = 'audit-detail-row';
    detailRow.innerHTML = `<td colspan="6"><div class="audit-detail-content">加载中...</div></td>`;
    row.after(detailRow);

    // 如果缓存没找到，从后端查询
    if (!record) {
      try {
        const result = await window.electronAPI.auditQuery({
          startDate: this._startDate,
          endDate: this._endDate,
          page: 1,
          pageSize: 1,
          id: id,
        });
        record = result.records.find(r => r.id === id);
      } catch (e) {
        detailRow.querySelector('.audit-detail-content').innerHTML = `加载失败: ${e.message}`;
        return;
      }
    }

    if (record) {
      detailRow.querySelector('.audit-detail-content').innerHTML = this._renderDetailHtml(record);
    } else {
      detailRow.querySelector('.audit-detail-content').innerHTML = '未找到记录';
    }
  },

  _renderDetailHtml(r) {
    const ts = new Date(r.timestamp).toLocaleString('zh-CN');
    return `
      <div class="audit-detail-grid">
        <div class="audit-detail-section">
          <h5>基本信息</h5>
          <div><b>时间:</b> ${ts}</div>
          <div><b>模块:</b> ${r.module}</div>
          <div><b>模型:</b> ${r.model || '-'}</div>
          <div><b>状态:</b> ${r.output?.status || '-'} ${r.error ? '(错误)' : ''}</div>
          <div><b>耗时:</b> ${r.latencyMs || 0}ms</div>
          <div><b>TraceID:</b> ${r.traceId || '-'}</div>
        </div>
        <div class="audit-detail-section">
          <h5>Token 统计</h5>
          <div><b>输入:</b> ${r.tokens?.prompt_tokens?.toLocaleString() || 0}</div>
          <div><b>输出:</b> ${r.tokens?.completion_tokens?.toLocaleString() || 0}</div>
          <div><b>总计:</b> ${r.tokens?.total_tokens?.toLocaleString() || 0}</div>
          <div><b>完成原因:</b> ${r.output?.finishReason || '-'}</div>
        </div>
      </div>
      ${r.error ? `<div class="audit-detail-section"><h5>错误信息</h5><pre class="audit-detail-pre audit-error-pre">${this._escHtml(r.error)}</pre></div>` : ''}
      <div class="audit-detail-section">
        <h5>输入预览 (系统提示 ${r.input?.systemPromptLen || 0}字 + 用户输入 ${r.input?.userPromptLen || 0}字)</h5>
        <pre class="audit-detail-pre">${this._escHtml(r.input?.userPromptPreview || '(无)')}</pre>
      </div>
      <div class="audit-detail-section">
        <h5>输出预览 (${r.output?.contentLen || 0}字)</h5>
        <pre class="audit-detail-pre">${this._escHtml(r.output?.contentPreview || '(无)')}</pre>
      </div>
    `;
  },

  _renderPagination(result) {
    const info = document.getElementById('auditPageInfo');
    if (info) {
      info.textContent = `第 ${result.page} / ${result.totalPages} 页 (共 ${result.total} 条)`;
    }
    const prevBtn = document.getElementById('auditPrevBtn');
    const nextBtn = document.getElementById('auditNextBtn');
    if (prevBtn) prevBtn.disabled = result.page <= 1;
    if (nextBtn) nextBtn.disabled = result.page >= result.totalPages;
  },

  _escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};
