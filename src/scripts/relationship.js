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
    filterTier: '',     // 客户分层筛选
    searchQuery: '',
    selectedNode: null,
    graphData: null,    // 力导向图渲染数据
    searchMatchIds: new Set() // 搜索匹配的节点 ID
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

    // 如果没有数据，或没有客户数据（旧版数据），或没有COVERS边（行业映射bug），提示初始化
    const customerCount = graphData.nodes ? graphData.nodes.filter(n => n.label === 'Customer').length : 0;
    const coversCount = graphData.edges ? graphData.edges.filter(e => e.type === 'COVERS').length : 0;
    if (!graphData.nodes || graphData.nodes.length === 0 || customerCount === 0 || coversCount === 0) {
      const hasOldData = graphData.nodes?.length > 0;
      this._renderInit(hasOldData);
      return;
    }

    this._render();
  },

  /** 渲染初始化页面 */
  _renderInit(hasOldData = false) {
    const container = document.getElementById('relationshipContent');
    if (!container) return;
    container.innerHTML = `
      <div class="insight-empty" style="padding:60px 20px;text-align:center;">
        <div class="insight-empty-icon" style="font-size:48px;margin-bottom:16px;">👥</div>
        <div style="font-size:16px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">${hasOldData ? '图谱数据需要更新' : '人脉图谱未初始化'}</div>
        <div style="font-size:13px;color:var(--text-tertiary);max-width:400px;margin:0 auto;line-height:1.6;">
          ${hasOldData ? '当前图谱缺少客户数据，点击下方按钮重新初始化，加载包含客户、案例的完整关系网络' : '点击下方按钮，从产品架构师团队数据初始化图谱，包含区域、行业、客户、产品等完整关系网络'}
        </div>
        <button class="relationship-ai-btn" style="margin-top:20px;" id="relInitBtn">${hasOldData ? '🔄 重新初始化图谱' : '🚀 初始化图谱'}</button>
      </div>
    `;
    document.getElementById('relInitBtn')?.addEventListener('click', () => this._initGraphFromData());
  },

  /** 从初始数据初始化图谱 */
  async _initGraphFromData() {
    this._showToast('正在初始化图谱数据...', 'info');
    try {
      // 加载插旗表全量数据（依次尝试多个文件和加载方式）
      let flagmapData = [];
      const dataFiles = ['data/flagmap-full-data.json', 'data/flagmap-customers.json'];

      // 方式1: fetch（Electron file:// 协议下可能受限）
      for (const filePath of dataFiles) {
        try {
          const resp = await fetch(filePath);
          if (resp.ok) {
            flagmapData = await resp.json();
            console.log(`[Relationship] Loaded ${filePath} via fetch, type=${Array.isArray(flagmapData) ? 'Array' : 'Dict'}, count=${Array.isArray(flagmapData) ? flagmapData.length : Object.keys(flagmapData).length}`);
            if (Array.isArray(flagmapData) && flagmapData.length > 0) break;
          }
        } catch (e) {
          console.warn(`[Relationship] fetch ${filePath} failed:`, e.message);
        }
      }

      // 方式2: 通过 IPC 从主进程读取文件（Electron 专属 fallback）
      if (!Array.isArray(flagmapData) || flagmapData.length === 0) {
        try {
          const fsData = await window.electronAPI?.readDataFile?.('flagmap-full-data.json');
          if (fsData) {
            flagmapData = typeof fsData === 'string' ? JSON.parse(fsData) : fsData;
            console.log(`[Relationship] Loaded via IPC, type=${Array.isArray(flagmapData) ? 'Array' : 'Dict'}, count=${Array.isArray(flagmapData) ? flagmapData.length : Object.keys(flagmapData).length}`);
          }
        } catch (e) {
          console.warn('[Relationship] IPC load failed:', e.message);
        }
      }

      // 方式3: 用 XMLHttpRequest 作为最后 fallback
      if (!Array.isArray(flagmapData) || flagmapData.length === 0) {
        for (const filePath of dataFiles) {
          try {
            const xhrResult = await new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.open('GET', filePath, true);
              xhr.responseType = 'json';
              xhr.onload = () => resolve(xhr.response);
              xhr.onerror = () => reject(new Error('XHR failed'));
              xhr.send();
            });
            if (xhrResult) {
              flagmapData = xhrResult;
              console.log(`[Relationship] Loaded ${filePath} via XHR, type=${Array.isArray(flagmapData) ? 'Array' : 'Dict'}, count=${Array.isArray(flagmapData) ? flagmapData.length : Object.keys(flagmapData).length}`);
              if (Array.isArray(flagmapData) && flagmapData.length > 0) break;
            }
          } catch (e) {
            console.warn(`[Relationship] XHR ${filePath} failed:`, e.message);
          }
        }
      }

      // 如果 flagmapData 是旧格式 Dict，转换为 Array
      if (!Array.isArray(flagmapData) && typeof flagmapData === 'object' && flagmapData !== null) {
        console.log('[Relationship] Converting Dict format to Array...');
        flagmapData = Object.entries(flagmapData).map(([name, info]) => ({
          '客户名': name,
          '客户分层': info.tier || '',
          '一级行业': info.industry || '',
          '产品': (info.products || []).join(','),
          '产品架构师': (info.architects || []).join(','),
          '跟进状态': info.status || ''
        }));
      }

      const store = window.RelationshipStore;
      const initialData = window.INITIAL_DATA;
      if (!store || !initialData) {
        this._showToast('数据管理器或初始数据未加载', 'error');
        return;
      }

      if (!Array.isArray(flagmapData) || flagmapData.length === 0) {
        this._showToast('无法加载插旗表数据文件，请确认文件存在', 'error');
        return;
      }

      const stats = store.initFromInitialData(initialData, flagmapData);
      const customerCount = store.getNodesByLabel('Customer').length;
      console.log(`[Relationship] Init complete: ${stats.total} nodes, ${stats.totalEdges} edges, ${customerCount} customers`);
      this._showToast(`图谱初始化完成：${stats.total} 个节点, ${stats.totalEdges} 条边, ${customerCount} 个客户`, 'success');
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

    // 初始为空子图，后续异步加载用户为中心的子图
    const emptySubgraph = { nodes: [], edges: [] };
    this.data.subgraph = emptySubgraph;

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
            <!-- 语义检索输入 -->
            <div class="rel-semantic-search">
              <input type="text" class="rel-semantic-input" id="relSemanticInput"
                placeholder="语义检索：华东有哪些架构师？邱毅负责哪些行业？">
              <button class="rel-semantic-btn" id="relSemanticBtn">🔍 AI</button>
            </div>

            <!-- 快捷问题（动态生成） -->
            <div class="rel-quick-questions" id="relQuickQuestions">
            </div>

            <input type="text" class="relationship-search" id="relationshipSearch"
              placeholder="搜索架构师、客户、行业...">
            
            <!-- 层级筛选：第一级 - 区域 -->
            <div class="rel-filter-level">
              <label class="rel-filter-level-label">📍 区域</label>
              <select id="relRegionFilter" class="rel-select">
                <option value="">全部区域</option>
                <option value="华北">华北（北京）</option>
                <option value="华东">华东（上海）</option>
                <option value="华南">华南（深圳/广州）</option>
              </select>
            </div>

            <!-- 层级筛选：第二级 - 行业（根据区域联动） -->
            <div class="rel-filter-level">
              <label class="rel-filter-level-label">🏭 行业</label>
              <select id="relIndustryFilter" class="rel-select">
                <option value="">全部行业</option>
              </select>
            </div>

            <!-- 层级筛选：第三级 - 客户分层 -->
            <div class="rel-filter-level">
              <label class="rel-filter-level-label">🏢 客户分层</label>
              <select id="relTierFilter" class="rel-select">
                <option value="">全部客户</option>
                <option value="业内 TOP 20（头部标杆）">头部标杆</option>
                <option value="业内 TOP 50">TOP 50</option>
                <option value="业内 TOP 100">TOP 100</option>
                <option value="其他">其他</option>
              </select>
            </div>

            <!-- 类型标签筛选 -->
            <div class="relationship-filters">
              <button class="rel-filter-btn active" data-filter="all">全部</button>
              ${Object.entries(schema.nodeTypes).map(([label, info]) =>
                `<button class="rel-filter-btn" data-filter="${label}">${info.icon} ${info.label}</button>`
              ).join('')}
            </div>

            <!-- 操作按钮 -->
            <div class="rel-toolbar-row">
              <button class="relationship-ai-btn secondary" id="relExpandBtn">🔍 展开子图</button>
              <button class="relationship-ai-btn secondary" id="relImportBtn">📥 导入</button>
              <button class="relationship-ai-btn secondary" id="relExportBtn">📤 导出</button>
              <button class="relationship-ai-btn secondary" id="relReinitBtn">🔄 重新初始化</button>
              <button class="relationship-ai-btn danger" id="relClearBtn">🗑 清空</button>
            </div>
          </div>

          <div class="relationship-list" id="relationshipList">
            <div class="insight-loading"><div class="spinner"></div><span>加载中...</span></div>
          </div>
        </div>

        <!-- 右侧：图谱 + 详情 + 语义检索结果 -->
        <div class="relationship-main">
          <!-- 图谱区域（上方 2/3 或全高） -->
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
          <!-- 语义检索结果面板（下方 1/3，不覆盖图谱） -->
          <div class="rel-semantic-panel hidden" id="relSemanticPanel">
            <div class="rel-semantic-panel-header">
              <span style="font-size:16px;">🤖</span>
              <span class="rel-semantic-panel-title">图谱智能分析</span>
              <button class="rel-semantic-panel-close" id="relSemanticPanelClose">✕</button>
            </div>
            <div class="rel-semantic-panel-body" id="relSemanticPanelBody"></div>
            <div class="rel-semantic-status hidden" id="relSemanticStatus">
              <div class="spinner"></div>
              <span id="relSemanticStatusText">正在检索图谱数据...</span>
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

    // 显示加载中状态
    const canvas = document.getElementById('relationshipCanvas');
    if (canvas) {
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
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-tertiary').trim() || '#aeaeb2';
      ctx.font = '14px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      const w = canvas.width / dpr, h = canvas.height / dpr;
      ctx.fillText('正在加载人脉图谱...', w / 2, h / 2);
      ctx.restore();
    }

    // 异步加载用户为中心的子图
    this._getDefaultSubgraph(store).then(subgraph => {
      this.data.subgraph = subgraph;
      this._drawGraph(subgraph.nodes, subgraph.edges);
      const listEl = document.getElementById('relationshipList');
      if (listEl) listEl.innerHTML = this._renderNodeList(subgraph.nodes);
      // 确保行业下拉在数据加载后刷新
      this._updateIndustryOptions();
      // 生成数据驱动的快捷问题
      this._updateQuickQuestions();
    });
  },

  /** 获取默认子图 — 以登录用户为中心展开一级 */
  async _getDefaultSubgraph(store) {
    // 尝试获取当前登录用户
    let centerNodeId = null;
    try {
      const authState = await window.electronAPI?.authGetState?.();
      if (authState?.isLoggedIn && authState?.user) {
        const userIdentifier = authState.user.email || authState.user.username || authState.user.name || '';
        const userName = authState.user.name || authState.user.nickname || '';

        // 在架构师节点中查找匹配
        const architects = store.getNodesByLabel('Architect');
        for (const arch of architects) {
          const p = arch.properties;
          // 匹配 accountId 或 name
          if (p.accountId && userIdentifier && userIdentifier.toLowerCase().includes(p.accountId.toLowerCase())) {
            centerNodeId = arch.id;
            break;
          }
          if (p.name && userName && p.name === userName) {
            centerNodeId = arch.id;
            break;
          }
        }

        // 兜底：用 email 前缀匹配 accountId
        if (!centerNodeId && userIdentifier) {
          const emailPrefix = userIdentifier.split('@')[0].toLowerCase();
          for (const arch of architects) {
            if (arch.properties.accountId && arch.properties.accountId.toLowerCase() === emailPrefix) {
              centerNodeId = arch.id;
              break;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Relationship] Failed to get auth state:', e.message);
    }

    if (centerNodeId) {
      console.log('[Relationship] Centering on user node:', centerNodeId);
      return store.expandSubgraph({ centerNodeId, maxDepth: 1 });
    }

    // 兜底：选择第一个架构师为中心展开一级（不展示全部节点）
    const allArchitects = store.getNodesByLabel('Architect');
    if (allArchitects.length > 0) {
      // 优先选择"公线支持总协调"角色的架构师，否则选第一个
      const coordinator = allArchitects.find(a => a.properties.role === '公线支持总协调');
      const fallbackArch = coordinator || allArchitects[0];
      console.log('[Relationship] Fallback: centering on architect:', fallbackArch.properties.name);
      return store.expandSubgraph({ centerNodeId: fallbackArch.id, maxDepth: 1 });
    }

    // 最终兜底：空子图
    return { nodes: [], edges: [] };
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
      const isMatch = this.data.searchMatchIds.has(n.id);
      return `<div class="rel-person-card${isMatch ? ' search-match' : ''}" data-node-id="${this._esc(n.id)}" data-label="${n.label}">
        <div class="rel-person-avatar" style="background:${color};">${icon}${isMatch ? '<span class="search-match-dot"></span>' : ''}</div>
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
        const status = p.followupStatus || p.signingStatus || '';
        if (status) tags = `<span class="rel-meta-item" style="color:${schema.statusColors[status] || '#8E8E93'}">${status}</span>`;
        if (p.industryL1) tags += `<span class="rel-meta-item">${p.industryL1}</span>`;
        break;
      case 'Industry':
        badge = p.level === 'L1' ? '一级行业' : (p.level === 'L2' ? '二级行业' : '');
        if (p.priority === 'high') badge += ' 🔥';
        break;
      case 'Case':
        badge = p.status || '';
        if (p.deployMode) tags = `<span class="rel-meta-item">${p.deployMode}</span>`;
        break;
      case 'Sales':
        if (p.region) badge = p.region;
        break;
      case 'Partner':
        if (p.status) badge = p.status;
        if (p.channelManager) tags = `<span class="rel-meta-item">渠道: ${p.channelManager}</span>`;
        break;
      case 'Channel':
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
      const isSearchMatch = this.data.searchMatchIds.has(n.id);
      const color = info?.color || '#8E8E93';

      // 搜索匹配：脉动外圈
      if (isSearchMatch && isHighlighted) {
        const pulsePhase = (Date.now() % 2000) / 2000;
        const pulseRadius = n.radius + 10 + Math.sin(pulsePhase * Math.PI * 2) * 4;
        const pulseAlpha = 0.25 + Math.sin(pulsePhase * Math.PI * 2) * 0.1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, pulseRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,149,0,${pulseAlpha})`;
        ctx.lineWidth = 3;
        ctx.stroke();

        // 第二圈（稍小）
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + 6, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,149,0,0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

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

      // 搜索匹配标记：右上角小圆点
      if (isSearchMatch && isHighlighted) {
        ctx.beginPath();
        ctx.arc(n.x + n.radius * 0.6, n.y - n.radius * 0.6, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#FF9500';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
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

    // 搜索匹配时持续动画（脉动效果，限速 30fps）
    if (this.data.searchMatchIds.size > 0 && !this._searchAnimRunning) {
      this._searchAnimRunning = true;
      let lastPulseTime = 0;
      const pulseLoop = (timestamp) => {
        if (this.data.searchMatchIds.size === 0) {
          this._searchAnimRunning = false;
          return;
        }
        if (timestamp - lastPulseTime > 33) { // ~30fps
          lastPulseTime = timestamp;
          this._renderFrameInternal();
        }
        requestAnimationFrame(pulseLoop);
      };
      requestAnimationFrame(pulseLoop);
    }
  },

  /** 内部渲染（不含动画触发） */
  _renderFrameInternal() {
    const canvas = document.getElementById('relationshipCanvas');
    if (!canvas || !this.data.graphData) return;
    const ctx = canvas.getContext('2d');
    const dpr = this._dpr;
    const { nodes, edges } = this.data.graphData;
    const schema = window.RelationshipSchema;
    const isDark = window.ThemeEngine?.isDark?.() || document.documentElement.getAttribute('data-theme') === 'dark';
    const highlightedIds = this._getHighlightedNodeIds();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(this._transform.x, this._transform.y);
    ctx.scale(this._transform.scale, this._transform.scale);

    // 绘制边（简化版，只画线）
    edges.forEach(e => {
      const bothHighlighted = highlightedIds.size === 0 || (highlightedIds.has(e.source.id) && highlightedIds.has(e.target.id));
      ctx.beginPath();
      ctx.moveTo(e.source.x, e.source.y);
      ctx.lineTo(e.target.x, e.target.y);
      ctx.setLineDash(e.dashed ? [4, 4] : []);
      ctx.strokeStyle = e.color;
      ctx.lineWidth = bothHighlighted ? 1.2 : 0.5;
      ctx.globalAlpha = bothHighlighted ? 0.6 : 0.08;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    });

    // 绘制节点
    nodes.forEach(n => {
      const info = schema.nodeTypes[n.label];
      const isHighlighted = highlightedIds.size === 0 || highlightedIds.has(n.id);
      n.dimmed = !isHighlighted;
      ctx.globalAlpha = isHighlighted ? 1 : 0.12;
      const isSearchMatch = this.data.searchMatchIds.has(n.id);
      const color = info?.color || '#8E8E93';

      // 搜索匹配脉动
      if (isSearchMatch && isHighlighted) {
        const pulsePhase = (Date.now() % 2000) / 2000;
        const pulseRadius = n.radius + 10 + Math.sin(pulsePhase * Math.PI * 2) * 4;
        const pulseAlpha = 0.25 + Math.sin(pulsePhase * Math.PI * 2) * 0.1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, pulseRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,149,0,${pulseAlpha})`;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + 6, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,149,0,0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // 光晕
      const isSelected = this.data.selectedNode === n.id;
      const isHovered = this._hovering?.id === n.id;
      if ((isSelected || isHovered) && isHighlighted) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + 8, 0, Math.PI * 2);
        ctx.fillStyle = color.replace(')', ',0.15)').replace('rgb', 'rgba');
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

      if ((isSelected || isHovered) && isHighlighted) {
        ctx.strokeStyle = isDark ? 'rgba(232,236,244,0.6)' : 'rgba(29,29,31,0.8)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      // 搜索标记小圆点
      if (isSearchMatch && isHighlighted) {
        ctx.beginPath();
        ctx.arc(n.x + n.radius * 0.6, n.y - n.radius * 0.6, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#FF9500';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // 图标
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(11, n.radius * 0.55)}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(info?.icon || '', n.x, n.y);

      // 名字
      const name = n.node?.properties?.name || n.id;
      ctx.fillStyle = isHighlighted ? (isDark ? '#e5e5ea' : '#1d1d1f') : (isDark ? 'rgba(232,236,244,0.12)' : 'rgba(29,29,31,0.12)');
      ctx.font = `${(isHovered || isSelected) && isHighlighted ? '600 ' : ''}10px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textBaseline = 'top';
      const displayName = name.length > 8 ? name.substring(0, 7) + '…' : name;
      ctx.fillText(displayName, n.x, n.y + n.radius + 4);
      ctx.globalAlpha = 1;
    });

    ctx.restore();
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

    // 搜索（加高亮）
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
      // 回车搜索
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          clearTimeout(timer);
          this.data.searchQuery = e.target.value;
          this._applyFilters();
        }
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

    // 层级筛选：区域 → 联动行业
    document.getElementById('relRegionFilter')?.addEventListener('change', (e) => {
      this.data.filterRegion = e.target.value;
      this._updateIndustryOptions();
      this.data.filterIndustry = '';
      this._applyFilters();
    });

    // 层级筛选：行业
    document.getElementById('relIndustryFilter')?.addEventListener('change', (e) => {
      this.data.filterIndustry = e.target.value;
      this._applyFilters();
    });

    // 层级筛选：客户分层
    document.getElementById('relTierFilter')?.addEventListener('change', (e) => {
      this.data.filterTier = e.target.value;
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
    // 重新初始化
    document.getElementById('relReinitBtn')?.addEventListener('click', () => {
      if (confirm('确定要重新初始化图谱吗？\n\n当前所有图谱数据将被清除，并从插旗表数据重新构建。\n（COVERS 行业覆盖关系将自动从实际数据推导）')) {
        this._initGraphFromData();
      }
    });

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

    // Canvas 交互
    this._bindCanvasEvents();

    // 工具栏按钮
    document.getElementById('relGraphZoomIn')?.addEventListener('click', () => this._zoomCanvas(1.2));
    document.getElementById('relGraphZoomOut')?.addEventListener('click', () => this._zoomCanvas(0.8));
    document.getElementById('relGraphFitView')?.addEventListener('click', () => this._fitView());
    document.getElementById('relGraphReset')?.addEventListener('click', () => this._resetLayout());

    // 关联层级按钮 — 需要先选中节点
    document.getElementById('relGraphLevel1')?.addEventListener('click', () => {
      if (!this._highlightCenter && !this.data.selectedNode) {
        this._showToast('请先点击选中一个节点', 'info');
        return;
      }
      if (!this._highlightCenter) this._highlightCenter = this.data.selectedNode;
      this._highlightLevel = this._highlightLevel === 1 ? 0 : 1;
      this._updateLevelButtons();
      this._renderFrame();
    });

    document.getElementById('relGraphLevel2')?.addEventListener('click', () => {
      if (!this._highlightCenter && !this.data.selectedNode) {
        this._showToast('请先点击选中一个节点', 'info');
        return;
      }
      if (!this._highlightCenter) this._highlightCenter = this.data.selectedNode;
      this._highlightLevel = this._highlightLevel === 2 ? 0 : 2;
      this._updateLevelButtons();
      this._renderFrame();
    });

    document.getElementById('relGraphLevelAll')?.addEventListener('click', () => {
      this._clearHighlight();
    });

    document.getElementById('relGraphSelectMode')?.addEventListener('click', () => {
      this._selectionMode = !this._selectionMode;
      this._updateSelectModeButton();
      if (!this._selectionMode) { this._selectedNodes.clear(); this._selectionRect = null; this._renderFrame(); }
    });

    // 初始化行业下拉
    this._updateIndustryOptions();

    // 语义检索按钮
    document.getElementById('relSemanticBtn')?.addEventListener('click', () => {
      const input = document.getElementById('relSemanticInput');
      const query = input?.value?.trim();
      if (query) this._semanticSearch(query);
    });

    // 语义检索回车
    document.getElementById('relSemanticInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const query = e.target.value.trim();
        if (query) this._semanticSearch(query);
      }
    });

    // 快捷问题点击（静态绑定 + 事件委托支持动态生成）
    const chipContainer = document.getElementById('relQuickQuestions');
    if (chipContainer) {
      chipContainer.addEventListener('click', (e) => {
        const chip = e.target.closest('.rel-quick-q-chip');
        if (chip) {
          const q = chip.dataset.q;
          const input = document.getElementById('relSemanticInput');
          if (input) input.value = q;
          this._semanticSearch(q);
        }
      });
    }
    document.querySelectorAll('.rel-quick-q-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const q = chip.dataset.q;
        const input = document.getElementById('relSemanticInput');
        if (input) input.value = q;
        this._semanticSearch(q);
      });
    });

    // 语义检索面板关闭
    document.getElementById('relSemanticPanelClose')?.addEventListener('click', () => {
      document.getElementById('relSemanticPanel')?.classList.add('hidden');
      const mainEl = document.querySelector('.relationship-main');
      if (mainEl) mainEl.classList.remove('semantic-active');
      // 图谱区域恢复全高，重新适配画布
      requestAnimationFrame(() => {
        const sub = this.data.subgraph;
        if (sub) this._drawGraph(sub.nodes, sub.edges);
      });
    });

    setTimeout(() => {
      const hint = document.getElementById('relGraphHint');
      if (hint) hint.classList.add('fade-out');
    }, 5000);
  },

  /** 根据图谱实际数据动态生成快捷问题 */
  _updateQuickQuestions() {
    const store = window.RelationshipStore;
    const container = document.getElementById('relQuickQuestions');
    if (!store || !container) return;

    if (!store._data) store.load();
    const questions = store.generateSuggestedQuestions();
    container.innerHTML = questions.map(q =>
      `<span class="rel-quick-q-chip" data-q="${this._esc(q.query)}">${this._esc(q.label)}</span>`
    ).join('');

    // 重新绑定点击事件
    container.querySelectorAll('.rel-quick-q-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const q = chip.dataset.q;
        const input = document.getElementById('relSemanticInput');
        if (input) input.value = q;
        this._semanticSearch(q);
      });
    });
  },

  /** 根据区域联动更新行业下拉选项（分一级行业和二级行业） */
  _updateIndustryOptions() {
    const store = window.RelationshipStore;
    const select = document.getElementById('relIndustryFilter');
    if (!store || !select) return;

    // 确保 store 数据已加载
    if (!store._data) store.load();

    const region = this.data.filterRegion;
    let allIndustries = store.getNodesByLabel('Industry');

    // 如果没有行业节点，可能是数据未初始化，直接返回
    if (!allIndustries || allIndustries.length === 0) {
      console.warn('[Relationship] No Industry nodes found in store');
      select.innerHTML = '<option value="">全部行业</option>';
      return;
    }

    if (region) {
      // 找到该区域的架构师
      const regionNode = store._data.nodes.find(n => n.label === 'Region' && n.properties.name === region);
      if (regionNode) {
        const archInRegion = store.getConnectedNodes(regionNode.id, ['BELONGS_TO']);
        const archIds = new Set(archInRegion.map(n => n.id));
        // 找这些架构师覆盖的行业
        const indIds = new Set();
        archIds.forEach(aid => {
          store.getEdgesForNode(aid).filter(e => e.type === 'COVERS').forEach(e => {
            // COVERS 边方向：source=architect, target=industry，但保险起见取另一端
            const otherId = e.source === aid ? e.target : e.source;
            const otherNode = store.getNode(otherId);
            if (otherNode && otherNode.label === 'Industry') {
              indIds.add(otherId);
            }
          });
        });
        allIndustries = [...indIds].map(id => store.getNode(id)).filter(Boolean);
      }
    }

    // 分组：一级行业和二级行业
    const l1Industries = allIndustries.filter(n => n.properties.level === 'L1' || !n.properties.level);
    const l2Industries = allIndustries.filter(n => n.properties.level === 'L2');

    const currentVal = this.data.filterIndustry;
    let html = '<option value="">全部行业</option>';

    if (l1Industries.length > 0) {
      html += '<optgroup label="一级行业">';
      l1Industries.sort((a, b) => (a.properties.name || '').localeCompare(b.properties.name || '', 'zh')).forEach(n => {
        const name = n.properties.name;
        const sel = name === currentVal ? ' selected' : '';
        html += `<option value="${this._esc(name)}"${sel}>${this._esc(name)}</option>`;
      });
      html += '</optgroup>';
    }

    if (l2Industries.length > 0) {
      html += '<optgroup label="二级行业">';
      l2Industries.sort((a, b) => (a.properties.name || '').localeCompare(b.properties.name || '', 'zh')).forEach(n => {
        const name = n.properties.name;
        const sel = name === currentVal ? ' selected' : '';
        html += `<option value="${this._esc(name)}"${sel}>${this._esc(name)}</option>`;
      });
      html += '</optgroup>';
    }

    select.innerHTML = html;
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

    const { filterLabel, filterRegion, filterIndustry, filterTier, searchQuery } = this.data;
    const labels = filterLabel === 'all' ? null : [filterLabel];

    // 构建筛选参数
    const options = {
      labels,
      region: filterRegion || undefined,
      industry: filterIndustry || undefined,
      tier: filterTier || undefined,
      search: searchQuery || undefined,
      maxDepth: 2
    };

    const subgraph = store.expandSubgraph(options);

    // 计算搜索匹配节点
    this.data.searchMatchIds = new Set();
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      subgraph.nodes.forEach(n => {
        const name = (n.properties.name || '').toLowerCase();
        const role = (n.properties.role || '').toLowerCase();
        if (name.includes(q) || role.includes(q)) {
          this.data.searchMatchIds.add(n.id);
        }
      });
    }

    this.data.subgraph = subgraph;
    const list = document.getElementById('relationshipList');
    if (list) list.innerHTML = this._renderNodeList(subgraph.nodes);
    this._drawGraph(subgraph.nodes, subgraph.edges);

    // 有搜索匹配时自动聚焦到第一个匹配节点
    if (this.data.searchMatchIds.size > 0) {
      const firstId = [...this.data.searchMatchIds][0];
      this._highlightNode(firstId, 1);
      this._focusOnNode(firstId);
    }
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

    // 属性列表 — 友好名称映射
    const propNameMap = {
      name: '名称', tier: '客户分层', industryL1: '一级行业', industryL2: '二级行业',
      channel: '通路', aiDemand: '智能体需求', productForm: '产品形态',
      biddingWinner: '中标方', biddingDate: '中标时间', tencentParticipated: '腾讯参与',
      cloudProductConnected: '已建联', convertedToOpportunity: '转为商机',
      followupStatus: '跟进状态', signingStatus: '签约状态',
      competitorProducts: '参与友商', product: '产品', cemLink: 'CEM链接',
      notes: '备注', authorityTag: '权威标签', supplementaryNote: '补充说明',
      track: '赛道', tag: '标签', region: '区域', relatedMaterials: '相关资料',
      targetCustomer: '目标客户', architect: '架构师', sales: '行业销售',
      partnerName: '伙伴', partnerStatus: '伙伴状态', channelManager: '渠道经理',
      role: '角色', accountId: '账号', isPrimary: '专职', cityId: '城市',
      level: '层级', priority: '优先级', parentIndustry: '父行业',
      status: '状态', phase: '阶段', deployMode: '部署方式',
      amount: '金额', version: '版本', code: '编码', since: '起始时间'
    };
    const propHtml = Object.entries(p).filter(([k, v]) => v && k !== 'id' && k !== 'cityId').map(([k, v]) => {
      const displayName = propNameMap[k] || k;
      let displayVal = String(v);
      // CEM链接转为可点击链接
      if (k === 'cemLink' && v.startsWith('http')) {
        displayVal = `<a href="${this._esc(v)}" target="_blank" style="color:#007AFF;word-break:break-all;">${this._esc(v.length > 40 ? v.substring(0, 37) + '...' : v)}</a>`;
      } else if (displayVal.length > 100) {
        displayVal = this._esc(displayVal.substring(0, 97) + '...');
      } else {
        displayVal = this._esc(displayVal);
      }
      return `<div class="rel-detail-prop"><span class="rel-detail-prop-key">${displayName}</span><span class="rel-detail-prop-val">${displayVal}</span></div>`;
    }).join('');

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

  // ===== 语义检索 (GraphRAG) =====

  /** 语义检索主流程 */
  async _semanticSearch(query) {
    const panel = document.getElementById('relSemanticPanel');
    const body = document.getElementById('relSemanticPanelBody');
    const status = document.getElementById('relSemanticStatus');
    const statusText = document.getElementById('relSemanticStatusText');
    const btn = document.getElementById('relSemanticBtn');

    if (!panel || !body) return;

    // 显示面板
    panel.classList.remove('hidden');
    const mainEl = document.querySelector('.relationship-main');
    if (mainEl) mainEl.classList.add('semantic-active');
    body.innerHTML = '';
    status?.classList.remove('hidden');
    if (statusText) statusText.textContent = '正在提取查询实体...';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 分析中'; }

    // 面板展开后重绘图谱（画布尺寸变化）
    requestAnimationFrame(() => {
      const sub = this.data.subgraph;
      if (sub) this._drawGraph(sub.nodes, sub.edges);
    });

    try {
      // Step 1: 提取实体 — 先用本地提取（即时、可靠），再尝试 API 增强
      const store = window.RelationshipStore;
      let entities = store.extractEntitiesLocal(query);
      console.log('[GraphRAG] Local entities:', entities);

      // 如果本地提取到实体，直接用；否则尝试 API
      const hasEntities = entities.architects.length > 0 || entities.regions.length > 0 ||
                          entities.industries.length > 0 || entities.customers.length > 0;

      if (!hasEntities) {
        // 本地未匹配到，尝试 DeepSeek API
        if (statusText) statusText.textContent = '正在通过 AI 提取查询实体...';
        try {
          const extractResult = await window.electronAPI?.graphExtractEntities?.(query);
          if (extractResult?.success && extractResult?.entities) {
            entities = extractResult.entities;
            console.log('[GraphRAG] API entities:', entities);
          }
        } catch (e) {
          console.warn('[GraphRAG] API extraction failed, using local:', e.message);
        }
      }

      if (statusText) statusText.textContent = `实体提取完成，正在检索图谱...`;

      // Step 2: 查询图谱
      const subgraph = store.semanticQuery(entities);
      console.log('[GraphRAG] Subgraph:', subgraph.summary, `(${subgraph.nodes.length} nodes)`);

      // Step 3: 同步更新图谱视图
      if (subgraph.nodes.length > 0) {
        this.data.subgraph = subgraph;
        // 延迟一帧绘制，确保面板布局已更新画布尺寸
        requestAnimationFrame(() => this._drawGraph(subgraph.nodes, subgraph.edges));
        // 更新节点列表
        const listEl = document.getElementById('relationshipList');
        if (listEl) listEl.innerHTML = this._renderNodeList(subgraph.nodes);
      }

      if (statusText) statusText.textContent = `图谱检索完成（${subgraph.nodes.length}个节点）`;

      // Step 4: 构建上下文文本（保存供 ADP 深度分析使用）
      const graphContext = store.subgraphToText(subgraph.nodes, subgraph.edges);
      const fullQuery = `用户问题：${query}\n\n检索到的图谱数据：\n${graphContext}\n\n请基于以上图谱数据回答用户的问题。`;

      // 如果没有图谱数据
      if (subgraph.nodes.length === 0) {
        body.innerHTML = `<div style="color:var(--text-tertiary);font-size:13px;text-align:center;padding:20px;">图谱中暂无与"${this._esc(query)}"相关的数据</div>`;
        status?.classList.add('hidden');
        if (btn) { btn.disabled = false; btn.textContent = '🔍 AI'; }
        return;
      }

      // Step 5: 先展示本地摘要（快速、不消耗 token）
      const localSummary = this._generateLocalSummary(query, entities, subgraph, store);
      body.innerHTML = `<div style="color:var(--text-tertiary);font-size:12px;margin-bottom:8px;">查询：${this._esc(query)}</div><div id="relStreamContent"></div>`;
      const streamContent = document.getElementById('relStreamContent');
      if (streamContent) {
        streamContent.innerHTML = this._renderMarkdown(localSummary);
      }

      // 添加"使用 AI 深度分析"按钮
      const adpBtn = document.createElement('button');
      adpBtn.className = 'relationship-ai-btn';
      adpBtn.style.cssText = 'margin-top:12px;width:100%;';
      adpBtn.innerHTML = '🤖 使用 AI 深度分析';
      adpBtn.id = 'relAdpDeepBtn';
      body.appendChild(adpBtn);

      status?.classList.add('hidden');
      if (btn) { btn.disabled = false; btn.textContent = '🔍 AI'; }

      // Step 6: 点击按钮触发 ADP 流式深度分析
      adpBtn.addEventListener('click', () => {
        this._startADPDeepAnalysis(query, fullQuery, graphContext, body, btn);
      });
    } catch (err) {
      console.error('[GraphRAG] Error:', err);
      body.innerHTML = `<div style="color:#FF3B30;font-size:13px;">⚠ 语义检索失败：${this._esc(err.message)}</div>`;
      status?.classList.add('hidden');
      if (btn) { btn.disabled = false; btn.textContent = '🔍 AI'; }
      window.electronAPI?.removeGraphSSEListeners?.();
    }
  },

  /** 启动 ADP 深度分析（流式输出） */
  async _startADPDeepAnalysis(originalQuery, fullQuery, graphContext, body, searchBtn) {
    // 先清理之前的 SSE 监听
    window.electronAPI?.removeGraphSSEListeners?.();

    // 替换面板内容为流式输出区域
    body.innerHTML = `
      <div style="color:var(--text-tertiary);font-size:12px;margin-bottom:8px;">查询：${this._esc(originalQuery)}</div>
      <div style="color:var(--text-tertiary);font-size:11px;margin-bottom:8px;padding:6px 10px;background:rgba(0,122,255,0.06);border-radius:8px;">🤖 AI 深度分析中...</div>
      <div id="relStreamContent"></div>
      <div id="relStreamStatus" style="display:flex;align-items:center;gap:8px;padding:8px 0;">
        <div class="spinner" style="width:14px;height:14px;border-width:2px;"></div>
        <span style="font-size:12px;color:var(--text-tertiary);">正在等待 AI 响应...</span>
      </div>
    `;

    const streamContent = document.getElementById('relStreamContent');
    const streamStatus = document.getElementById('relStreamStatus');
    let streamBuffer = '';
    let streamDone = false; // 防止 done 事件重复处理

    // 监听 SSE 事件
    window.electronAPI?.onGraphSSEEvent?.((evt) => {
      console.log('[GraphRAG] SSE event received:', evt?.type, evt?.text?.substring(0, 50));
      if (evt.type === 'text' && evt.text) {
        streamBuffer += evt.text;
        if (streamContent) {
          streamContent.innerHTML = this._renderMarkdown(streamBuffer) + '<span class="rel-streaming-cursor"></span>';
          body.scrollTop = body.scrollHeight;
        }
        if (streamStatus) {
          streamStatus.innerHTML = `<span style="font-size:11px;color:var(--text-tertiary);">⏳ 流式输出中...</span>`;
        }
      } else if (evt.type === 'replace' && evt.text) {
        streamBuffer = evt.text;
        if (streamContent) {
          streamContent.innerHTML = this._renderMarkdown(streamBuffer) + '<span class="rel-streaming-cursor"></span>';
          body.scrollTop = body.scrollHeight;
        }
      } else if (evt.type === 'done') {
        if (streamDone) return; // 防止重复处理
        streamDone = true;
        if (streamContent) {
          streamContent.innerHTML = this._renderMarkdown(streamBuffer);
        }
        if (streamStatus) {
          streamStatus.innerHTML = `<span style="font-size:11px;color:#34C759;">✓ AI 分析完成</span>`;
        }
        // 添加"复制结果"按钮
        const copyBtn = document.createElement('button');
        copyBtn.className = 'relationship-ai-btn secondary';
        copyBtn.style.cssText = 'margin-top:12px;width:auto;align-self:flex-start;padding:6px 16px;font-size:12px;';
        copyBtn.textContent = '📋 复制结果';
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(streamBuffer).then(() => {
            copyBtn.textContent = '✓ 已复制';
            setTimeout(() => { copyBtn.textContent = '📋 复制结果'; }, 2000);
          }).catch(() => {
            // 降级方案
            const ta = document.createElement('textarea');
            ta.value = streamBuffer;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            copyBtn.textContent = '✓ 已复制';
            setTimeout(() => { copyBtn.textContent = '📋 复制结果'; }, 2000);
          });
        });
        body.appendChild(copyBtn);
        // 添加"返回本地摘要"按钮
        const backBtn = document.createElement('button');
        backBtn.className = 'relationship-ai-btn secondary';
        backBtn.style.cssText = 'margin-top:8px;width:100%;';
        backBtn.textContent = '← 返回本地摘要';
        backBtn.addEventListener('click', () => {
          // 重新触发语义检索，会先生成本地摘要
          const input = document.getElementById('relSemanticInput');
          if (input) {
            input.value = originalQuery;
            this._semanticSearch(originalQuery);
          }
        });
        body.appendChild(backBtn);
        // 清理监听
        window.electronAPI?.removeGraphSSEListeners?.();
      } else if (evt.type === 'error') {
        if (streamContent) {
          streamContent.innerHTML += `<div style="color:#FF3B30;font-size:12px;margin-top:8px;">⚠ ${this._esc(evt.error || '未知错误')}</div>`;
        }
        if (streamStatus) {
          streamStatus.innerHTML = `<span style="font-size:11px;color:#FF3B30;">⚠ 分析失败</span>`;
        }
        // 添加"返回本地摘要"按钮
        const backBtn = document.createElement('button');
        backBtn.className = 'relationship-ai-btn secondary';
        backBtn.style.cssText = 'margin-top:12px;width:100%;';
        backBtn.textContent = '← 返回本地摘要';
        backBtn.addEventListener('click', () => {
          const input = document.getElementById('relSemanticInput');
          if (input) {
            input.value = originalQuery;
            this._semanticSearch(originalQuery);
          }
        });
        body.appendChild(backBtn);
        window.electronAPI?.removeGraphSSEListeners?.();
      }
    });

    // 发起 ADP 搜索
    try {
      const result = await window.electronAPI?.graphSemanticSearch?.({
        query: fullQuery,
        graphContext: graphContext
      });

      // 如果 ADP 返回失败且没有任何流式内容，显示提示
      if (result?.success === false && streamBuffer === '') {
        if (streamContent) {
          streamContent.innerHTML = `<div style="color:#FF9500;font-size:13px;padding:12px;">⚠ ADP 分析未能启动：${this._esc(result?.error || '未知错误')}。\n\n请检查 ADP 配置后重试。</div>`;
        }
        if (streamStatus) {
          streamStatus.innerHTML = '';
        }
        // 添加"返回本地摘要"按钮
        const backBtn = document.createElement('button');
        backBtn.className = 'relationship-ai-btn secondary';
        backBtn.style.cssText = 'margin-top:12px;width:100%;';
        backBtn.textContent = '← 返回本地摘要';
        backBtn.addEventListener('click', () => {
          const input = document.getElementById('relSemanticInput');
          if (input) {
            input.value = originalQuery;
            this._semanticSearch(originalQuery);
          }
        });
        body.appendChild(backBtn);
        window.electronAPI?.removeGraphSSEListeners?.();
      }
    } catch (err) {
      console.error('[GraphRAG] ADP deep analysis error:', err);
      if (streamContent) {
        streamContent.innerHTML = `<div style="color:#FF3B30;font-size:13px;padding:12px;">⚠ AI 分析出错：${this._esc(err.message)}</div>`;
      }
      if (streamStatus) {
        streamStatus.innerHTML = '';
      }
      window.electronAPI?.removeGraphSSEListeners?.();
    }
  },

  /** 生成本地摘要（快速、不消耗 token） */
  _generateLocalSummary(query, entities, subgraph, store) {
    const schema = window.RelationshipSchema;
    const lines = [`## 查询：${query}`, ''];
    lines.push(`> 图谱检索到 **${subgraph.nodes.length}** 个相关节点，**${subgraph.edges.length}** 条关系。\n`);

    // 按类型分组
    const byType = {};
    subgraph.nodes.forEach(n => {
      if (!byType[n.label]) byType[n.label] = [];
      byType[n.label].push(n);
    });

    // 如果有架构师
    if (byType['Architect'] && byType['Architect'].length > 0) {
      const archs = byType['Architect'];
      lines.push(`### 👤 架构师 (${archs.length}个)`);
      lines.push('');
      if (archs.length <= 10) {
        lines.push('| 姓名 | 角色 | 区域 | 覆盖行业 |');
        lines.push('|------|------|------|----------|');
        archs.forEach(a => {
          const p = a.properties;
          const region = store.getConnectedNodes(a.id, ['BELONGS_TO']).find(n => n.label === 'Region');
          const industries = store.getConnectedNodes(a.id, ['COVERS']).filter(n => n.label === 'Industry');
          lines.push(`| ${p.name || a.id} | ${p.role || '-'} | ${region?.properties?.name || '-'} | ${industries.map(i => i.properties.name).join(', ') || '-'} |`);
        });
      } else {
        archs.slice(0, 20).forEach(a => {
          lines.push(`- **${a.properties.name}** (${a.properties.role || '架构师'})`);
        });
        lines.push(`- ... 还有 ${archs.length - 20} 位`);
      }
      lines.push('');
    }

    // 如果有客户
    if (byType['Customer'] && byType['Customer'].length > 0) {
      const customers = byType['Customer'];
      lines.push(`### 🏢 客户 (${customers.length}个)`);
      lines.push('');
      if (customers.length <= 15) {
        lines.push('| 客户名 | 行业 | 分层 | 跟进状态 |');
        lines.push('|--------|------|------|----------|');
        customers.forEach(c => {
          const p = c.properties;
          lines.push(`| ${p.name || c.id} | ${p.industryL1 || '-'} | ${p.tier || '-'} | ${p.followupStatus || p.signingStatus || '-'} |`);
        });
      } else {
        customers.slice(0, 20).forEach(c => {
          lines.push(`- **${c.properties.name}** — ${c.properties.industryL1 || '未知行业'} (${c.properties.tier || '-'})`);
        });
        lines.push(`- ... 还有 ${customers.length - 20} 个客户`);
      }
      lines.push('');
    }

    // 如果有行业
    if (byType['Industry'] && byType['Industry'].length > 0) {
      const inds = byType['Industry'].filter(n => n.properties.level === 'L1' || !n.properties.level);
      if (inds.length > 0) {
        lines.push(`### 🏭 行业 (${inds.length}个)`);
        inds.forEach(ind => {
          lines.push(`- **${ind.properties.name}**`);
        });
        lines.push('');
      }
    }

    // 如果有区域
    if (byType['Region'] && byType['Region'].length > 0) {
      lines.push(`### 📍 区域`);
      byType['Region'].forEach(r => {
        const archsInRegion = store.getConnectedNodes(r.id, ['BELONGS_TO']).filter(n => n.label === 'Architect');
        lines.push(`- **${r.properties.name}** — ${archsInRegion.length} 位架构师`);
      });
      lines.push('');
    }

    lines.push('---');
    lines.push('*此摘要由本地图谱数据自动生成（快速预览）。点击下方"使用 AI 深度分析"获取更详细的分析报告。*');

    return lines.join('\n');
  },

  /** 简易 Markdown 渲染器 */
  _renderMarkdown(md) {
    if (!md) return '';
    let html = this._esc(md);

    // 代码块
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => `<pre style="background:rgba(0,0,0,0.04);padding:10px;border-radius:8px;overflow-x:auto;font-size:12px;"><code>${code}</code></pre>`);
    // 行内代码
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // 标题
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    // 粗体
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // 斜体
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // 引用
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    // 表格
    html = html.replace(/^\|(.+)\|$/gm, (m, cells) => {
      const trimmed = cells.trim();
      if (trimmed.includes('---') || trimmed.includes('---')) return ''; // 分隔行
      const tds = trimmed.split('|').map(t => t.trim()).filter(t => t !== '');
      return '<tr>' + tds.map(t => `<td>${t}</td>`).join('') + '</tr>';
    });
    // 包裹连续的 <tr> 为 <table>
    html = html.replace(/(<tr>[\s\S]*?<\/tr>)(?!\s*<tr>)/g, '<table>$1</table>');
    // 无序列表
    html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>');
    // 有序列表
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    // 段落（连续空行分段）
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    // 清理空段落
    html = html.replace(/<p>\s*<\/p>/g, '');
    html = html.replace(/<p>\s*(<(?:h[123]|ul|ol|table|pre|blockquote))/g, '$1');
    html = html.replace(/(<\/(?:h[123]|ul|ol|table|pre|blockquote)>)\s*<\/p>/g, '$1');

    return html;
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
      this.data.searchMatchIds = new Set();
      this.data.searchQuery = '';
      this._searchAnimRunning = false;
      this._renderInit();
      this._showToast('图谱数据已清空', 'success');
    });
  },

  // ===== 导入导出 =====

  _showImportDialog() {
    const existing = document.getElementById('relImportModal');
    if (existing) existing.remove();

    const store = window.RelationshipStore;
    const storageInfo = store?.getStorageInfo?.() || {};

    const modal = document.createElement('div');
    modal.id = 'relImportModal';
    modal.className = 'rel-import-modal';
    modal.innerHTML = `
      <div class="rel-import-overlay"></div>
      <div class="rel-import-dialog" style="max-width:680px;">
        <div class="rel-import-header">
          <h3>📥 导入图谱数据</h3>
          <button class="rel-import-close" id="relImportClose">✕</button>
        </div>
        <div class="rel-import-body" id="relImportBody">
          <!-- 步骤指示器 -->
          <div style="display:flex;gap:8px;margin-bottom:16px;font-size:12px;">
            <span class="rel-step-badge active" id="relStep1" style="padding:4px 12px;border-radius:8px;background:var(--accent-blue,#007AFF);color:#fff;">1. 输入数据</span>
            <span style="color:var(--text-tertiary);">→</span>
            <span class="rel-step-badge" id="relStep2" style="padding:4px 12px;border-radius:8px;background:var(--bg-glass,#e5e5ea);color:var(--text-secondary);">2. AI 提取</span>
            <span style="color:var(--text-tertiary);">→</span>
            <span class="rel-step-badge" id="relStep3" style="padding:4px 12px;border-radius:8px;background:var(--bg-glass,#e5e5ea);color:var(--text-secondary);">3. 确认合并</span>
          </div>

          <!-- 存储信息 -->
          <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:12px;">
            当前图谱：${storageInfo.nodeCount || 0} 节点, ${storageInfo.edgeCount || 0} 边, 存储 ${storageInfo.sizeMB || 0}MB / ${storageInfo.localStorageLimitMB || 10}MB
          </div>

          <!-- Step 1: 输入区域 -->
          <div id="relStep1Content">
            <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
              <button class="relationship-ai-btn" id="relPickFileBtn" style="width:auto;padding:8px 16px;font-size:13px;">
                📄 选择文件
              </button>
              <span style="font-size:11px;color:var(--text-tertiary);align-self:center;">
                支持 Excel/Word/PDF/Markdown/文本/CSV
              </span>
            </div>
            <div id="relFileName" style="font-size:12px;color:var(--accent-blue,#007AFF);margin-bottom:8px;display:none;"></div>
            <textarea id="relImportTextarea" class="rel-import-textarea" rows="10"
              placeholder="粘贴文本内容，或选择文件后自动填充...&#10;&#10;支持格式：&#10;- Excel 表格（客户清单、架构师信息等）&#10;- Word 文档（会议纪要、项目总结等）&#10;- PDF 文档（需要系统安装 pdftotext）&#10;- Markdown / 纯文本"></textarea>
            <div style="display:flex;gap:8px;margin-top:12px;align-items:center;">
              <button class="relationship-ai-btn primary" id="relGenerateBtn" style="width:auto;padding:8px 20px;font-size:13px;">
                🤖 AI 提取图谱
              </button>
              <span style="font-size:11px;color:var(--text-tertiary);" id="relImportHint">
                将调用 AI 从文本中提取人物、组织、行业等实体及关系
              </span>
            </div>
          </div>

          <!-- Step 2: AI 生成中 -->
          <div id="relStep2Content" style="display:none;">
            <div style="text-align:center;padding:30px;">
              <div class="rel-loading-spinner" style="display:inline-block;width:32px;height:32px;border:3px solid var(--bg-glass,#e5e5ea);border-top-color:var(--accent-blue,#007AFF);border-radius:50%;animation:rel-spin 0.8s linear infinite;"></div>
              <p style="margin-top:12px;font-size:13px;color:var(--text-secondary);">AI 正在分析文本，提取实体和关系...</p>
              <p style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">这可能需要 10-30 秒</p>
            </div>
          </div>

          <!-- Step 3: 预览 -->
          <div id="relStep3Content" style="display:none;">
            <div id="relPreviewSummary" style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;"></div>
            <div style="max-height:350px;overflow-y:auto;border:1px solid var(--border-light,rgba(0,0,0,0.08));border-radius:8px;">
              <div id="relPreviewNodes"></div>
              <div id="relPreviewEdges" style="margin-top:8px;"></div>
            </div>
          </div>
        </div>
        <div class="rel-import-footer">
          <button class="rel-import-btn secondary" id="relImportCancelBtn">取消</button>
          <button class="rel-import-btn primary" id="relImportConfirmBtn" style="display:none;">确认合并到图谱</button>
          <button class="rel-import-btn secondary" id="relBackBtn" style="display:none;">← 返回</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // 状态
    let currentStep = 1;
    let generatedGraph = null;
    let extractedText = '';

    const closeBtn = document.getElementById('relImportClose');
    const cancelBtn = document.getElementById('relImportCancelBtn');
    const confirmBtn = document.getElementById('relImportConfirmBtn');
    const backBtn = document.getElementById('relBackBtn');
    const generateBtn = document.getElementById('relGenerateBtn');
    const pickFileBtn = document.getElementById('relPickFileBtn');
    const step1Content = document.getElementById('relStep1Content');
    const step2Content = document.getElementById('relStep2Content');
    const step3Content = document.getElementById('relStep3Content');
    const step1Badge = document.getElementById('relStep1');
    const step2Badge = document.getElementById('relStep2');
    const step3Badge = document.getElementById('relStep3');

    closeBtn?.addEventListener('click', () => modal.remove());
    cancelBtn?.addEventListener('click', () => modal.remove());
    modal.querySelector('.rel-import-overlay')?.addEventListener('click', () => modal.remove());

    // 文件选择
    pickFileBtn?.addEventListener('click', async () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx,.xls,.docx,.doc,.pdf,.md,.txt,.csv,.json';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        // Electron 环境下 file.path 可用
        const filePath = file.path || (file.webkitRelativePath);
        if (!filePath) {
          // 降级：用 FileReader 读取文本
          const reader = new FileReader();
          reader.onload = (ev) => {
            document.getElementById('relImportTextarea').value = ev.target.result;
            document.getElementById('relFileName').style.display = 'block';
            document.getElementById('relFileName').textContent = `📄 ${file.name}`;
            extractedText = ev.target.result;
          };
          reader.readAsText(file);
          return;
        }
        document.getElementById('relFileName').style.display = 'block';
        document.getElementById('relFileName').textContent = `📄 ${file.name}（读取中...）`;
        const result = await window.electronAPI?.graphReadFile?.(filePath);
        if (result?.success) {
          document.getElementById('relImportTextarea').value = result.text.substring(0, 10000) + (result.text.length > 10000 ? '\n\n[... 仅显示前10000字符，完整文本已加载 ...]' : '');
          document.getElementById('relFileName').textContent = `📄 ${file.name}（${result.text.length} 字符）`;
          extractedText = result.text;
        } else {
          document.getElementById('relFileName').textContent = `❌ ${result?.error || '文件读取失败'}`;
          document.getElementById('relFileName').style.color = '#FF3B30';
        }
      };
      input.click();
    });

    // 生成图谱
    generateBtn?.addEventListener('click', async () => {
      const text = extractedText || document.getElementById('relImportTextarea')?.value?.trim();
      if (!text || text.length < 10) {
        this._showToast('请输入或选择至少 10 个字符的文本', 'warning');
        return;
      }
      if (text.length > 50000) {
        this._showToast(`文本过长（${text.length}字符），将截取前 50000 字符分析`, 'warning');
      }

      // 切到 Step 2
      currentStep = 2;
      step1Content.style.display = 'none';
      step2Content.style.display = 'block';
      step3Content.style.display = 'none';
      step1Badge.style.background = 'var(--bg-glass,#e5e5ea)';
      step1Badge.style.color = 'var(--text-secondary)';
      step2Badge.style.background = 'var(--accent-blue,#007AFF)';
      step2Badge.style.color = '#fff';
      generateBtn.style.display = 'none';
      confirmBtn.style.display = 'none';
      backBtn.style.display = 'none';

      // 构建已有图谱上下文（帮助 AI 去重）
      const store = window.RelationshipStore;
      const existingNodes = store?.getNodes?.() || [];
      const existingSummary = existingNodes.slice(0, 200).map(n =>
        `${n.label}: ${n.properties.name || n.id}`
      ).join(', ');

      const result = await window.electronAPI?.graphGenerateFromText?.({
        text,
        existingContext: existingSummary
      });

      if (result?.success && result.graphData) {
        generatedGraph = result.graphData;
        currentStep = 3;
        this._renderImportPreview(generatedGraph, modal);
        step2Content.style.display = 'none';
      step2Badge.style.background = 'var(--bg-glass,#e5e5ea)';
      step2Badge.style.color = 'var(--text-secondary)';
        step3Content.style.display = 'block';
        step3Badge.style.background = 'var(--accent-blue,#007AFF)';
        step3Badge.style.color = '#fff';
        confirmBtn.style.display = 'block';
        backBtn.style.display = 'block';
      } else {
        this._showToast('AI 提取失败: ' + (result?.error || '未知错误'), 'error');
        // 返回 Step 1
        currentStep = 1;
        step2Content.style.display = 'none';
        step1Content.style.display = 'block';
        step2Badge.style.background = 'var(--bg-glass,#e5e5ea)';
        step2Badge.style.color = 'var(--text-secondary)';
        step1Badge.style.background = 'var(--accent-blue,#007AFF)';
        step1Badge.style.color = '#fff';
        generateBtn.style.display = 'block';
      }
    });

    // 返回
    backBtn?.addEventListener('click', () => {
      currentStep = 1;
      step3Content.style.display = 'none';
      step2Content.style.display = 'none';
      step1Content.style.display = 'block';
      step3Badge.style.background = 'var(--bg-glass,#e5e5ea)';
      step3Badge.style.color = 'var(--text-secondary)';
      step1Badge.style.background = 'var(--accent-blue,#007AFF)';
      step1Badge.style.color = '#fff';
      confirmBtn.style.display = 'none';
      backBtn.style.display = 'none';
      generateBtn.style.display = 'block';
    });

    // 确认合并
    confirmBtn?.addEventListener('click', () => {
      if (!generatedGraph) return;
      const nodes = generatedGraph.nodes || [];
      const edges = generatedGraph.edges || [];
      const result = store?.mergeGraph(nodes, edges);
      if (result) {
        this._showToast(
          `合并完成：新增 ${result.addedNodes} 节点, 更新 ${result.updatedNodes} 节点, 新增 ${result.addedEdges} 边` +
          (result.storageSizeMB ? `（存储 ${result.storageSizeMB}MB）` : ''),
          'success'
        );
        modal.remove();
        this._render();
      } else {
        this._showToast('合并失败', 'error');
      }
    });
  },

  /** 渲染导入预览 */
  _renderImportPreview(graphData, modal) {
    const nodes = graphData.nodes || [];
    const edges = graphData.edges || [];
    const summary = document.getElementById('relPreviewSummary');
    const nodesEl = document.getElementById('relPreviewNodes');
    const edgesEl = document.getElementById('relPreviewEdges');

    if (summary) {
      summary.innerHTML = `AI 提取完成：<strong>${nodes.length}</strong> 个实体, <strong>${edges.length}</strong> 条关系。请检查后确认合并。`;
    }

    // 按类型分组节点
    const grouped = {};
    nodes.forEach(n => {
      const label = n.label || 'Other';
      if (!grouped[label]) grouped[label] = [];
      grouped[label].push(n);
    });

    // 渲染节点
    if (nodesEl) {
      let html = '';
      const labelNames = {
        Architect: '架构师', Customer: '客户', Industry: '行业', Region: '区域',
        Sales: '销售', Product: '产品', Partner: '伙伴', Channel: '通路',
        Case: '案例', City: '城市'
      };
      Object.entries(grouped).forEach(([label, items]) => {
        html += `<div style="margin-bottom:8px;">`;
        html += `<div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">${labelNames[label] || label} (${items.length})</div>`;
        items.forEach((n, idx) => {
          const name = n.name || n.properties?.name || '未命名';
          const propsStr = Object.entries(n.properties || {})
            .filter(([k]) => k !== 'name')
            .slice(0, 5)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');
          html += `<div class="rel-preview-item" data-node-idx="${idx}" style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px;font-size:12px;border-bottom:1px solid var(--border-light,rgba(0,0,0,0.04));">
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              <strong>${this._esc(name)}</strong>${propsStr ? `<span style="color:var(--text-tertiary);margin-left:8px;">${this._esc(propsStr)}</span>` : ''}
            </span>
            <button class="rel-preview-del" data-node-idx="${idx}" style="background:none;border:none;color:#FF3B30;cursor:pointer;font-size:14px;padding:2px 8px;">✕</button>
          </div>`;
        });
        html += `</div>`;
      });
      nodesEl.innerHTML = html;

      // 删除按钮
      nodesEl.querySelectorAll('.rel-preview-del').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.nodeIdx);
          const nodeName = graphData.nodes[idx]?.name || graphData.nodes[idx]?.properties?.name || '';
          // 删除节点
          graphData.nodes.splice(idx, 1);
          // 删除引用该节点的边
          graphData.edges = graphData.edges.filter(ed => ed.source !== nodeName && ed.target !== nodeName);
          this._renderImportPreview(graphData, modal);
        });
      });
    }

    // 渲染边
    if (edgesEl) {
      const edgeTypeNames = {
        BELONGS_TO: '属于', COVERS: '覆盖', SUPPORTS: '支持', LEADS: '主导',
        LOCATED_IN: '位于', CUSTOMER_IN: '属于', SOLD_BY: '销售',
        VIA_CHANNEL: '通路', PARTNER_WITH: '合作', FOR: '属于',
        IN: '属于', USES: '使用', CONTAINS: '包含', CROSS_REGION: '跨区', COOPERATES: '协作'
      };
      let html = `<div style="font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">关系 (${edges.length})</div>`;
      edges.forEach((e, idx) => {
        html += `<div class="rel-preview-item" style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px;font-size:12px;border-bottom:1px solid var(--border-light,rgba(0,0,0,0.04));">
          <span>
            <strong>${this._esc(e.source || '?')}</strong>
            <span style="color:var(--accent-blue,#007AFF);margin:0 6px;">—${edgeTypeNames[e.type] || e.type}→</span>
            <strong>${this._esc(e.target || '?')}</strong>
          </span>
          <button class="rel-preview-del-edge" data-edge-idx="${idx}" style="background:none;border:none;color:#FF3B30;cursor:pointer;font-size:14px;padding:2px 8px;">✕</button>
        </div>`;
      });
      edgesEl.innerHTML = html;

      edgesEl.querySelectorAll('.rel-preview-del-edge').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.edgeIdx);
          graphData.edges.splice(idx, 1);
          this._renderImportPreview(graphData, modal);
        });
      });
    }
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
