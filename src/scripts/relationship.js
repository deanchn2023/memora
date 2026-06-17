/**
 * Memora v2.5 — 关系人脉图谱 (Relationship Network)
 * 基于现有实体库和记忆系统，自动聚合人物实体，可视化关系网络
 * 集成到洞察模块作为新子标签
 * 
 * 交互参考知识图谱 ForceLayout：拖拽/平移/缩放/高亮/多级关联/框选
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

  // 交互状态
  _transform: { x: 0, y: 0, scale: 1 },
  _dragging: null,
  _isPanning: false,
  _lastMouse: { x: 0, y: 0 },
  _hovering: null,
  _highlightLevel: 0,    // 0=无, 1=一级关联, 2=二级关联
  _highlightCenter: null, // 高亮中心节点ID
  _selectedNodes: new Set(), // 框选/多选的节点
  _selectionMode: false,  // 是否处于框选模式
  _selectionRect: null,   // 框选矩形
  _selectionStart: null,  // 框选起点
  _dpr: 1,

  init() {
    if (this.initialized) return;
    this.initialized = true;
    this._dpr = window.devicePixelRatio || 1;
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
            <button class="relationship-ai-btn secondary" id="relationshipImportBtn" data-i18n="relationship.importText">📝 导入文本</button>
            <button class="relationship-ai-btn danger" id="relationshipClearBtn" data-i18n="relationship.clearRebuild">🗑 清空重建</button>
          </div>

          <div class="relationship-list" id="relationshipList">
            ${this._renderPersonCards(persons)}
          </div>
        </div>

        <!-- 右侧：图谱 + 详情 -->
        <div class="relationship-main">
          <div class="relationship-graph-area" id="relationshipGraphArea">
            <canvas id="relationshipCanvas" width="800" height="600"></canvas>
            <!-- 图谱工具栏 -->
            <div class="graph-toolbar" id="relGraphToolbar">
              <div class="graph-toolbar-group">
                <button class="graph-ctrl-btn" id="relGraphZoomIn" title="放大">+</button>
                <button class="graph-ctrl-btn" id="relGraphZoomOut" title="缩小">−</button>
                <span class="graph-zoom-label" id="relGraphZoomLabel">100%</span>
              </div>
              <div class="graph-toolbar-divider"></div>
              <div class="graph-toolbar-group">
                <button class="graph-ctrl-btn" id="relGraphFitView" title="适配视图">⊞</button>
                <button class="graph-ctrl-btn" id="relGraphReset" title="重置布局">⟲</button>
              </div>
              <div class="graph-toolbar-divider"></div>
              <div class="graph-toolbar-group">
                <button class="graph-ctrl-btn" id="relGraphLevel1" title="一级关联">1°</button>
                <button class="graph-ctrl-btn" id="relGraphLevel2" title="二级关联">2°</button>
                <button class="graph-ctrl-btn" id="relGraphLevelAll" title="显示全部">◉</button>
              </div>
              <div class="graph-toolbar-divider"></div>
              <div class="graph-toolbar-group">
                <button class="graph-ctrl-btn" id="relGraphSelectMode" title="框选模式">⬚</button>
              </div>
            </div>
            <!-- 提示信息 -->
            <div class="graph-hint" id="relGraphHint">
              <span>拖拽节点 · 滚轮缩放 · 点击查看关联 · 双击展开二级</span>
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
    const dpr = this._dpr;

    // 自适应 canvas 大小
    const area = document.getElementById('relationshipGraphArea');
    if (area) {
      const aw = area.clientWidth || 600;
      const ah = area.clientHeight || 400;
      canvas.width = aw * dpr;
      canvas.height = ah * dpr;
      canvas.style.width = aw + 'px';
      canvas.style.height = ah + 'px';
    }

    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    if (persons.length === 0) {
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-tertiary').trim() || '#aeaeb2';
      ctx.font = '14px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('暂无人脉数据', w / 2, h / 2);
      ctx.restore();
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
      person: p,
      dimmed: false
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

    // 保存图数据 — 使用 canvas 级变换，不再用 CSS transform
    this.data.graphData = { nodes, edges };
    this._transform = { x: 0, y: 0, scale: 1 };
    this._highlightLevel = 0;
    this._highlightCenter = null;
    this._selectedNodes.clear();
    this._selectionMode = false;

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

      this._renderFrame();

      if (iterations < maxIterations) {
        this._graphAnimId = requestAnimationFrame(simulate);
      } else {
        // 模拟完成后自动适配视图
        this._fitView();
      }
    };

    if (this._graphAnimId) cancelAnimationFrame(this._graphAnimId);
    simulate();
  },

  /** 渲染一帧（使用 canvas 级变换，支持高亮/暗化/框选） */
  _renderFrame() {
    if (!this.data.graphData) return;
    const canvas = document.getElementById('relationshipCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = this._dpr;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const { nodes, edges } = this.data.graphData;
    const isDark = window.ThemeEngine?.isDark?.() || document.documentElement.getAttribute('data-theme') === 'dark';

    // 计算高亮关联节点集合
    const highlightedIds = this._getHighlightedNodeIds();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(this._transform.x, this._transform.y);
    ctx.scale(this._transform.scale, this._transform.scale);

    // 绘制边
    edges.forEach(e => {
      const sDim = e.source.dimmed;
      const tDim = e.target.dimmed;
      const bothDimmed = sDim && tDim;
      const anyHighlighted = highlightedIds.size > 0 && (
        highlightedIds.has(e.source.id) || highlightedIds.has(e.target.id)
      );
      const edgeHighlighted = highlightedIds.size > 0 && 
        highlightedIds.has(e.source.id) && highlightedIds.has(e.target.id);

      ctx.beginPath();
      ctx.moveTo(e.source.x, e.source.y);
      ctx.lineTo(e.target.x, e.target.y);

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

      // 高亮模式下：关联边加粗加亮，非关联边变暗
      if (highlightedIds.size > 0) {
        if (edgeHighlighted) {
          // 两端都高亮的边 → 加粗加亮
          ctx.strokeStyle = edgeColor;
          ctx.lineWidth = Math.max(1, e.strength * 3);
          ctx.globalAlpha = 1;
        } else if (anyHighlighted) {
          // 一端高亮 → 稍亮
          ctx.strokeStyle = edgeColor;
          ctx.lineWidth = Math.max(0.5, e.strength * 1.5);
          ctx.globalAlpha = 0.6;
        } else {
          // 都不高亮 → 暗化
          ctx.strokeStyle = isDark ? 'rgba(120,120,128,0.1)' : 'rgba(142,142,147,0.1)';
          ctx.lineWidth = 0.5;
          ctx.globalAlpha = 1;
        }
      } else {
        ctx.strokeStyle = edgeColor;
        ctx.lineWidth = Math.max(0.5, e.strength * 2);
        ctx.globalAlpha = 1;
      }

      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // 高亮边显示关系标签
      if (edgeHighlighted && e.label) {
        const mx = (e.source.x + e.target.x) / 2;
        const my = (e.source.y + e.target.y) / 2;
        ctx.fillStyle = isDark ? '#aeaeb2' : '#86868b';
        ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(e.label, mx, my - 4);
      }
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
      const isHovered = this._hovering?.id === n.id;
      const isInSelectedSet = this._selectedNodes.has(n.id);

      // 高亮/暗化判断
      const isHighlighted = highlightedIds.size === 0 || highlightedIds.has(n.id);
      n.dimmed = !isHighlighted;

      ctx.globalAlpha = isHighlighted ? 1 : 0.15;

      // 光晕（选中/悬停/多选）
      if ((isSelected || isHovered || isInSelectedSet) && isHighlighted) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + (isSelf ? 10 : 8), 0, Math.PI * 2);
        ctx.fillStyle = isInSelectedSet ? 'rgba(88,86,214,0.2)' :
                        isSelf ? 'rgba(255,149,0,0.2)' : 'rgba(0,122,255,0.15)';
        ctx.fill();
      }

      // "我自己"额外光晕
      if (isSelf && isHighlighted) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + 12, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,149,0,0.08)';
        ctx.fill();
      }

      // 圆形背景
      ctx.beginPath();
      ctx.arc(n.x, n.y, isSelf ? n.radius + 2 : n.radius, 0, Math.PI * 2);
      if (isSelf) {
        ctx.fillStyle = '#FF9500';
      } else {
        const colors = ['#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF2D55', '#5AC8FA'];
        const colorIdx = Math.abs(this._hashCode(n.id)) % colors.length;
        ctx.fillStyle = isStale ? (isDark ? '#5a5a5e' : '#d1d1d6') : colors[colorIdx];
      }

      // 渐变填充
      const grad = ctx.createRadialGradient(
        n.x - n.radius * 0.3, n.y - n.radius * 0.3, 0,
        n.x, n.y, n.radius
      );
      const baseColor = ctx.fillStyle;
      grad.addColorStop(0, baseColor);
      grad.addColorStop(1, isSelf ? '#FF6B00' : this._darkenColor(baseColor, 0.3));
      ctx.fillStyle = grad;
      ctx.fill();

      // 悬停/选中边框
      if ((isHovered || isSelected) && isHighlighted) {
        ctx.strokeStyle = isDark ? 'rgba(232,236,244,0.6)' : 'rgba(29,29,31,0.8)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      // 多选标记
      if (isInSelectedSet && isHighlighted) {
        ctx.strokeStyle = '#5856D6';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      // 文字
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(10, n.radius * 0.6)}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this._getInitials(n.id), n.x, n.y);

      // 名字标签
      ctx.fillStyle = isHighlighted
        ? (isDark ? '#e5e5ea' : '#1d1d1f')
        : (isDark ? 'rgba(232,236,244,0.15)' : 'rgba(29,29,31,0.15)');
      ctx.font = `${(isHovered || isSelected) && isHighlighted ? '600' : '400'} 11px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(n.id, n.x, n.y + n.radius + 5);

      ctx.globalAlpha = 1;
    });

    // 绘制框选矩形
    if (this._selectionRect) {
      const { x1, y1, x2, y2 } = this._selectionRect;
      ctx.strokeStyle = '#007AFF';
      ctx.lineWidth = 1.5 / this._transform.scale;
      ctx.setLineDash([6 / this._transform.scale, 4 / this._transform.scale]);
      ctx.strokeRect(
        Math.min(x1, x2), Math.min(y1, y2),
        Math.abs(x2 - x1), Math.abs(y2 - y1)
      );
      ctx.fillStyle = 'rgba(0,122,255,0.05)';
      ctx.fillRect(
        Math.min(x1, x2), Math.min(y1, y2),
        Math.abs(x2 - x1), Math.abs(y2 - y1)
      );
      ctx.setLineDash([]);
    }

    ctx.restore();

    // 更新缩放标签
    this._syncZoomLabel();
  },

  /** 颜色加深辅助 */
  _darkenColor(color, amount) {
    // 简单处理：对 hex 颜色加深
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const r = Math.max(0, Math.round(parseInt(hex.substring(0, 2), 16) * (1 - amount)));
      const g = Math.max(0, Math.round(parseInt(hex.substring(2, 4), 16) * (1 - amount)));
      const b = Math.max(0, Math.round(parseInt(hex.substring(4, 6), 16) * (1 - amount)));
      return `rgb(${r},${g},${b})`;
    }
    return color;
  },

  /** 计算高亮关联节点集合 */
  _getHighlightedNodeIds() {
    const ids = new Set();
    if (!this.data.graphData || !this._highlightCenter) return ids;

    const { nodes, edges } = this.data.graphData;
    const centerId = this._highlightCenter;

    if (this._highlightLevel >= 1) {
      ids.add(centerId);
      // 一级关联
      edges.forEach(e => {
        if (e.source.id === centerId) ids.add(e.target.id);
        if (e.target.id === centerId) ids.add(e.source.id);
      });
    }

    if (this._highlightLevel >= 2) {
      // 二级关联：从一级节点再扩展
      const level1Ids = new Set(ids);
      level1Ids.forEach(id => {
        edges.forEach(e => {
          if (e.source.id === id) ids.add(e.target.id);
          if (e.target.id === id) ids.add(e.source.id);
        });
      });
    }

    return ids;
  },

  /** 高亮指定节点的关联 */
  _highlightNode(nodeId, level) {
    this._highlightCenter = nodeId;
    this._highlightLevel = level;
    this._updateLevelButtons();
    this._renderFrame();
  },

  /** 清除高亮 */
  _clearHighlight() {
    this._highlightCenter = null;
    this._highlightLevel = 0;
    this._updateLevelButtons();
    this._renderFrame();
  },

  /** 更新关联级别按钮状态 */
  _updateLevelButtons() {
    const btn1 = document.getElementById('relGraphLevel1');
    const btn2 = document.getElementById('relGraphLevel2');
    const btnAll = document.getElementById('relGraphLevelAll');
    [btn1, btn2, btnAll].forEach(btn => btn?.classList.remove('active'));
    if (this._highlightLevel === 1) btn1?.classList.add('active');
    else if (this._highlightLevel === 2) btn2?.classList.add('active');
    else if (this._highlightLevel === -1) btnAll?.classList.add('active');
  },

  /** 适配视图，确保所有节点可见 */
  _fitView() {
    if (!this.data.graphData) return;
    const { nodes } = this.data.graphData;
    if (nodes.length === 0) return;

    const canvas = document.getElementById('relationshipCanvas');
    if (!canvas) return;
    const dpr = this._dpr;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      minX = Math.min(minX, n.x - n.radius);
      maxX = Math.max(maxX, n.x + n.radius);
      minY = Math.min(minY, n.y - n.radius);
      maxY = Math.max(maxY, n.y + n.radius);
    });

    const padding = 60;
    const contentW = maxX - minX + padding * 2;
    const contentH = maxY - minY + padding * 2;
    const scale = Math.min(w / contentW, h / contentH, 2);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    this._transform = {
      x: w / 2 - centerX * scale,
      y: h / 2 - centerY * scale,
      scale
    };
    this._renderFrame();
  },

  /** 重置布局（重新模拟） */
  _resetLayout() {
    this._clearHighlight();
    this._selectedNodes.clear();
    this._updateSelectModeButton();
    const filtered = this._filterPersons();
    this._drawGraph(filtered);
  },

  /** 同步缩放标签 */
  _syncZoomLabel() {
    const label = document.getElementById('relGraphZoomLabel');
    if (label) {
      label.textContent = Math.round(this._transform.scale * 100) + '%';
    }
  },

  /** 屏幕坐标转图谱坐标 */
  _screenToGraph(e) {
    const canvas = document.getElementById('relationshipCanvas');
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - this._transform.x) / this._transform.scale,
      y: (e.clientY - rect.top - this._transform.y) / this._transform.scale
    };
  },

  /** 命中测试 */
  _hitTest(pos) {
    if (!this.data.graphData) return null;
    for (let i = this.data.graphData.nodes.length - 1; i >= 0; i--) {
      const n = this.data.graphData.nodes[i];
      if (n.dimmed) continue;
      const r = n.radius + 5;
      const dx = pos.x - n.x, dy = pos.y - n.y;
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
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

    // 导入文本按钮
    const importBtn = document.getElementById('relationshipImportBtn');
    if (importBtn) {
      importBtn.addEventListener('click', () => this._showImportDialog());
    }

    // 清空重建按钮
    const clearBtn = document.getElementById('relationshipClearBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this._showClearConfirm());
    }

    // 人物卡片点击
    const list = document.getElementById('relationshipList');
    if (list) {
      list.addEventListener('click', (e) => {
        const card = e.target.closest('.rel-person-card');
        if (card) {
          const personId = card.dataset.personId;
          this.data.selectedPerson = personId;
          this._showPersonDetail(personId);
          this._focusOnPerson(personId);
          this._highlightNode(personId, 1);
        }
      });
    }

    // ===== Canvas 交互事件 =====
    const canvas = document.getElementById('relationshipCanvas');
    if (canvas) {
      let dragStartPos = null;  // 记录 mousedown 位置判断是否为点击
      let hasDragged = false;

      // mousedown：判断是拖节点、框选、还是平移
      canvas.addEventListener('mousedown', (e) => {
        const pos = this._screenToGraph(e);
        const node = this._hitTest(pos);

        if (this._selectionMode && !node) {
          // 框选模式：开始框选
          this._selectionStart = pos;
          this._selectionRect = null;
          this._isPanning = false;
          this._dragging = null;
        } else if (node) {
          // 拖拽节点
          this._dragging = node;
          hasDragged = false;
          dragStartPos = { x: e.clientX, y: e.clientY };
        } else {
          // 平移画布
          this._isPanning = true;
          hasDragged = false;
          dragStartPos = { x: e.clientX, y: e.clientY };
        }
        this._lastMouse = { x: e.clientX, y: e.clientY };
      });

      // mousemove：拖拽/平移/框选/悬停
      canvas.addEventListener('mousemove', (e) => {
        const pos = this._screenToGraph(e);

        // 拖拽节点
        if (this._dragging) {
          this._dragging.x = pos.x;
          this._dragging.y = pos.y;
          this._dragging.vx = 0;
          this._dragging.vy = 0;
          hasDragged = true;
          this._renderFrame();
          return;
        }

        // 框选
        if (this._selectionMode && this._selectionStart) {
          this._selectionRect = {
            x1: this._selectionStart.x,
            y1: this._selectionStart.y,
            x2: pos.x,
            y2: pos.y
          };
          this._renderFrame();
          return;
        }

        // 平移画布
        if (this._isPanning) {
          this._transform.x += e.clientX - this._lastMouse.x;
          this._transform.y += e.clientY - this._lastMouse.y;
          this._lastMouse = { x: e.clientX, y: e.clientY };
          hasDragged = true;
          this._renderFrame();
          return;
        }

        // 悬停
        const node = this._hitTest(pos);
        this._hovering = node;
        canvas.style.cursor = node ? 'pointer' : (this._selectionMode ? 'crosshair' : 'grab');
        this._renderFrame();
      });

      // mouseup：结束拖拽/平移/框选
      canvas.addEventListener('mouseup', (e) => {
        // 框选完成
        if (this._selectionMode && this._selectionRect) {
          this._selectNodesInRect();
          this._selectionRect = null;
          this._selectionStart = null;
          this._renderFrame();
        }

        // 点击（非拖拽）
        if (!hasDragged && dragStartPos) {
          const pos = this._screenToGraph(e);
          const node = this._hitTest(pos);
          if (node) {
            // 点击节点
            this.data.selectedPerson = node.id;
            this._showPersonDetail(node.id);
            this._focusOnPerson(node.id);
            this._highlightNode(node.id, 1);
          } else {
            // 点击空白：清除高亮和选中
            this._clearHighlight();
            this.data.selectedPerson = null;
            this._selectedNodes.clear();
            const panel = document.getElementById('relationshipDetail');
            if (panel) panel.classList.add('hidden');
          }
        }

        this._dragging = null;
        this._isPanning = false;
        dragStartPos = null;
        hasDragged = false;
      });

      canvas.addEventListener('mouseleave', () => {
        this._dragging = null;
        this._isPanning = false;
        this._hovering = null;
        this._selectionRect = null;
        this._selectionStart = null;
        this._renderFrame();
      });

      // 双击：展开二级关联
      canvas.addEventListener('dblclick', (e) => {
        const pos = this._screenToGraph(e);
        const node = this._hitTest(pos);
        if (node) {
          this._highlightNode(node.id, 2);
          this.data.selectedPerson = node.id;
          this._showPersonDetail(node.id);
          this._focusOnPerson(node.id);
        }
      });

      // 滚轮缩放
      canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        this._transform.x = mx - (mx - this._transform.x) * delta;
        this._transform.y = my - (my - this._transform.y) * delta;
        this._transform.scale *= delta;
        this._transform.scale = Math.max(0.2, Math.min(5, this._transform.scale));
        this._renderFrame();
      }, { passive: false });

      // 触摸支持
      let touchStart = null;
      let touchStartDist = 0;
      let touchStartScale = 1;

      canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
          const touch = e.touches[0];
          const pos = this._screenToGraph(touch);
          const node = this._hitTest(pos);
          if (node) {
            this._dragging = node;
          } else {
            this._isPanning = true;
          }
          this._lastMouse = { x: touch.clientX, y: touch.clientY };
          touchStart = { x: touch.clientX, y: touch.clientY };
        } else if (e.touches.length === 2) {
          // 双指缩放
          this._isPanning = false;
          this._dragging = null;
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          touchStartDist = Math.sqrt(dx * dx + dy * dy);
          touchStartScale = this._transform.scale;
        }
      }, { passive: true });

      canvas.addEventListener('touchmove', (e) => {
        if (this._dragging && e.touches.length === 1) {
          e.preventDefault();
          const pos = this._screenToGraph(e.touches[0]);
          this._dragging.x = pos.x;
          this._dragging.y = pos.y;
          this._renderFrame();
        } else if (this._isPanning && e.touches.length === 1) {
          e.preventDefault();
          const touch = e.touches[0];
          this._transform.x += touch.clientX - this._lastMouse.x;
          this._transform.y += touch.clientY - this._lastMouse.y;
          this._lastMouse = { x: touch.clientX, y: touch.clientY };
          this._renderFrame();
        } else if (e.touches.length === 2) {
          e.preventDefault();
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const newScale = touchStartScale * (dist / touchStartDist);
          this._transform.scale = Math.max(0.2, Math.min(5, newScale));
          this._renderFrame();
        }
      }, { passive: false });

      canvas.addEventListener('touchend', () => {
        this._dragging = null;
        this._isPanning = false;
      });
    }

    // ===== 工具栏按钮 =====
    const zoomIn = document.getElementById('relGraphZoomIn');
    const zoomOut = document.getElementById('relGraphZoomOut');
    const fitView = document.getElementById('relGraphFitView');
    const reset = document.getElementById('relGraphReset');
    const level1 = document.getElementById('relGraphLevel1');
    const level2 = document.getElementById('relGraphLevel2');
    const levelAll = document.getElementById('relGraphLevelAll');
    const selectMode = document.getElementById('relGraphSelectMode');

    if (zoomIn) zoomIn.addEventListener('click', () => this._zoomCanvas(1.2));
    if (zoomOut) zoomOut.addEventListener('click', () => this._zoomCanvas(0.8));
    if (fitView) fitView.addEventListener('click', () => this._fitView());
    if (reset) reset.addEventListener('click', () => this._resetLayout());

    if (level1) level1.addEventListener('click', () => {
      if (!this._highlightCenter && this.data.selectedPerson) {
        this._highlightCenter = this.data.selectedPerson;
      }
      if (this._highlightCenter) {
        this._highlightLevel = this._highlightLevel === 1 ? 0 : 1;
        this._updateLevelButtons();
        this._renderFrame();
      }
    });
    if (level2) level2.addEventListener('click', () => {
      if (!this._highlightCenter && this.data.selectedPerson) {
        this._highlightCenter = this.data.selectedPerson;
      }
      if (this._highlightCenter) {
        this._highlightLevel = this._highlightLevel === 2 ? 0 : 2;
        this._updateLevelButtons();
        this._renderFrame();
      }
    });
    if (levelAll) levelAll.addEventListener('click', () => {
      this._clearHighlight();
    });

    if (selectMode) selectMode.addEventListener('click', () => {
      this._selectionMode = !this._selectionMode;
      this._updateSelectModeButton();
      if (!this._selectionMode) {
        this._selectedNodes.clear();
        this._selectionRect = null;
        this._renderFrame();
      }
    });

    // 3秒后隐藏提示
    setTimeout(() => {
      const hint = document.getElementById('relGraphHint');
      if (hint) hint.classList.add('fade-out');
    }, 5000);
  },

  /** 画布缩放 */
  _zoomCanvas(factor) {
    const canvas = document.getElementById('relationshipCanvas');
    if (!canvas) return;
    const dpr = this._dpr;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const cx = w / 2;
    const cy = h / 2;
    const oldScale = this._transform.scale;
    const newScale = Math.max(0.2, Math.min(5, oldScale * factor));
    this._transform.x = cx - (cx - this._transform.x) * (newScale / oldScale);
    this._transform.y = cy - (cy - this._transform.y) * (newScale / oldScale);
    this._transform.scale = newScale;
    this._renderFrame();
  },

  /** 框选节点 */
  _selectNodesInRect() {
    if (!this._selectionRect || !this.data.graphData) return;
    const { x1, y1, x2, y2 } = this._selectionRect;
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);

    this.data.graphData.nodes.forEach(n => {
      if (n.x >= minX && n.x <= maxX && n.y >= minY && n.y <= maxY) {
        this._selectedNodes.add(n.id);
      }
    });

    // 如果选中了多个节点，高亮它们
    if (this._selectedNodes.size > 0) {
      // 将选中的第一个节点作为中心（用于关联按钮）
      this._highlightCenter = [...this._selectedNodes][0];
      this._highlightLevel = 0;
    }
    this._updateLevelButtons();
  },

  /** 更新框选模式按钮状态 */
  _updateSelectModeButton() {
    const btn = document.getElementById('relGraphSelectMode');
    if (!btn) return;
    btn.classList.toggle('active', this._selectionMode);
    const canvas = document.getElementById('relationshipCanvas');
    if (canvas) {
      canvas.style.cursor = this._selectionMode ? 'crosshair' : 'grab';
    }
  },

  /** 聚焦到指定人物（带动画） */
  _focusOnPerson(personId) {
    if (!this.data.graphData) return;
    const node = this.data.graphData.nodes.find(n => n.id === personId);
    if (!node) return;

    const canvas = document.getElementById('relationshipCanvas');
    if (!canvas) return;
    const dpr = this._dpr;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    // 详情面板打开时偏移
    const detailPanel = document.getElementById('relationshipDetail');
    const isDetailOpen = detailPanel && !detailPanel.classList.contains('hidden');
    const offsetX = isDetailOpen ? -100 : 0;

    const targetScale = Math.max(this._transform.scale, 1.2);
    const targetX = w / 2 - node.x * targetScale + offsetX;
    const targetY = h / 2 - node.y * targetScale;

    // 动画过渡
    const startTx = this._transform.x;
    const startTy = this._transform.y;
    const startScale = this._transform.scale;
    let progress = 0;

    const animate = () => {
      progress += 0.05;
      const t = Math.min(1, progress);
      const ease = 1 - Math.pow(1 - t, 3);

      this._transform.x = startTx + (targetX - startTx) * ease;
      this._transform.y = startTy + (targetY - startTy) * ease;
      this._transform.scale = startScale + (targetScale - startScale) * ease;

      this._renderFrame();

      if (t < 1) {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  },

  _bindEmptyEvents() {
    const aiBtn = document.getElementById('relationshipAiBtn');
    if (aiBtn) {
      aiBtn.addEventListener('click', () => this._runAiAnalysis());
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

    // 聚焦该人物（含详情面板偏移）
    this._focusOnPerson(personId);

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
        this._clearHighlight();
        // 恢复适配视图
        this._fitView();
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
      el.addEventListener('click', () => {
        const pid = el.dataset.personId;
        this.data.selectedPerson = pid;
        this._showPersonDetail(pid);
        this._focusOnPerson(pid);
        this._highlightNode(pid, 1);
      });
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

  // ===== 清空重建功能 =====

  /** 显示清空确认弹窗 */
  _showClearConfirm() {
    const existing = document.getElementById('relClearModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'relClearModal';
    modal.className = 'rel-import-modal';
    modal.innerHTML = `
      <div class="rel-import-overlay"></div>
      <div class="rel-import-dialog" style="max-width:400px;">
        <div class="rel-import-header">
          <h3>🗑 清空人脉图谱</h3>
          <button class="rel-import-close" id="relClearClose">✕</button>
        </div>
        <div class="rel-import-body">
          <p style="color:var(--text-secondary);line-height:1.6;margin-bottom:12px;">
            确定要清空所有人脉数据吗？此操作将删除所有人物和关系记录，不可恢复。
          </p>
          <p style="color:var(--text-tertiary);font-size:12px;">
            清空后可通过「AI 分析」重新扫描，或通过「导入文本」重新导入。
          </p>
        </div>
        <div class="rel-import-footer">
          <button class="rel-import-btn secondary" id="relClearCancelBtn">取消</button>
          <button class="rel-import-btn danger" id="relClearConfirmBtn">确认清空</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('relClearClose')?.addEventListener('click', () => modal.remove());
    document.getElementById('relClearCancelBtn')?.addEventListener('click', () => modal.remove());
    modal.querySelector('.rel-import-overlay')?.addEventListener('click', () => modal.remove());
    document.getElementById('relClearConfirmBtn')?.addEventListener('click', () => {
      modal.remove();
      this._clearAndRebuild();
    });
  },

  /** 执行清空并重新加载 */
  async _clearAndRebuild() {
    this._showToast('正在清空人脉数据...', 'info');
    try {
      const result = await window.electronAPI?.relationshipClear?.();
      if (result?.success) {
        this.data.persons = [];
        this.data.relations = [];
        this.data.stats = null;
        this.data.graphData = null;
        this.data.selectedPerson = null;
        this._renderEmpty();
        this._showToast('人脉数据已清空', 'success');
      } else {
        this._showToast('清空失败: ' + (result?.error || '未知错误'), 'error');
      }
    } catch (err) {
      this._showToast('清空失败: ' + err.message, 'error');
    }
  },

  // ===== 文本导入功能 =====

  /** 显示导入文本弹窗 */
  _showImportDialog() {
    // 移除已有弹窗
    const existing = document.getElementById('relImportModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'relImportModal';
    modal.className = 'rel-import-modal';
    modal.innerHTML = `
      <div class="rel-import-overlay"></div>
      <div class="rel-import-dialog">
        <div class="rel-import-header">
          <h3>📝 导入人脉文本</h3>
          <button class="rel-import-close" id="relImportClose">✕</button>
        </div>
        <div class="rel-import-body">
          <p class="rel-import-hint">粘贴包含人名和关系的文本，AI 将自动提取人物和关系：</p>
          <textarea id="relImportTextarea" class="rel-import-textarea" rows="6"
            placeholder="例如：参会人员：张三（产品总监）、李四（技术负责人）、王五（客户侧 PM）&#10;CEO 赵六，下辖 CTO 孙七、CFO 周八"></textarea>
          <p class="rel-import-tip">💡 支持会议纪要、组织架构描述、项目通讯录等格式</p>
          <div id="relImportPreview" class="rel-import-preview" style="display:none;"></div>
        </div>
        <div class="rel-import-footer">
          <button class="rel-import-btn secondary" id="relImportCancelBtn">取消</button>
          <button class="rel-import-btn" id="relImportParseBtn">解析</button>
          <button class="rel-import-btn primary" id="relImportConfirmBtn" style="display:none;">确认导入</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // 绑定事件
    document.getElementById('relImportClose')?.addEventListener('click', () => this._closeImportDialog());
    document.getElementById('relImportCancelBtn')?.addEventListener('click', () => this._closeImportDialog());
    modal.querySelector('.rel-import-overlay')?.addEventListener('click', () => this._closeImportDialog());
    document.getElementById('relImportParseBtn')?.addEventListener('click', () => this._parseImportText());
    document.getElementById('relImportConfirmBtn')?.addEventListener('click', () => this._confirmImport());
  },

  /** 关闭导入弹窗 */
  _closeImportDialog() {
    const modal = document.getElementById('relImportModal');
    if (modal) modal.remove();
    this._importPreviewData = null;
  },

  /** 调用 AI 解析文本 */
  async _parseImportText() {
    const text = document.getElementById('relImportTextarea')?.value?.trim();
    if (!text || text.length < 10) {
      this._showToast('请输入至少10个字符的文本', 'warning');
      return;
    }

    const parseBtn = document.getElementById('relImportParseBtn');
    if (parseBtn) {
      parseBtn.disabled = true;
      parseBtn.textContent = '解析中...';
    }

    this._showToast('AI 正在解析文本...', 'info');

    try {
      const result = await window.electronAPI?.relationshipImportText?.({ text });
      if (result?.success) {
        this._importPreviewData = result;
        this._renderImportPreview(result.persons, result.relations);
        // 显示确认按钮，隐藏解析按钮
        const confirmBtn = document.getElementById('relImportConfirmBtn');
        if (confirmBtn) confirmBtn.style.display = 'inline-flex';
        if (parseBtn) { parseBtn.style.display = 'none'; }
        this._showToast(`提取到 ${result.persons.length} 个人物，${result.relations.length} 条关系`, 'success');
      } else {
        this._showToast('解析失败: ' + (result?.error || '未知错误'), 'error');
      }
    } catch (err) {
      this._showToast('解析失败: ' + err.message, 'error');
    } finally {
      if (parseBtn) {
        parseBtn.disabled = false;
        parseBtn.textContent = '解析';
      }
    }
  },

  /** 渲染预览区 */
  _renderImportPreview(persons, relations) {
    const preview = document.getElementById('relImportPreview');
    if (!preview) return;
    preview.style.display = 'block';

    const personHtml = persons.map(p => {
      const info = [p.name];
      if (p.role) info.push(`· ${p.role}`);
      if (p.company) info.push(`@ ${p.company}`);
      if (p.relation_to_user) info.push(`(${p.relation_to_user})`);
      return `<span class="rel-preview-person">👤 ${info.join(' ')}</span>`;
    }).join('');

    const relHtml = relations.length > 0 ? relations.map(r =>
      `<span class="rel-preview-relation">🔗 ${r.source} → ${r.target} (${r.label || r.type})</span>`
    ).join('') : '<span style="color:var(--text-tertiary);">未识别到关系</span>';

    preview.innerHTML = `
      <div class="rel-preview-header">提取到 ${persons.length} 个人物，${relations.length} 条关系</div>
      <div class="rel-preview-persons">${personHtml}</div>
      <div class="rel-preview-relations">${relHtml}</div>
    `;
  },

  /** 确认导入 */
  async _confirmImport() {
    if (!this._importPreviewData) return;

    const confirmBtn = document.getElementById('relImportConfirmBtn');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = '导入中...';
    }

    try {
      const result = await window.electronAPI?.relationshipMergeImported?.({
        persons: this._importPreviewData.persons,
        relations: this._importPreviewData.relations
      });

      if (result?.success) {
        this._showToast(`已导入 ${result.merged.persons} 人物, ${result.merged.relations} 条关系`, 'success');
        this._closeImportDialog();
        // 更新本地数据并重新渲染
        if (result.data) {
          this.data.persons = result.data.persons || [];
          this.data.relations = result.data.relations || [];
          this.data.stats = result.data.stats || null;
        }
        this._render();
      } else {
        this._showToast('导入失败: ' + (result?.error || '未知错误'), 'error');
      }
    } catch (err) {
      this._showToast('导入失败: ' + err.message, 'error');
    } finally {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = '确认导入';
      }
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
