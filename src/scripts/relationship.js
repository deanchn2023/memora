/**
 * Memora v2.5 — 人脉图谱 (Relationship Graph)
 * 7 类实体 + 12 类关系的产品架构师团队全景图谱
 * 
 * 交互：拖拽/平移/缩放/高亮/多级关联/框选/条件展开
 * 数据：RelationshipSchema + RelationshipStore + flagmap-customers.json
 */

const Relationship = {
  data: {
    subgraph: null,     // 当前展示的子图 { nodes, edges }
    filterLabel: 'all', // 当前筛选的实体类型
    filterRegion: '',   // 筛选区域
    filterIndustry: '', // 筛选行业
    searchQuery: '',
    selectedNode: null,
    graphData: null     // 力导向图渲染数据
  },

  initialized: false,

  // 交互状态
  _transform: { x: 0, y: 0, scale: 1 },
  _dragging: null,
  _isPanning: false,
  _lastMouse: { x: 0, y: 0 },
  _hovering: null,
  _highlightLevel: 0,
  _highlightCenter: null,
  _selectedNodes: new Set(),
  _selectionMode: false,
  _selectionRect: null,
  _selectionStart: null,
  _dpr: 1,

  init() {
    if (this.initialized) return;
    this.initialized = true;
    this._dpr = window.devicePixelRatio || 1;
    console.log('[Relationship] Module loaded');
  },

  /** 切换到人脉标签时调用 */
  async load() {
    if (this._graphAnimId) {
      cancelAnimationFrame(this._graphAnimId);
      this._graphAnimId = null;
    }

    const container = document.getElementById('relationshipContent');
    if (!container) return;

    container.innerHTML = '<div class="insight-loading"><div class="spinner"></div><span>加载人脉图谱...</span></div>';

    // 确保数据已加载
    const store = window.RelationshipStore;
    if (!store) { this._renderError('数据管理器未加载'); return; }
    const graphData = store.getData();

    // 如果没有数据，提示初始化
    if (!graphData.nodes || graphData.nodes.length === 0) {
      this._renderInit();
      return;
    }

    this._render();
  },

  /** 渲染初始化页面 */
  _renderInit() {
    const container = document.getElementById('relationshipContent');
    if (!container) return;
    container.innerHTML = `
      <div class="insight-empty" style="padding:60px 20px;text-align:center;">
        <div class="insight-empty-icon" style="font-size:48px;margin-bottom:16px;">👥</div>
        <div style="font-size:16px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">人脉图谱未初始化</div>
        <div style="font-size:13px;color:var(--text-tertiary);max-width:400px;margin:0 auto;line-height:1.6;">
          点击下方按钮，从产品架构师团队数据初始化图谱，包含区域、行业、客户、产品等完整关系网络
        </div>
        <button class="relationship-ai-btn" style="margin-top:20px;" id="relInitBtn">🚀 初始化图谱</button>
      </div>
    `;
    document.getElementById('relInitBtn')?.addEventListener('click', () => this._initGraphFromData());
  },

  /** 从初始数据初始化图谱 */
  async _initGraphFromData() {
    this._showToast('正在初始化图谱数据...', 'info');
    try {
      // 加载客户数据
      let customerData = {};
      try {
        const resp = await fetch('data/flagmap-customers.json');
        if (resp.ok) customerData = await resp.json();
      } catch (e) {
        console.warn('[Relationship] Failed to load customer data, using empty:', e);
      }

      const store = window.RelationshipStore;
      const initialData = window.INITIAL_DATA;
      if (!store || !initialData) {
        this._showToast('数据管理器或初始数据未加载', 'error');
        return;
      }

      const stats = store.initFromInitialData(initialData, customerData);
      this._showToast(`图谱初始化完成：${stats.total} 个节点, ${stats.totalEdges} 条边`, 'success');
      this._render();
    } catch (err) {
      console.error('[Relationship] Init error:', err);
      this._showToast('初始化失败: ' + err.message, 'error');
    }
  },

  /** 主渲染逻辑 */
  _render() {
    const container = document.getElementById('relationshipContent');
    if (!container) return;

    const store = window.RelationshipStore;
    const schema = window.RelationshipSchema;
    const stats = store.getStats();

    // 加载默认子图（概览模式）
    const subgraph = store.expandSubgraph({ labels: ['Architect', 'Region', 'Industry'] });
    this.data.subgraph = subgraph;

    container.innerHTML = `
      <div class="relationship-layout">
        <!-- 左侧：统计 + 筛选 + 列表 -->
        <div class="relationship-sidebar">
          <div class="relationship-stats">
            ${Object.entries(stats.byType).map(([label, count]) => {
              const info = schema.nodeTypes[label];
              return info ? `<div class="rel-stat-chip"><span class="rel-stat-value">${count}</span><span class="rel-stat-label">${info.icon} ${info.label}</span></div>` : '';
            }).join('<span class="stat-dot">·</span>')}
          </div>

          <div class="relationship-toolbar">
            <input type="text" class="relationship-search" id="relationshipSearch"
              placeholder="搜索架构师、客户、行业...">
            <div class="relationship-filters">
              <button class="rel-filter-btn active" data-filter="all">全部</button>
              ${Object.entries(schema.nodeTypes).map(([label, info]) =>
                `<button class="rel-filter-btn" data-filter="${label}">${info.icon} ${info.label}</button>`
              ).join('')}
            </div>
            <div class="rel-toolbar-row">
              <select id="relRegionFilter" class="rel-select">
                <option value="">所有区域</option>
                <option value="北区">北区</option>
                <option value="东区">东区</option>
                <option value="南区">南区</option>
              </select>
              <select id="relIndustryFilter" class="rel-select">
                <option value="">所有行业</option>
                ${store.getNodesByLabel('Industry').map(n =>
                  `<option value="${this._esc(n.properties.name)}">${n.properties.name}</option>`
                ).join('')}
              </select>
            </div>
            <div class="rel-toolbar-row">
              <button class="relationship-ai-btn secondary" id="relExpandBtn">🔍 展开</button>
              <button class="relationship-ai-btn secondary" id="relImportBtn">📥 导入</button>
              <button class="relationship-ai-btn secondary" id="relExportBtn">📤 导出</button>
              <button class="relationship-ai-btn danger" id="relClearBtn">🗑 清空</button>
            </div>
          </div>

          <div class="relationship-list" id="relationshipList">
            ${this._renderNodeList(subgraph.nodes)}
          </div>
        </div>

        <!-- 右侧：图谱 + 详情 -->
        <div class="relationship-main">
          <div class="relationship-graph-area" id="relationshipGraphArea">
            <canvas id="relationshipCanvas" width="800" height="600"></canvas>
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
            <div class="graph-hint" id="relGraphHint">
              <span>拖拽节点 · 滚轮缩放 · 点击查看关联 · 双击展开二级</span>
            </div>
          </div>
          <!-- 节点详情面板 -->
          <div class="relationship-detail hidden" id="relationshipDetail">
            <div id="relationshipDetailContent"></div>
          </div>
        </div>
      </div>
    `;

    this._bindEvents();
    requestAnimationFrame(() => this._drawGraph(subgraph.nodes, subgraph.edges));
  },

  /** 渲染节点列表 */
  _renderNodeList(nodes) {
    if (!nodes || nodes.length === 0) {
      return `<div class="insight-empty" style="padding:30px;text-align:center;">
        <div style="font-size:13px;color:var(--text-tertiary);">未找到匹配节点</div>
      </div>`;
    }

    const schema = window.RelationshipSchema;
    // 按类型分组，最多显示50个
    const limit = 50;
    const shown = nodes.slice(0, limit);
    const remaining = nodes.length - limit;

    return shown.map(n => {
      const info = schema.nodeTypes[n.label];
      const icon = info?.icon || '●';
      const color = info?.color || '#8E8E93';
      const name = n.properties.name || n.id;
      const meta = this._getNodeMeta(n);
      return `<div class="rel-person-card" data-node-id="${this._esc(n.id)}" data-label="${n.label}">
        <div class="rel-person-avatar" style="background:${color};">${icon}</div>
        <div class="rel-person-info">
          <div class="rel-person-header">
            <span class="rel-person-name">${this._esc(name)}</span>
            ${meta.badge ? `<span class="rel-person-role">${meta.badge}</span>` : ''}
          </div>
          <div class="rel-person-meta">
            <span class="rel-meta-item">${info?.label || n.label}</span>
            ${meta.tags}
          </div>
        </div>
      </div>`;
    }).join('') + (remaining > 0 ? `<div style="text-align:center;padding:8px;color:var(--text-tertiary);font-size:12px;">还有 ${remaining} 个节点，请缩小筛选范围</div>` : '');
  },

  /** 获取节点的元信息 */
  _getNodeMeta(node) {
    const p = node.properties;
    const schema = window.RelationshipSchema;
    let badge = '';
    let tags = '';

    switch (node.label) {
      case 'Architect':
        badge = p.role || '';
        const city = p.cityId ? window.RelationshipStore?.getNode(p.cityId)?.properties?.name : '';
        if (city) tags = `<span class="rel-meta-item">🏙 ${city}</span>`;
        break;
      case 'Customer':
        badge = p.tier || '';
        const tierColor = schema.tierColors[p.tier] || '#8E8E93';
        if (p.status) tags = `<span class="rel-meta-item" style="color:${schema.statusColors[p.status] || '#8E8E93'}">${p.status}</span>`;
        break;
      case 'Industry':
        if (p.priority === 'high') badge = '🔥 重点';
        break;
      case 'Case':
        badge = p.status || '';
        break;
    }

    return { badge, tags };
  },

  // ===== 图谱绘制 =====

  /** 绘制力导向图 */
  _drawGraph(nodes, edges) {
    const canvas = document.getElementById('relationshipCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = this._dpr;
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

    if (!nodes || nodes.length === 0) {
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-tertiary').trim() || '#aeaeb2';
      ctx.font = '14px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('暂无数据', w / 2, h / 2);
      ctx.restore();
      return;
    }

    const schema = window.RelationshipSchema;

    // 构建力导向节点
    const graphNodes = nodes.map(n => {
      const info = schema.nodeTypes[n.label];
      return {
        id: n.id,
        label: n.label,
        x: w / 2 + (Math.random() - 0.5) * w * 0.6,
        y: h / 2 + (Math.random() - 0.5) * h * 0.6,
        vx: 0, vy: 0,
        radius: Math.max(14, Math.min(40, info?.size || 20)),
        node: n,
        dimmed: false
      };
    });

    // 构建边
    const nodeIdSet = new Set(graphNodes.map(n => n.id));
    const graphEdges = (edges || []).filter(e => nodeIdSet.has(e.source) && nodeIdSet.has(e.target)).map(e => {
      const source = graphNodes.find(n => n.id === e.source);
      const target = graphNodes.find(n => n.id === e.target);
      const eInfo = schema.edgeTypes[e.type];
      return {
        source, target,
        type: e.type,
        label: eInfo?.label || e.type,
        color: eInfo?.color || '#8E8E93',
        dashed: eInfo?.dashed || false,
        properties: e.properties || {}
      };
    });

    this.data.graphData = { nodes: graphNodes, edges: graphEdges };
    this._transform = { x: 0, y: 0, scale: 1 };
    this._highlightLevel = 0;
    this._highlightCenter = null;
    this._selectedNodes.clear();
    this._selectionMode = false;

    // 力导向模拟
    let iterations = 0;
    const maxIter = graphNodes.length > 50 ? 60 : 120;
    const repulse = graphNodes.length > 50 ? 1500 : 2500;

    const simulate = () => {
      iterations++;
      // 斥力
      for (let i = 0; i < graphNodes.length; i++) {
        for (let j = i + 1; j < graphNodes.length; j++) {
          const dx = graphNodes[j].x - graphNodes[i].x;
          const dy = graphNodes[j].y - graphNodes[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = repulse / (dist * dist);
          const fx = (dx / dist) * force, fy = (dy / dist) * force;
          graphNodes[i].vx -= fx; graphNodes[i].vy -= fy;
          graphNodes[j].vx += fx; graphNodes[j].vy += fy;
        }
      }
      // 引力
      graphEdges.forEach(e => {
        const dx = e.target.x - e.source.x, dy = e.target.y - e.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const ideal = e.source.label === e.target.label ? 120 : 160;
        const force = (dist - ideal) * 0.02;
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        e.source.vx += fx; e.source.vy += fy;
        e.target.vx -= fx; e.target.vy -= fy;
      });
      // 向心力 + 阻尼
      graphNodes.forEach(n => {
        n.vx += (w / 2 - n.x) * 0.002;
        n.vy += (h / 2 - n.y) * 0.002;
        n.vx *= 0.82; n.vy *= 0.82;
        n.x += n.vx; n.y += n.vy;
        n.x = Math.max(n.radius + 10, Math.min(w - n.radius - 10, n.x));
        n.y = Math.max(n.radius + 10, Math.min(h - n.radius - 10, n.y));
      });

      this._renderFrame();
      if (iterations < maxIter) {
        this._graphAnimId = requestAnimationFrame(simulate);
      } else {
        this._fitView();
      }
    };

    if (this._graphAnimId) cancelAnimationFrame(this._graphAnimId);
    simulate();
  },

  /** 渲染一帧 */
  _renderFrame() {
    if (!this.data.graphData) return;
    const canvas = document.getElementById('relationshipCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = this._dpr;
    const w = canvas.width / dpr, h = canvas.height / dpr;
    const { nodes, edges } = this.data.graphData;
    const schema = window.RelationshipSchema;
    const isDark = window.ThemeEngine?.isDark?.() || document.documentElement.getAttribute('data-theme') === 'dark';
    const highlightedIds = this._getHighlightedNodeIds();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(this._transform.x, this._transform.y);
    ctx.scale(this._transform.scale, this._transform.scale);

    // 绘制边
    edges.forEach(e => {
      const sDim = e.source.dimmed, tDim = e.target.dimmed;
      const bothDimmed = sDim && tDim;
      const edgeHighlighted = highlightedIds.size > 0 && highlightedIds.has(e.source.id) && highlightedIds.has(e.target.id);
      const anyHighlighted = highlightedIds.size > 0 && (highlightedIds.has(e.source.id) || highlightedIds.has(e.target.id));

      ctx.beginPath();
      ctx.moveTo(e.source.x, e.source.y);
      ctx.lineTo(e.target.x, e.target.y);
      ctx.setLineDash(e.dashed ? [4, 4] : []);

      if (highlightedIds.size > 0) {
        if (edgeHighlighted) {
          ctx.strokeStyle = e.color;
          ctx.lineWidth = 2.5;
          ctx.globalAlpha = 1;
        } else if (anyHighlighted) {
          ctx.strokeStyle = e.color;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 0.5;
        } else {
          ctx.strokeStyle = isDark ? 'rgba(120,120,128,0.08)' : 'rgba(142,142,147,0.08)';
          ctx.lineWidth = 0.5;
          ctx.globalAlpha = 1;
        }
      } else {
        ctx.strokeStyle = e.color;
        ctx.lineWidth = Math.max(0.5, 1.2);
        ctx.globalAlpha = 0.6;
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // 高亮边显示标签
      if (edgeHighlighted && e.label) {
        const mx = (e.source.x + e.target.x) / 2, my = (e.source.y + e.target.y) / 2;
        ctx.fillStyle = isDark ? '#aeaeb2' : '#86868b';
        ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(e.label, mx, my - 3);
      }
    });

    // 绘制节点
    nodes.forEach(n => {
      const info = schema.nodeTypes[n.label];
      const isHighlighted = highlightedIds.size === 0 || highlightedIds.has(n.id);
      n.dimmed = !isHighlighted;
      ctx.globalAlpha = isHighlighted ? 1 : 0.12;

      const isHovered = this._hovering?.id === n.id;
      const isSelected = this.data.selectedNode === n.id;
      const isInSelected = this._selectedNodes.has(n.id);
      const color = info?.color || '#8E8E93';

      // 光晕
      if ((isSelected || isHovered || isInSelected) && isHighlighted) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + 8, 0, Math.PI * 2);
        ctx.fillStyle = isInSelected ? 'rgba(88,86,214,0.2)' : color.replace(')', ',0.15)').replace('rgb', 'rgba');
        ctx.fill();
      }

      // 圆形
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      const grad = ctx.createRadialGradient(n.x - n.radius * 0.3, n.y - n.radius * 0.3, 0, n.x, n.y, n.radius);
      grad.addColorStop(0, color);
      grad.addColorStop(1, this._darkenColor(color, 0.3));
      ctx.fillStyle = grad;
      ctx.fill();

      // 悬停/选中边框
      if ((isHovered || isSelected) && isHighlighted) {
        ctx.strokeStyle = isDark ? 'rgba(232,236,244,0.6)' : 'rgba(29,29,31,0.8)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      if (isInSelected && isHighlighted) {
        ctx.strokeStyle = '#5856D6';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      // 图标
      const icon = info?.icon || '';
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(11, n.radius * 0.55)}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(icon, n.x, n.y);

      // 名字标签
      const name = n.node?.properties?.name || n.id;
      ctx.fillStyle = isHighlighted ? (isDark ? '#e5e5ea' : '#1d1d1f') : (isDark ? 'rgba(232,236,244,0.12)' : 'rgba(29,29,31,0.12)');
      ctx.font = `${(isHovered || isSelected) && isHighlighted ? '600 ' : ''}10px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textBaseline = 'top';
      // 截断长名字
      const displayName = name.length > 8 ? name.substring(0, 7) + '…' : name;
      ctx.fillText(displayName, n.x, n.y + n.radius + 4);

      ctx.globalAlpha = 1;
    });

    // 框选矩形
    if (this._selectionRect) {
      const { x1, y1, x2, y2 } = this._selectionRect;
      ctx.strokeStyle = '#007AFF';
      ctx.lineWidth = 1.5 / this._transform.scale;
      ctx.setLineDash([6 / this._transform.scale, 4 / this._transform.scale]);
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      ctx.fillStyle = 'rgba(0,122,255,0.05)';
      ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      ctx.setLineDash([]);
    }

    ctx.restore();
    this._syncZoomLabel();
  },

  // ===== 交互方法（复用前版） =====

  _darkenColor(color, amount) {
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const r = Math.max(0, Math.round(parseInt(hex.substring(0, 2), 16) * (1 - amount)));
      const g = Math.max(0, Math.round(parseInt(hex.substring(2, 4), 16) * (1 - amount)));
      const b = Math.max(0, Math.round(parseInt(hex.substring(4, 6), 16) * (1 - amount)));
      return `rgb(${r},${g},${b})`;
    }
    return color;
  },

  _getHighlightedNodeIds() {
    const ids = new Set();
    if (!this.data.graphData || !this._highlightCenter) return ids;
    const { nodes, edges } = this.data.graphData;
    if (this._highlightLevel >= 1) {
      ids.add(this._highlightCenter);
      edges.forEach(e => {
        if (e.source.id === this._highlightCenter) ids.add(e.target.id);
        if (e.target.id === this._highlightCenter) ids.add(e.source.id);
      });
    }
    if (this._highlightLevel >= 2) {
      const l1 = new Set(ids);
      l1.forEach(id => edges.forEach(e => {
        if (e.source.id === id) ids.add(e.target.id);
        if (e.target.id === id) ids.add(e.source.id);
      }));
    }
    return ids;
  },

  _highlightNode(nodeId, level) {
    this._highlightCenter = nodeId;
    this._highlightLevel = level;
    this._updateLevelButtons();
    this._renderFrame();
  },

  _clearHighlight() {
    this._highlightCenter = null;
    this._highlightLevel = 0;
    this._updateLevelButtons();
    this._renderFrame();
  },

  _updateLevelButtons() {
    const btn1 = document.getElementById('relGraphLevel1');
    const btn2 = document.getElementById('relGraphLevel2');
    const btnAll = document.getElementById('relGraphLevelAll');
    [btn1, btn2, btnAll].forEach(b => b?.classList.remove('active'));
    if (this._highlightLevel === 1) btn1?.classList.add('active');
    else if (this._highlightLevel === 2) btn2?.classList.add('active');
    else if (this._highlightLevel === -1) btnAll?.classList.add('active');
  },

  _fitView() {
    if (!this.data.graphData) return;
    const { nodes } = this.data.graphData;
    if (nodes.length === 0) return;
    const canvas = document.getElementById('relationshipCanvas');
    if (!canvas) return;
    const dpr = this._dpr, w = canvas.width / dpr, h = canvas.height / dpr;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach(n => { minX = Math.min(minX, n.x - n.radius); maxX = Math.max(maxX, n.x + n.radius); minY = Math.min(minY, n.y - n.radius); maxY = Math.max(maxY, n.y + n.radius); });
    const pad = 60;
    const scale = Math.min(w / (maxX - minX + pad * 2), h / (maxY - minY + pad * 2), 2);
    this._transform = { x: w / 2 - (minX + maxX) / 2 * scale, y: h / 2 - (minY + maxY) / 2 * scale, scale };
    this._renderFrame();
  },

  _resetLayout() {
    this._clearHighlight();
    this._selectedNodes.clear();
    this._updateSelectModeButton();
    const sub = this.data.subgraph;
    if (sub) this._drawGraph(sub.nodes, sub.edges);
  },

  _syncZoomLabel() {
    const label = document.getElementById('relGraphZoomLabel');
    if (label) label.textContent = Math.round(this._transform.scale * 100) + '%';
  },

  _screenToGraph(e) {
    const canvas = document.getElementById('relationshipCanvas');
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left - this._transform.x) / this._transform.scale, y: (e.clientY - rect.top - this._transform.y) / this._transform.scale };
  },

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

  _zoomCanvas(factor) {
    const canvas = document.getElementById('relationshipCanvas');
    if (!canvas) return;
    const dpr = this._dpr, w = canvas.width / dpr, h = canvas.height / dpr;
    const cx = w / 2, cy = h / 2;
    const oldScale = this._transform.scale;
    const newScale = Math.max(0.2, Math.min(5, oldScale * factor));
    this._transform.x = cx - (cx - this._transform.x) * (newScale / oldScale);
    this._transform.y = cy - (cy - this._transform.y) * (newScale / oldScale);
    this._transform.scale = newScale;
    this._renderFrame();
  },

  _selectNodesInRect() {
    if (!this._selectionRect || !this.data.graphData) return;
    const { x1, y1, x2, y2 } = this._selectionRect;
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2), minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    this.data.graphData.nodes.forEach(n => {
      if (n.x >= minX && n.x <= maxX && n.y >= minY && n.y <= maxY) this._selectedNodes.add(n.id);
    });
    if (this._selectedNodes.size > 0) {
      this._highlightCenter = [...this._selectedNodes][0];
      this._highlightLevel = 0;
    }
    this._updateLevelButtons();
  },

  _updateSelectModeButton() {
    const btn = document.getElementById('relGraphSelectMode');
    if (btn) btn.classList.toggle('active', this._selectionMode);
    const canvas = document.getElementById('relationshipCanvas');
    if (canvas) canvas.style.cursor = this._selectionMode ? 'crosshair' : 'grab';
  },

  _focusOnNode(nodeId) {
    if (!this.data.graphData) return;
    const node = this.data.graphData.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const canvas = document.getElementById('relationshipCanvas');
    if (!canvas) return;
    const dpr = this._dpr, w = canvas.width / dpr, h = canvas.height / dpr;
    const detailPanel = document.getElementById('relationshipDetail');
    const offsetX = detailPanel && !detailPanel.classList.contains('hidden') ? -100 : 0;
    const targetScale = Math.max(this._transform.scale, 1.2);
    const targetX = w / 2 - node.x * targetScale + offsetX;
    const targetY = h / 2 - node.y * targetScale;
    const startTx = this._transform.x, startTy = this._transform.y, startScale = this._transform.scale;
    let progress = 0;
    const animate = () => {
      progress += 0.05;
      const t = Math.min(1, progress);
      const ease = 1 - Math.pow(1 - t, 3);
      this._transform.x = startTx + (targetX - startTx) * ease;
      this._transform.y = startTy + (targetY - startTy) * ease;
      this._transform.scale = startScale + (targetScale - startScale) * ease;
      this._renderFrame();
      if (t < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  },

  // ===== 事件绑定 =====

  _bindEvents() {
    const store = window.RelationshipStore;
    const schema = window.RelationshipSchema;

    // 搜索
    const searchInput = document.getElementById('relationshipSearch');
    if (searchInput) {
      let timer;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          this.data.searchQuery = e.target.value;
          this._applyFilters();
        }, 300);
      });
    }

    // 类型筛选
    document.querySelectorAll('.rel-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.rel-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.data.filterLabel = btn.dataset.filter;
        this._applyFilters();
      });
    });

    // 区域/行业筛选
    document.getElementById('relRegionFilter')?.addEventListener('change', (e) => {
      this.data.filterRegion = e.target.value;
      this._applyFilters();
    });
    document.getElementById('relIndustryFilter')?.addEventListener('change', (e) => {
      this.data.filterIndustry = e.target.value;
      this._applyFilters();
    });

    // 展开按钮
    document.getElementById('relExpandBtn')?.addEventListener('click', () => this._applyFilters());

    // 导入
    document.getElementById('relImportBtn')?.addEventListener('click', () => this._showImportDialog());
    // 导出
    document.getElementById('relExportBtn')?.addEventListener('click', () => this._exportGraph());
    // 清空
    document.getElementById('relClearBtn')?.addEventListener('click', () => this._showClearConfirm());

    // 节点列表点击
    document.getElementById('relationshipList')?.addEventListener('click', (e) => {
      const card = e.target.closest('.rel-person-card');
      if (card) {
        const nodeId = card.dataset.nodeId;
        this.data.selectedNode = nodeId;
        this._showNodeDetail(nodeId);
        this._focusOnNode(nodeId);
        this._highlightNode(nodeId, 1);
      }
    });

    // Canvas 交互（复用之前的逻辑）
    this._bindCanvasEvents();

    // 工具栏按钮
    document.getElementById('relGraphZoomIn')?.addEventListener('click', () => this._zoomCanvas(1.2));
    document.getElementById('relGraphZoomOut')?.addEventListener('click', () => this._zoomCanvas(0.8));
    document.getElementById('relGraphFitView')?.addEventListener('click', () => this._fitView());
    document.getElementById('relGraphReset')?.addEventListener('click', () => this._resetLayout());

    document.getElementById('relGraphLevel1')?.addEventListener('click', () => {
      if (!this._highlightCenter && this.data.selectedNode) this._highlightCenter = this.data.selectedNode;
      if (this._highlightCenter) { this._highlightLevel = this._highlightLevel === 1 ? 0 : 1; this._updateLevelButtons(); this._renderFrame(); }
    });
    document.getElementById('relGraphLevel2')?.addEventListener('click', () => {
      if (!this._highlightCenter && this.data.selectedNode) this._highlightCenter = this.data.selectedNode;
      if (this._highlightCenter) { this._highlightLevel = this._highlightLevel === 2 ? 0 : 2; this._updateLevelButtons(); this._renderFrame(); }
    });
    document.getElementById('relGraphLevelAll')?.addEventListener('click', () => this._clearHighlight());

    document.getElementById('relGraphSelectMode')?.addEventListener('click', () => {
      this._selectionMode = !this._selectionMode;
      this._updateSelectModeButton();
      if (!this._selectionMode) { this._selectedNodes.clear(); this._selectionRect = null; this._renderFrame(); }
    });

    setTimeout(() => {
      const hint = document.getElementById('relGraphHint');
      if (hint) hint.classList.add('fade-out');
    }, 5000);
  },

  /** Canvas 事件绑定 */
  _bindCanvasEvents() {
    const canvas = document.getElementById('relationshipCanvas');
    if (!canvas) return;

    let dragStartPos = null, hasDragged = false;

    canvas.addEventListener('mousedown', (e) => {
      const pos = this._screenToGraph(e);
      const node = this._hitTest(pos);
      if (this._selectionMode && !node) {
        this._selectionStart = pos; this._selectionRect = null; this._isPanning = false; this._dragging = null;
      } else if (node) {
        this._dragging = node; hasDragged = false; dragStartPos = { x: e.clientX, y: e.clientY };
      } else {
        this._isPanning = true; hasDragged = false; dragStartPos = { x: e.clientX, y: e.clientY };
      }
      this._lastMouse = { x: e.clientX, y: e.clientY };
    });

    canvas.addEventListener('mousemove', (e) => {
      const pos = this._screenToGraph(e);
      if (this._dragging) {
        this._dragging.x = pos.x; this._dragging.y = pos.y; this._dragging.vx = 0; this._dragging.vy = 0;
        hasDragged = true; this._renderFrame(); return;
      }
      if (this._selectionMode && this._selectionStart) {
        this._selectionRect = { x1: this._selectionStart.x, y1: this._selectionStart.y, x2: pos.x, y2: pos.y };
        this._renderFrame(); return;
      }
      if (this._isPanning) {
        this._transform.x += e.clientX - this._lastMouse.x; this._transform.y += e.clientY - this._lastMouse.y;
        this._lastMouse = { x: e.clientX, y: e.clientY }; hasDragged = true; this._renderFrame(); return;
      }
      const node = this._hitTest(pos);
      this._hovering = node;
      canvas.style.cursor = node ? 'pointer' : (this._selectionMode ? 'crosshair' : 'grab');
      this._renderFrame();
    });

    canvas.addEventListener('mouseup', (e) => {
      if (this._selectionMode && this._selectionRect) {
        this._selectNodesInRect(); this._selectionRect = null; this._selectionStart = null; this._renderFrame();
      }
      if (!hasDragged && dragStartPos) {
        const pos = this._screenToGraph(e);
        const node = this._hitTest(pos);
        if (node) {
          this.data.selectedNode = node.id;
          this._showNodeDetail(node.id);
          this._focusOnNode(node.id);
          this._highlightNode(node.id, 1);
        } else {
          this._clearHighlight(); this.data.selectedNode = null; this._selectedNodes.clear();
          document.getElementById('relationshipDetail')?.classList.add('hidden');
        }
      }
      this._dragging = null; this._isPanning = false; dragStartPos = null; hasDragged = false;
    });

    canvas.addEventListener('mouseleave', () => {
      this._dragging = null; this._isPanning = false; this._hovering = null;
      this._selectionRect = null; this._selectionStart = null; this._renderFrame();
    });

    canvas.addEventListener('dblclick', (e) => {
      const pos = this._screenToGraph(e);
      const node = this._hitTest(pos);
      if (node) {
        this._highlightNode(node.id, 2);
        this.data.selectedNode = node.id;
        this._showNodeDetail(node.id);
        this._focusOnNode(node.id);
      }
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      this._transform.x = mx - (mx - this._transform.x) * delta;
      this._transform.y = my - (my - this._transform.y) * delta;
      this._transform.scale = Math.max(0.2, Math.min(5, this._transform.scale * delta));
      this._renderFrame();
    }, { passive: false });

    // 触摸
    let touchStartDist = 0, touchStartScale = 1;
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const pos = this._screenToGraph(e.touches[0]);
        const node = this._hitTest(pos);
        if (node) this._dragging = node; else this._isPanning = true;
        this._lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        this._isPanning = false; this._dragging = null;
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
        this._dragging.x = pos.x; this._dragging.y = pos.y; this._renderFrame();
      } else if (this._isPanning && e.touches.length === 1) {
        e.preventDefault();
        const t = e.touches[0];
        this._transform.x += t.clientX - this._lastMouse.x; this._transform.y += t.clientY - this._lastMouse.y;
        this._lastMouse = { x: t.clientX, y: t.clientY }; this._renderFrame();
      } else if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this._transform.scale = Math.max(0.2, Math.min(5, touchStartScale * Math.sqrt(dx * dx + dy * dy) / touchStartDist));
        this._renderFrame();
      }
    }, { passive: false });

    canvas.addEventListener('touchend', () => { this._dragging = null; this._isPanning = false; });
  },

  // ===== 筛选与展开 =====

  /** 应用筛选条件，从 Store 获取子图 */
  _applyFilters() {
    const store = window.RelationshipStore;
    if (!store) return;

    const { filterLabel, filterRegion, filterIndustry, searchQuery } = this.data;
    const labels = filterLabel === 'all' ? null : [filterLabel];

    const subgraph = store.expandSubgraph({
      labels,
      region: filterRegion || undefined,
      industry: filterIndustry || undefined,
      search: searchQuery || undefined,
      maxDepth: 2
    });

    this.data.subgraph = subgraph;
    const list = document.getElementById('relationshipList');
    if (list) list.innerHTML = this._renderNodeList(subgraph.nodes);
    this._drawGraph(subgraph.nodes, subgraph.edges);
  },

  // ===== 节点详情 =====

  _showNodeDetail(nodeId) {
    const store = window.RelationshipStore;
    const schema = window.RelationshipSchema;
    const panel = document.getElementById('relationshipDetail');
    const content = document.getElementById('relationshipDetailContent');
    if (!panel || !content || !store) return;

    const node = store.getNode(nodeId);
    if (!node) return;
    panel.classList.remove('hidden');
    this._focusOnNode(nodeId);

    const info = schema.nodeTypes[node.label];
    const p = node.properties;
    const connected = store.getConnectedNodes(nodeId);
    const edges = store.getEdgesForNode(nodeId);

    // 按类型分组关联节点
    const grouped = {};
    connected.forEach(cn => {
      if (!grouped[cn.label]) grouped[cn.label] = [];
      grouped[cn.label].push(cn);
    });

    // 属性列表
    const propHtml = Object.entries(p).filter(([k, v]) => v && k !== 'id' && k !== 'cityId').map(([k, v]) =>
      `<div class="rel-detail-prop"><span class="rel-detail-prop-key">${k}</span><span class="rel-detail-prop-val">${this._esc(String(v))}</span></div>`
    ).join('');

    // 关联节点
    const relHtml = Object.entries(grouped).map(([label, nodes]) => {
      const lInfo = schema.nodeTypes[label];
      return `<div class="rel-detail-section">
        <h4>${lInfo?.icon || '●'} ${lInfo?.label || label} (${nodes.length})</h4>
        <div class="rel-detail-tags">${nodes.slice(0, 10).map(n =>
          `<span class="rel-detail-tag clickable" data-node-id="${this._esc(n.id)}">${this._esc(n.properties.name || n.id)}</span>`
        ).join('')}${nodes.length > 10 ? `<span class="rel-detail-tag">+${nodes.length - 10}</span>` : ''}</div>
      </div>`;
    }).join('');

    content.innerHTML = `
      <div class="rel-detail-header">
        <div class="rel-detail-avatar" style="font-size:20px;background:${info?.color || '#8E8E93'};">${info?.icon || '●'}</div>
        <div class="rel-detail-title">
          <h3>${this._esc(p.name || node.id)}</h3>
          <span class="rel-detail-role">${info?.label || node.label}</span>
        </div>
        <button class="rel-detail-close" id="relDetailClose">✕</button>
      </div>
      ${propHtml ? `<div class="rel-detail-section">${propHtml}</div>` : ''}
      ${relHtml}
    `;

    document.getElementById('relDetailClose')?.addEventListener('click', () => {
      panel.classList.add('hidden');
      this.data.selectedNode = null;
      this._clearHighlight();
      this._fitView();
    });

    // 关联节点点击
    content.querySelectorAll('.rel-detail-tag.clickable').forEach(el => {
      el.addEventListener('click', () => {
        const nid = el.dataset.nodeId;
        this.data.selectedNode = nid;
        this._showNodeDetail(nid);
        this._focusOnNode(nid);
        this._highlightNode(nid, 1);
      });
    });
  },

  // ===== 清空重建 =====

  _showClearConfirm() {
    const existing = document.getElementById('relClearModal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'relClearModal';
    modal.className = 'rel-import-modal';
    modal.innerHTML = `
      <div class="rel-import-overlay"></div>
      <div class="rel-import-dialog" style="max-width:400px;">
        <div class="rel-import-header"><h3>🗑 清空人脉图谱</h3><button class="rel-import-close" id="relClearClose">✕</button></div>
        <div class="rel-import-body">
          <p style="color:var(--text-secondary);line-height:1.6;margin-bottom:12px;">确定要清空所有图谱数据吗？此操作将删除所有实体和关系，不可恢复。</p>
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
      window.RelationshipStore?.clear();
      // 同时清空 IPC 端数据
      window.electronAPI?.relationshipClear?.();
      this._renderInit();
      this._showToast('图谱数据已清空', 'success');
    });
  },

  // ===== 导入导出 =====

  _showImportDialog() {
    const existing = document.getElementById('relImportModal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'relImportModal';
    modal.className = 'rel-import-modal';
    modal.innerHTML = `
      <div class="rel-import-overlay"></div>
      <div class="rel-import-dialog">
        <div class="rel-import-header"><h3>📥 导入图谱数据</h3><button class="rel-import-close" id="relImportClose">✕</button></div>
        <div class="rel-import-body">
          <p class="rel-import-hint">粘贴之前导出的 JSON 数据，或上传 JSON 文件：</p>
          <textarea id="relImportTextarea" class="rel-import-textarea" rows="8" placeholder='粘贴 JSON 数据...'></textarea>
          <input type="file" id="relImportFile" accept=".json" style="margin-top:8px;font-size:12px;">
        </div>
        <div class="rel-import-footer">
          <button class="rel-import-btn secondary" id="relImportCancelBtn">取消</button>
          <button class="rel-import-btn primary" id="relImportConfirmBtn">导入</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('relImportClose')?.addEventListener('click', () => modal.remove());
    document.getElementById('relImportCancelBtn')?.addEventListener('click', () => modal.remove());
    modal.querySelector('.rel-import-overlay')?.addEventListener('click', () => modal.remove());

    document.getElementById('relImportFile')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          document.getElementById('relImportTextarea').value = ev.target.result;
        };
        reader.readAsText(file);
      }
    });

    document.getElementById('relImportConfirmBtn')?.addEventListener('click', () => {
      const text = document.getElementById('relImportTextarea')?.value?.trim();
      if (!text) { this._showToast('请输入或选择 JSON 数据', 'warning'); return; }
      const result = window.RelationshipStore?.importJSON(text);
      if (result?.success) {
        this._showToast(`导入成功：${result.nodeCount} 个节点, ${result.edgeCount} 条边`, 'success');
        modal.remove();
        this._render();
      } else {
        this._showToast('导入失败: ' + (result?.error || '无效 JSON'), 'error');
      }
    });
  },

  _exportGraph() {
    const json = window.RelationshipStore?.exportJSON();
    if (!json) { this._showToast('无数据可导出', 'warning'); return; }

    // 下载文件
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relationship-graph-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this._showToast('图谱数据已导出', 'success');
  },

  // ===== 工具方法 =====

  _esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
    toast.innerHTML = `<span style="color:${colors[type] || colors.info}">${icons[type] || icons.info}</span> ${this._esc(message)}`;
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }
};

window.Relationship = Relationship;
console.log('[Relationship] Graph module loaded');
