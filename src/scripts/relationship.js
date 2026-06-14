/**
 * Memora v2.5 — 关系人脉图谱 (Relationship Network)
 * 基于现有实体库和记忆系统，自动聚合人物实体，可视化关系网络
 * 集成到洞察模块作为新子标签
 */

const Relationship = {
  data: {
    persons: [],          // 人物列表
    relations: [],        // 人物关系列表
    stats: null,          // 统计数据
    searchQuery: '',       // 搜索关键词
    filterType: 'all',    // all | frequent | recent | stale
    selectedPerson: null,  // 选中的查看详情的人物
    graphData: null        // 力导向图数据
  },

  initialized: false,

  init() {
    if (this.initialized) return;
    this.initialized = true;
    console.log('[Relationship] Module loaded');
  },

  /** 切换到关系人脉标签时调用 */
  async load() {
    // 清理上次的 Canvas 动画
    if (this._graphAnimId) {
      cancelAnimationFrame(this._graphAnimId);
      this._graphAnimId = null;
    }

    const container = document.getElementById('relationshipContent');
    if (!container) return;

    container.innerHTML = '<div class="insight-loading"><div class="spinner"></div><span data-i18n="insight.loadingRelationship">加载人脉图谱...</span></div>';

    try {
      const result = await window.electronAPI?.relationshipGetAll?.();
      if (result) {
        this.data.persons = result.persons || [];
        this.data.relations = result.relations || [];
        this.data.stats = result.stats || null;
        this._render();
      } else {
        this._renderEmpty();
      }
    } catch (err) {
      console.error('[Relationship] Load error:', err);
      this._renderError(err.message);
    }
  },

  /** 主渲染逻辑 */
  _render() {
    const container = document.getElementById('relationshipContent');
    if (!container) return;

    const persons = this._filterPersons();
    const stats = this.data.stats || { total: 0, frequent: 0, recent: 0, stale: 0 };

    container.innerHTML = `
      <div class="relationship-layout">
        <!-- 左侧：统计 + 筛选 + 列表 -->
        <div class="relationship-sidebar">
          <div class="relationship-stats">
            <div class="rel-stat-chip">
              <span class="rel-stat-value">${stats.total || 0}</span>
              <span class="rel-stat-label" data-i18n="relationship.total">总人数</span>
            </div>
            <span class="stat-dot">·</span>
            <div class="rel-stat-chip">
              <span class="rel-stat-value">${stats.frequent || 0}</span>
              <span class="rel-stat-label" data-i18n="relationship.frequent">高频</span>
            </div>
            <span class="stat-dot">·</span>
            <div class="rel-stat-chip">
              <span class="rel-stat-value">${stats.recent || 0}</span>
              <span class="rel-stat-label" data-i18n="relationship.recent">近期活跃</span>
            </div>
            <span class="stat-dot">·</span>
            <div class="rel-stat-chip">
              <span class="rel-stat-value">${stats.stale || 0}</span>
              <span class="rel-stat-label" data-i18n="relationship.stale">需联系</span>
            </div>
          </div>

          <div class="relationship-toolbar">
            <input type="text" class="relationship-search" id="relationshipSearch"
              placeholder="搜索人名、项目、公司..." data-i18n-placeholder="relationship.searchPlaceholder">
            <div class="relationship-filters">
              <button class="rel-filter-btn active" data-filter="all" data-i18n="relationship.filterAll">全部</button>
              <button class="rel-filter-btn" data-filter="frequent" data-i18n="relationship.filterFrequent">高频</button>
              <button class="rel-filter-btn" data-filter="recent" data-i18n="relationship.filterRecent">近期</button>
              <button class="rel-filter-btn" data-filter="stale" data-i18n="relationship.filterStale">需联系</button>
            </div>
            <button class="relationship-ai-btn" id="relationshipAiBtn" data-i18n="relationship.aiAnalyze">AI 分析</button>
            <button class="relationship-ai-btn secondary" id="relationshipAiInferBtn" data-i18n="relationship.aiInfer">AI 推测关系</button>
          </div>

          <div class="relationship-list" id="relationshipList">
            ${this._renderPersonCards(persons)}
          </div>
        </div>

        <!-- 右侧：图谱 + 详情 -->
        <div class="relationship-main">
          <div class="relationship-graph-area" id="relationshipGraphArea">
            <canvas id="relationshipCanvas" width="800" height="600"></canvas>
            <div class="graph-controls">
              <button class="graph-ctrl-btn" id="relGraphZoomIn" title="放大">+</button>
              <button class="graph-ctrl-btn" id="relGraphZoomOut" title="缩小">−</button>
              <button class="graph-ctrl-btn" id="relGraphReset" title="重置">⟲</button>
            </div>
          </div>
          <!-- 人物详情面板 -->
          <div class="relationship-detail hidden" id="relationshipDetail">
            <div id="relationshipDetailContent"></div>
          </div>
        </div>
      </div>
    `;

    this._bindEvents();
    // 延迟一帧绘制，确保 DOM layout 已完成，canvas 能获取正确尺寸
    requestAnimationFrame(() => this._drawGraph(persons));
  },

  /** 渲染空状态 */
  _renderEmpty() {
    const container = document.getElementById('relationshipContent');
    if (!container) return;
    container.innerHTML = `
      <div class="insight-empty" style="padding:60px 20px;text-align:center;">
        <div class="insight-empty-icon" style="font-size:48px;margin-bottom:16px;">👥</div>
        <div style="font-size:16px;font-weight:600;color:var(--text-primary);margin-bottom:8px;" data-i18n="relationship.emptyTitle">暂无人脉数据</div>
        <div style="font-size:13px;color:var(--text-tertiary);max-width:360px;margin:0 auto;line-height:1.6;" data-i18n="relationship.emptyHint">当你复制或记录包含人名的信息时，Memora 会自动提取并积累人脉关系</div>
        <button class="relationship-ai-btn" style="margin-top:20px;" id="relationshipAiBtn" data-i18n="relationship.aiScan">AI 扫描人脉</button>
      </div>
    `;
    this._bindEmptyEvents();
  },

  _renderError(msg) {
    const container = document.getElementById('relationshipContent');
    if (!container) return;
    container.innerHTML = `
      <div class="insight-empty" style="padding:40px;text-align:center;">
        <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
        <div style="font-size:14px;color:var(--text-secondary);">加载失败: ${this._escapeHtml(msg)}</div>
        <button class="relationship-ai-btn" style="margin-top:16px;" id="relationshipRetryBtn">重试</button>
      </div>
    `;
    const retryBtn = document.getElementById('relationshipRetryBtn');
    if (retryBtn) retryBtn.addEventListener('click', () => this.load());
  },

  /** 筛选人物列表 */
  _filterPersons() {
    let persons = [...this.data.persons];

    // 搜索
    if (this.data.searchQuery) {
      const q = this.data.searchQuery.toLowerCase();
      persons = persons.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.role || '').toLowerCase().includes(q) ||
        (p.company || '').toLowerCase().includes(q) ||
        (p.projects || []).some(pr => pr.toLowerCase().includes(q))
      );
    }

    // 筛选类型
    switch (this.data.filterType) {
      case 'frequent':
        persons = persons.filter(p => (p.interactionCount || 0) >= 5);
        break;
      case 'recent':
        persons = persons.filter(p => {
          if (!p.lastInteraction) return false;
          return (Date.now() - new Date(p.lastInteraction).getTime()) < 7 * 86400000;
        });
        break;
      case 'stale':
        persons = persons.filter(p => {
          if (!p.lastInteraction) return true;
          return (Date.now() - new Date(p.lastInteraction).getTime()) > 30 * 86400000;
        });
        break;
    }

    return persons;
  },

  /** 渲染人物卡片列表 */
  _renderPersonCards(persons) {
    if (persons.length === 0) {
      return `<div class="insight-empty" style="padding:30px;text-align:center;">
        <div style="font-size:24px;margin-bottom:8px;">🔍</div>
        <div style="font-size:13px;color:var(--text-tertiary);" data-i18n="relationship.noMatch">未找到匹配的人脉</div>
      </div>`;
    }

    return persons.map(p => this._renderPersonCard(p)).join('');
  },

  _renderPersonCard(p) {
    const daysSince = p.lastInteraction
      ? Math.floor((Date.now() - new Date(p.lastInteraction).getTime()) / 86400000)
      : 999;
    const staleClass = daysSince > 30 ? 'stale' : '';
    const freqBadge = (p.interactionCount || 0) >= 10 ? '🔥' : (p.interactionCount || 0) >= 5 ? '⭐' : '';
    const selfBadge = p.isSelf || p.type === 'self' ? ' 👤' : '';
    const relationBadge = p.profileRelation ? `<span class="rel-person-relation">${this._escapeHtml(p.profileRelation)}</span>` : '';
    const projectTags = (p.projects || []).slice(0, 2).map(pr =>
      `<span class="rel-project-tag">${this._escapeHtml(pr)}</span>`
    ).join('');

    return `
      <div class="rel-person-card ${staleClass}${p.isSelf ? ' self-person' : ''}" data-person-id="${this._escapeHtml(p.name)}">
        <div class="rel-person-avatar${p.isSelf ? ' self-avatar' : ''}">${this._getInitials(p.name)}</div>
        <div class="rel-person-info">
          <div class="rel-person-header">
            <span class="rel-person-name">${this._escapeHtml(p.name)}${freqBadge ? ` ${freqBadge}` : ''}${selfBadge}</span>
            ${p.role ? `<span class="rel-person-role">${this._escapeHtml(p.role)}</span>` : ''}
            ${relationBadge}
          </div>
          <div class="rel-person-meta">
            ${p.company ? `<span class="rel-meta-item">🏢 ${this._escapeHtml(p.company)}</span>` : ''}
            <span class="rel-meta-item">💬 ${p.interactionCount || 0}次</span>
            <span class="rel-meta-item ${staleClass ? 'stale-text' : ''}">
              ${daysSince === 999 ? '无记录' : daysSince === 0 ? '今天' : `${daysSince}天前`}
            </span>
          </div>
          ${projectTags ? `<div class="rel-person-projects">${projectTags}</div>` : ''}
        </div>
      </div>
    `;
  },

  /** 获取姓名首字 */
  _getInitials(name) {
    if (!name) return '?';
    // 中文名取前两个字，英文名取首字母
    if (/[\u4e00-\u9fff]/.test(name)) {
      return name.substring(0, 2);
    }
    return name.split(/\s+/).map(w => w[0]).join('').substring(0, 2).toUpperCase();
  },

  /** 绘制力导向图 */
  _drawGraph(persons) {
    const canvas = document.getElementById('relationshipCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    // 自适应 canvas 大小
    const area = document.getElementById('relationshipGraphArea');
    if (area) {
      const aw = area.clientWidth || 600;
      const ah = area.clientHeight || 400;
      canvas.width = aw * dpr;
      canvas.height = ah * dpr;
      canvas.style.width = aw + 'px';
      canvas.style.height = ah + 'px';
      ctx.scale(dpr, dpr);
    }

    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    if (persons.length === 0) {
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-tertiary').trim() || '#aeaeb2';
      ctx.font = '14px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('暂无人脉数据', w / 2, h / 2);
      return;
    }

    // 构建节点和边
    const nodes = persons.map((p, i) => ({
      id: p.name,
      x: w / 2 + (Math.random() - 0.5) * w * 0.6,
      y: h / 2 + (Math.random() - 0.5) * h * 0.6,
      vx: 0,
      vy: 0,
      radius: Math.max(12, Math.min(36, (p.interactionCount || 1) * 3)),
      person: p
    }));

    // 构建边：同项目的人物连线
    const edges = [];
    const nameToNode = {};
    nodes.forEach(n => nameToNode[n.id] = n);

    this.data.relations.forEach(r => {
      const source = nameToNode[r.source];
      const target = nameToNode[r.target];
      if (source && target) {
        edges.push({ source, target, strength: r.strength || 1, type: r.type || '', label: r.label || '', aiInferred: r.aiInferred || false });
      }
    });

    // 自动从项目关联生成边
    const projectPersons = {};
    persons.forEach(p => {
      (p.projects || []).forEach(proj => {
        if (!projectPersons[proj]) projectPersons[proj] = [];
        projectPersons[proj].push(p.name);
      });
    });
    Object.values(projectPersons).forEach(names => {
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const s = nameToNode[names[i]];
          const t = nameToNode[names[j]];
          if (s && t && !edges.find(e =>
            (e.source.id === s.id && e.target.id === t.id) ||
            (e.source.id === t.id && e.target.id === s.id)
          )) {
            edges.push({ source: s, target: t, strength: 0.5 });
          }
        }
      }
    });

    // 保存图数据
    this.data.graphData = { nodes, edges, scale: 1, offsetX: 0, offsetY: 0 };

    // 力导向模拟
    let iterations = 0;
    const maxIterations = persons.length > 30 ? 60 : 120;

    const simulate = () => {
      iterations++;

      // 斥力
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 2000 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          nodes[i].vx -= fx;
          nodes[i].vy -= fy;
          nodes[j].vx += fx;
          nodes[j].vy += fy;
        }
      }

      // 引力（边）
      edges.forEach(e => {
        const dx = e.target.x - e.source.x;
        const dy = e.target.y - e.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 100) * 0.02 * e.strength;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        e.source.vx += fx;
        e.source.vy += fy;
        e.target.vx -= fx;
        e.target.vy -= fy;
      });

      // 向心力 + 阻尼
      nodes.forEach(n => {
        n.vx += (w / 2 - n.x) * 0.001;
        n.vy += (h / 2 - n.y) * 0.001;
        n.vx *= 0.85;
        n.vy *= 0.85;
        n.x += n.vx;
        n.y += n.vy;
        // 边界约束
        n.x = Math.max(n.radius + 10, Math.min(w - n.radius - 10, n.x));
        n.y = Math.max(n.radius + 10, Math.min(h - n.radius - 10, n.y));
      });

      this._renderFrame(ctx, nodes, edges, w, h);

      if (iterations < maxIterations) {
        this._graphAnimId = requestAnimationFrame(simulate);
      }
    };

    if (this._graphAnimId) cancelAnimationFrame(this._graphAnimId);
    simulate();
  },

  /** 渲染一帧 */
  _renderFrame(ctx, nodes, edges, w, h) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    ctx.clearRect(0, 0, w, h);

    // 绘制边
    edges.forEach(e => {
      ctx.beginPath();
      ctx.moveTo(e.source.x, e.source.y);
      ctx.lineTo(e.target.x, e.target.y);

      // AI 推断的边用虚线
      if (e.aiInferred) {
        ctx.setLineDash([4, 4]);
      } else {
        ctx.setLineDash([]);
      }

      // 不同关系类型用不同颜色
      let edgeColor;
      switch (e.type) {
        case 'leader': edgeColor = isDark ? 'rgba(255,149,0,0.5)' : 'rgba(255,149,0,0.6)'; break;
        case 'subordinate': edgeColor = isDark ? 'rgba(52,199,89,0.5)' : 'rgba(52,199,89,0.6)'; break;
        case 'client': edgeColor = isDark ? 'rgba(175,82,222,0.5)' : 'rgba(175,82,222,0.6)'; break;
        case 'friend': edgeColor = isDark ? 'rgba(90,200,250,0.5)' : 'rgba(90,200,250,0.6)'; break;
        case 'family': edgeColor = isDark ? 'rgba(255,45,85,0.5)' : 'rgba(255,45,85,0.6)'; break;
        case 'self': edgeColor = isDark ? 'rgba(255,149,0,0.6)' : 'rgba(255,149,0,0.7)'; break;
        default:
          const alpha = Math.min(0.6, e.strength * 0.5);
          edgeColor = isDark ? `rgba(120,120,128,${alpha})` : `rgba(142,142,147,${alpha})`;
      }

      ctx.strokeStyle = edgeColor;
      ctx.lineWidth = Math.max(0.5, e.strength * 2);
      ctx.stroke();
      ctx.setLineDash([]); // 重置
    });

    // 绘制节点
    nodes.forEach(n => {
      const p = n.person;
      const daysSince = p.lastInteraction
        ? Math.floor((Date.now() - new Date(p.lastInteraction).getTime()) / 86400000)
        : 999;
      const isStale = daysSince > 30;
      const isSelected = this.data.selectedPerson === n.id;
      const isSelf = p.isSelf || p.type === 'self';

      // 光晕
      if (isSelected || isSelf) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + (isSelf ? 8 : 6), 0, Math.PI * 2);
        ctx.fillStyle = isSelf ? 'rgba(255,149,0,0.2)' : 'rgba(0,122,255,0.15)';
        ctx.fill();
      }

      // 圆形背景
      ctx.beginPath();
      ctx.arc(n.x, n.y, isSelf ? n.radius + 2 : n.radius, 0, Math.PI * 2);
      if (isSelf) {
        // "我自己"用特殊颜色
        ctx.fillStyle = '#FF9500';
      } else {
        const colors = ['#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF2D55', '#5AC8FA'];
        const colorIdx = Math.abs(this._hashCode(n.id)) % colors.length;
        ctx.fillStyle = isStale ? (isDark ? '#48484a' : '#d1d1d6') : colors[colorIdx];
      }
      ctx.fill();

      // 文字
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(10, n.radius * 0.6)}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this._getInitials(n.id), n.x, n.y);

      // 名字标签
      ctx.fillStyle = isDark ? '#e5e5ea' : '#1d1d1f';
      ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText(n.id, n.x, n.y + n.radius + 12);
    });
  },

  /** 绑定事件 */
  _bindEvents() {
    // 搜索
    const searchInput = document.getElementById('relationshipSearch');
    if (searchInput) {
      let timer;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          this.data.searchQuery = e.target.value;
          const list = document.getElementById('relationshipList');
          if (list) list.innerHTML = this._renderPersonCards(this._filterPersons());
          this._drawGraph(this._filterPersons());
        }, 300);
      });
    }

    // 筛选按钮
    document.querySelectorAll('.rel-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.rel-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.data.filterType = btn.dataset.filter;
        const list = document.getElementById('relationshipList');
        if (list) list.innerHTML = this._renderPersonCards(this._filterPersons());
        this._drawGraph(this._filterPersons());
      });
    });

    // AI 分析按钮
    const aiBtn = document.getElementById('relationshipAiBtn');
    if (aiBtn) {
      aiBtn.addEventListener('click', () => this._runAiAnalysis());
    }

    // AI 推测关系按钮
    const aiInferBtn = document.getElementById('relationshipAiInferBtn');
    if (aiInferBtn) {
      aiInferBtn.addEventListener('click', () => this._runAiInferRelations());
    }

    // 人物卡片点击
    const list = document.getElementById('relationshipList');
    if (list) {
      list.addEventListener('click', (e) => {
        const card = e.target.closest('.rel-person-card');
        if (card) {
          const personId = card.dataset.personId;
          this._showPersonDetail(personId);
          this.data.selectedPerson = personId;
          // 重绘高亮
          if (this.data.graphData) {
            const persons = this._filterPersons();
            this._drawGraph(persons);
          }
        }
      });
    }

    // Canvas 点击
    const canvas = document.getElementById('relationshipCanvas');
    if (canvas) {
      canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (this.data.graphData) {
          const hit = this.data.graphData.nodes.find(n => {
            const dx = n.x - x;
            const dy = n.y - y;
            return Math.sqrt(dx * dx + dy * dy) <= n.radius;
          });
          if (hit) {
            this._showPersonDetail(hit.id);
            this.data.selectedPerson = hit.id;
            const persons = this._filterPersons();
            this._drawGraph(persons);
          }
        }
      });
    }

    // 图谱缩放
    const zoomIn = document.getElementById('relGraphZoomIn');
    const zoomOut = document.getElementById('relGraphZoomOut');
    const reset = document.getElementById('relGraphReset');
    if (zoomIn) zoomIn.addEventListener('click', () => this._zoomGraph(1.2));
    if (zoomOut) zoomOut.addEventListener('click', () => this._zoomGraph(0.8));
    if (reset) reset.addEventListener('click', () => this._zoomGraph(0));
  },

  _bindEmptyEvents() {
    const aiBtn = document.getElementById('relationshipAiBtn');
    if (aiBtn) {
      aiBtn.addEventListener('click', () => this._runAiAnalysis());
    }
  },

  /** 图谱缩放 */
  _zoomGraph(factor) {
    if (!this.data.graphData) return;
    if (factor === 0) {
      this.data.graphData.scale = 1;
    } else {
      this.data.graphData.scale *= factor;
    }
    const canvas = document.getElementById('relationshipCanvas');
    if (canvas) {
      canvas.style.transform = `scale(${this.data.graphData.scale})`;
      canvas.style.transformOrigin = 'center center';
    }
  },

  /** 显示人物详情 */
  _showPersonDetail(personId) {
    const panel = document.getElementById('relationshipDetail');
    const content = document.getElementById('relationshipDetailContent');
    if (!panel || !content) return;

    const person = this.data.persons.find(p => p.name === personId);
    if (!person) return;

    panel.classList.remove('hidden');

    const daysSince = person.lastInteraction
      ? Math.floor((Date.now() - new Date(person.lastInteraction).getTime()) / 86400000)
      : 999;

    // 相关人物
    const related = this.data.relations
      .filter(r => r.source === personId || r.target === personId)
      .map(r => r.source === personId ? r.target : r.source)
      .slice(0, 6);

    // 最近相关记忆
    const recentMemories = (person.recentMemories || []).slice(0, 3);

    content.innerHTML = `
      <div class="rel-detail-header">
        <div class="rel-detail-avatar" style="font-size:24px;${person.isSelf ? 'background:linear-gradient(135deg,#FF9500,#FF6B00);color:#fff;' : ''}">${this._getInitials(person.name)}</div>
        <div class="rel-detail-title">
          <h3>${this._escapeHtml(person.name)}${person.isSelf ? ' 👤' : ''}</h3>
          ${person.role ? `<span class="rel-detail-role">${this._escapeHtml(person.role)}${person.company ? ` · ${this._escapeHtml(person.company)}` : ''}</span>` : ''}
          ${person.profileRelation ? `<span class="rel-person-relation" style="margin-top:2px;">${this._escapeHtml(person.profileRelation)}</span>` : ''}
        </div>
        <button class="rel-detail-close" id="relDetailClose">✕</button>
      </div>

      <div class="rel-detail-stats">
        <div class="rel-detail-stat">
          <span class="rel-detail-stat-value">${person.interactionCount || 0}</span>
          <span class="rel-detail-stat-label" data-i18n="relationship.interactions">交互次数</span>
        </div>
        <div class="rel-detail-stat">
          <span class="rel-detail-stat-value">${daysSince === 999 ? '—' : daysSince === 0 ? '今天' : `${daysSince}天`}</span>
          <span class="rel-detail-stat-label" data-i18n="relationship.lastContact">上次联系</span>
        </div>
        <div class="rel-detail-stat ${daysSince > 30 ? 'stale' : ''}">
          <span class="rel-detail-stat-value">${daysSince > 30 ? '⚠️' : '✅'}</span>
          <span class="rel-detail-stat-label" data-i18n="relationship.contactStatus">联系状态</span>
        </div>
      </div>

      ${(person.projects || []).length > 0 ? `
        <div class="rel-detail-section">
          <h4 data-i18n="relationship.relatedProjects">关联项目</h4>
          <div class="rel-detail-tags">
            ${person.projects.map(p => `<span class="rel-detail-tag">${this._escapeHtml(p)}</span>`).join('')}
          </div>
        </div>
      ` : ''}

      ${related.length > 0 ? `
        <div class="rel-detail-section">
          <h4 data-i18n="relationship.relatedPersons">相关人脉</h4>
          <div class="rel-detail-persons">
            ${related.map(name => {
              const rel = this.data.relations.find(r =>
                (r.source === personId && r.target === name) || (r.target === personId && r.source === name)
              );
              const relLabel = rel?.label ? ` (${this._escapeHtml(rel.label)})` : '';
              const aiTag = rel?.aiInferred ? ' 🤖' : '';
              return `<span class="rel-related-person" data-person-id="${this._escapeHtml(name)}">${this._escapeHtml(name)}${relLabel}${aiTag}</span>`;
            }).join('')}
          </div>
        </div>
      ` : ''}

      ${recentMemories.length > 0 ? `
        <div class="rel-detail-section">
          <h4 data-i18n="relationship.recentMemories">最近记录</h4>
          <div class="rel-detail-memories">
            ${recentMemories.map(m => `
              <div class="rel-memory-item">
                <span class="rel-memory-time">${this._formatTimeAgo(m.createdAt)}</span>
                <span class="rel-memory-content">${this._escapeHtml((m.content || '').substring(0, 80))}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${person.aiRecommendation ? `
        <div class="rel-detail-section rel-ai-section">
          <h4>🤖 AI 建议</h4>
          <div class="rel-ai-recommendation">${this._escapeHtml(person.aiRecommendation)}</div>
        </div>
      ` : ''}

      <div class="rel-detail-actions">
        <button class="rel-action-btn primary" id="relAiSuggestBtn" data-i18n="relationship.aiSuggest">AI 推荐话题</button>
        <button class="rel-action-btn" id="relCreateTaskBtn" data-i18n="relationship.createTask">创建联系任务</button>
      </div>
    `;

    // 关闭按钮
    const closeBtn = document.getElementById('relDetailClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        panel.classList.add('hidden');
        this.data.selectedPerson = null;
        this._drawGraph(this._filterPersons());
      });
    }

    // AI 推荐话题
    const suggestBtn = document.getElementById('relAiSuggestBtn');
    if (suggestBtn) {
      suggestBtn.addEventListener('click', () => this._getAiSuggestion(personId));
    }

    // 创建联系任务
    const taskBtn = document.getElementById('relCreateTaskBtn');
    if (taskBtn) {
      taskBtn.addEventListener('click', () => this._createContactTask(personId, daysSince));
    }

    // 关联人脉点击
    content.querySelectorAll('.rel-related-person').forEach(el => {
      el.addEventListener('click', () => this._showPersonDetail(el.dataset.personId));
    });
  },

  /** AI 分析人脉网络 */
  async _runAiAnalysis() {
    const container = document.getElementById('relationshipContent');
    if (!container) return;

    this._showToast('AI 正在分析人脉网络...', 'info');

    try {
      const result = await window.electronAPI?.relationshipAiAnalyze?.();
      if (result && result.persons) {
        this.data.persons = result.persons;
        this.data.relations = result.relations || [];
        this.data.stats = result.stats || null;
        this._render();
        this._showToast('人脉分析完成', 'success');
      } else if (result && result.error) {
        this._showToast(result.error, 'error');
      }
    } catch (err) {
      this._showToast('AI 分析失败: ' + err.message, 'error');
    }
  },

  /** AI 推测关系（结合记忆+画像，自动适配 agent/LLM 模式） */
  async _runAiInferRelations() {
    this._showToast('AI 正在推测人物关系...', 'info');

    try {
      const result = await window.electronAPI?.relationshipAiInferRelations?.();
      if (result && !result.error) {
        this.data.persons = result.persons || this.data.persons;
        this.data.relations = result.relations || this.data.relations;
        this.data.stats = result.stats || this.data.stats;
        this._render();
        
        // 展示推断洞察
        if (result.insights?.length || result.inferredRelations?.length) {
          const inferCount = result.inferredRelations?.length || 0;
          const insightText = result.insights?.join('\n') || '';
          this._showInferResult(inferCount, insightText, result.selfPerson);
        }
        this._showToast('关系推测完成', 'success');
      } else if (result?.error) {
        this._showToast(result.error, 'error');
      }
    } catch (err) {
      this._showToast('AI 推测关系失败: ' + err.message, 'error');
    }
  },

  /** 显示关系推测结果弹窗 */
  _showInferResult(inferCount, insights, selfPerson) {
    const container = document.getElementById('relationshipContent');
    if (!container) return;
    
    // 创建/更新结果提示
    let resultPanel = document.getElementById('relInferResult');
    if (!resultPanel) {
      resultPanel = document.createElement('div');
      resultPanel.id = 'relInferResult';
      resultPanel.className = 'rel-infer-result';
      const main = container.querySelector('.relationship-main');
      if (main) main.prepend(resultPanel);
    }

    const selfNote = selfPerson ? `<div class="rel-infer-self">👤 已识别 "${this._escapeHtml(selfPerson)}" 为用户本人</div>` : '';

    resultPanel.innerHTML = `
      <div class="rel-infer-header">
        <span class="rel-infer-icon">🔗</span>
        <span class="rel-infer-title">AI 推测了 ${inferCount} 条关系</span>
        <button class="rel-infer-close" id="relInferClose">✕</button>
      </div>
      ${selfNote}
      ${insights ? `<div class="rel-infer-insights">${this._escapeHtml(insights).replace(/\n/g, '<br>')}</div>` : ''}
    `;
    resultPanel.classList.remove('hidden');

    const closeBtn = document.getElementById('relInferClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        resultPanel.classList.add('hidden');
      });
    }

    // 5秒后自动隐藏
    setTimeout(() => {
      if (resultPanel && !resultPanel.classList.contains('hidden')) {
        resultPanel.classList.add('hidden');
      }
    }, 8000);
  },
  async _getAiSuggestion(personName) {
    this._showToast('AI 正在生成推荐话题...', 'info');
    try {
      const result = await window.electronAPI?.relationshipAiSuggest?.(personName);
      if (result && result.suggestion) {
        const section = document.querySelector('.rel-ai-section');
        if (section) {
          section.querySelector('.rel-ai-recommendation').textContent = result.suggestion;
        } else {
          // 添加 AI 建议区域
          const content = document.getElementById('relationshipDetailContent');
          const actionsDiv = content.querySelector('.rel-detail-actions');
          if (actionsDiv) {
            const aiDiv = document.createElement('div');
            aiDiv.className = 'rel-detail-section rel-ai-section';
            aiDiv.innerHTML = `<h4>🤖 AI 建议</h4><div class="rel-ai-recommendation">${this._escapeHtml(result.suggestion)}</div>`;
            actionsDiv.before(aiDiv);
          }
        }
        this._showToast('推荐已生成', 'success');
      }
    } catch (err) {
      this._showToast('生成推荐失败', 'error');
    }
  },

  /** 创建联系任务 */
  async _createContactTask(personName, daysSince) {
    try {
      const taskTitle = `联系 ${personName}${daysSince > 30 ? `（${daysSince}天未联系）` : ''}`;
      const Store = window.Store;
      if (!Store?.addTask) {
        this._showToast('任务系统未就绪', 'error');
        return;
      }
      const task = Store.addTask({
        title: taskTitle,
        priority: daysSince > 30 ? 'high' : 'medium',
        dueDate: new Date(Date.now() + 86400000).toISOString(),
        source: 'relationship',
        estimatedDuration: 30
      });
      // 设置提醒
      if (window.Reminder?.calculateReminders) {
        task.reminders = window.Reminder.calculateReminders(task);
        Store.updateTask(task.id, { reminders: task.reminders });
      }
      // 刷新任务列表 + 同步到数据库
      if (window.App?.renderTaskList) window.App.renderTaskList();
      if (window.App?.syncTasksToDatabase) window.App.syncTasksToDatabase();
      this._showToast(`已创建任务：${taskTitle}`, 'success');
    } catch (err) {
      console.error('[Relationship] Create task error:', err);
      this._showToast('创建任务失败', 'error');
    }
  },

  // ===== 工具方法 =====

  _escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  _hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
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
  },

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
  }
};

window.Relationship = Relationship;
console.log('[Relationship] Module loaded');
