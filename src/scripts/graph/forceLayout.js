/**
 * ForceLayout - Canvas 力导向图渲染
 * 负责：力模拟、节点渲染、交互事件
 */

class ForceLayout {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.nodes = [];
    this.edges = [];
    this.transform = { x: 0, y: 0, scale: 1 };
    this.dragging = null;
    this.hovering = null;
    this.selectedNode = null;
    this.alpha = 1;
    this.running = false;
    this.filterType = 'all';
    this.searchQuery = '';
    this.dpr = window.devicePixelRatio || 1;
    this.onNodeClick = null;
    this.onNodeDblClick = null;
    this.onZoomChange = null;
    this._animFrame = null;
    this._themeCache = {};
    this._themeCacheTimer = null;
    this._frozen = false;
    this._animating = false;
    this._animProgress = 0;
    this._pendingFitView = false;

    this._resize();
    this._bindEvents();
    this._refreshThemeCache();

    // 主题切换时刷新缓存
    this._themeChangeHandler = () => {
      setTimeout(() => this._refreshThemeCache(), 100);
    };
    window.ThemeEngine?.setOnThemeChange?.(this._themeChangeHandler);
  }

  // 读取 CSS 变量用于 Canvas 渲染（避免硬编码颜色）
  _refreshThemeCache() {
    const s = getComputedStyle(document.documentElement);
    this._themeCache = {
      textPrimary: s.getPropertyValue('--text-primary').trim() || '#1d1d1f',
      textSecondary: s.getPropertyValue('--text-secondary').trim() || '#86868b',
      textTertiary: s.getPropertyValue('--text-tertiary').trim() || '#aeaeb2',
      bgPrimary: s.getPropertyValue('--bg-primary').trim() || '#f5f5f7',
      isDark: s.getPropertyValue('--bg-primary').trim() !== '' &&
        this._isColorDark(s.getPropertyValue('--bg-primary').trim()),
    };
  }

  _isColorDark(color) {
    const c = color.replace('#', '');
    if (c.length !== 6) return false;
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    return (r * 0.299 + g * 0.587 + b * 0.114) < 128;
  }

  // 计算确定性环形布局位置（不依赖力模拟）
  _calcRingLayout() {
    const cx = this.canvas.width / this.dpr / 2;
    const cy = this.canvas.height / this.dpr / 2;
    const baseR = Math.min(cx, cy) * 0.42;

    const domainGroups = {};
    this.nodes.forEach(n => {
      const group = n.domain || n.type;
      if (!domainGroups[group]) domainGroups[group] = [];
      domainGroups[group].push(n);
    });

    const groupKeys = Object.keys(domainGroups);

    groupKeys.forEach((key, gi) => {
      const angle = (2 * Math.PI * gi) / groupKeys.length - Math.PI / 2;
      const gx = cx + baseR * Math.cos(angle);
      const gy = cy + baseR * Math.sin(angle);

      domainGroups[key].forEach((n, ni) => {
        const isDomain = n.type === 'domain';
        if (isDomain) {
          n._targetX = gx;
          n._targetY = gy;
        } else {
          const subAngle = (2 * Math.PI * ni) / domainGroups[key].length;
          const subR = 80 + Math.sqrt(domainGroups[key].length) * 12;
          n._targetX = gx + subR * Math.cos(subAngle);
          n._targetY = gy + subR * Math.sin(subAngle);
        }
      });
    });
  }

  // 一键重新布局 — 从中心展开到环形布局，动画完成后静止
  reLayout() {
    this._refreshThemeCache();
    const cx = this.canvas.width / this.dpr / 2;
    const cy = this.canvas.height / this.dpr / 2;

    // 计算目标位置
    this._calcRingLayout();

    // 先将节点收到中心
    this.nodes.forEach(n => {
      n._startX = n.x;
      n._startY = n.y;
      // 如果节点在视口外，从中心出发
      if (!n._startX || !n._startY) {
        n._startX = cx + (Math.random() - 0.5) * 20;
        n._startY = cy + (Math.random() - 0.5) * 20;
      }
      n.vx = 0;
      n.vy = 0;
    });

    // 用动画插值到目标位置（不用力模拟）
    this._animating = true;
    this._animProgress = 0;
    this._frozen = false;

    // 重置变换，稍后自动 fit
    this.transform = { x: 0, y: 0, scale: 1 };

    if (!this.running) {
      this.running = true;
      this._tick();
    }
  }

  setData(data) {
    const { nodes, edges } = data;
    this._refreshThemeCache();

    const cx = this.canvas.width / this.dpr / 2;
    const cy = this.canvas.height / this.dpr / 2;

    // 计算目标位置
    this.nodes = nodes;
    this.edges = edges;
    this._calcRingLayout();

    // 所有节点从中心出发
    nodes.forEach(n => {
      n.x = cx + (Math.random() - 0.5) * 16;
      n.y = cy + (Math.random() - 0.5) * 16;
      n._startX = n.x;
      n._startY = n.y;
      n.vx = 0;
      n.vy = 0;
      n.visible = true;
      n.dimmed = false;
    });

    // 用动画插值展开
    this._animating = true;
    this._animProgress = 0;
    this._frozen = false;
    this.alpha = 0;
    this.running = true;
    this._tick();
  }

  _tick() {
    if (!this.running) return;

    if (this._animating) {
      // 动画插值模式：节点从起始位置平滑移动到目标位置
      this._animProgress += 0.018;
      const t = Math.min(1, this._animProgress);
      // ease-out cubic
      const ease = 1 - Math.pow(1 - t, 3);

      this.nodes.forEach(n => {
        if (n._startX !== undefined && n._targetX !== undefined) {
          n.x = n._startX + (n._targetX - n._startX) * ease;
          n.y = n._startY + (n._targetY - n._startY) * ease;
        }
      });

      if (t >= 1) {
        // 动画完成，冻结
        this._animating = false;
        this._frozen = true;
        this.nodes.forEach(n => {
          n.vx = 0;
          n.vy = 0;
          delete n._startX;
          delete n._startY;
          delete n._targetX;
          delete n._targetY;
        });
        // 自动适配视口
        this._fitView();
        this._pendingFitView = false;
      }
    } else if (this.alpha > 0.005 && !this._frozen) {
      // 力模拟模式（仅用于拖拽后微调）
      this._applyForces();
      this.alpha *= 0.95;
      if (this.alpha <= 0.005) {
        this._frozen = true;
        this.nodes.forEach(n => { n.vx = 0; n.vy = 0; });
      }
    }

    this._render();
    this._animFrame = requestAnimationFrame(() => this._tick());
  }

  // 聚拢：所有节点向中心收拢
  gather() {
    if (this.nodes.length === 0 || this._animating) return;
    const cx = this.canvas.width / this.dpr / 2;
    const cy = this.canvas.height / this.dpr / 2;

    this.nodes.forEach(n => {
      if (!n.visible) return;
      n._startX = n.x;
      n._startY = n.y;
      // 目标：向中心收拢到 30% 的距离
      n._targetX = cx + (n.x - cx) * 0.15;
      n._targetY = cy + (n.y - cy) * 0.15;
    });

    this._animating = true;
    this._animProgress = 0;
    this._frozen = false;
    if (!this.running) {
      this.running = true;
      this._tick();
    }
  }

  // 扩散：所有节点从当前位置向外扩散
  scatter() {
    if (this.nodes.length === 0 || this._animating) return;
    const cx = this.canvas.width / this.dpr / 2;
    const cy = this.canvas.height / this.dpr / 2;

    this.nodes.forEach(n => {
      if (!n.visible) return;
      n._startX = n.x;
      n._startY = n.y;
      // 目标：从中心向外推 1.8 倍
      n._targetX = cx + (n.x - cx) * 1.8;
      n._targetY = cy + (n.y - cy) * 1.8;
    });

    this._animating = true;
    this._animProgress = 0;
    this._frozen = false;
    if (!this.running) {
      this.running = true;
      this._tick();
    }

    // 动画结束后自动 fit
    this._pendingFitView = true;
  }

  // 设置缩放级别（0.2 ~ 5）
  setZoom(scale) {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const centerX = w / 2;
    const centerY = h / 2;
    this.transform.x = centerX - (centerX - this.transform.x) * (scale / this.transform.scale);
    this.transform.y = centerY - (centerY - this.transform.y) * (scale / this.transform.scale);
    this.transform.scale = scale;
  }

  // 获取当前缩放级别
  getZoom() {
    return this.transform.scale;
  }

  // 聚焦到指定节点：平移+缩放使其居中
  focusNode(node, targetScale = 1.5, animated = true) {
    if (!node) return;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;

    if (!animated) {
      this.transform.x = w / 2 - node.x * targetScale;
      this.transform.y = h / 2 - node.y * targetScale;
      this.transform.scale = targetScale;
      if (this.onZoomChange) this.onZoomChange(targetScale);
      return;
    }

    // 动画过渡到目标位置
    const targetTx = w / 2 - node.x * targetScale;
    const targetTy = h / 2 - node.y * targetScale;
    const startTx = this.transform.x;
    const startTy = this.transform.y;
    const startScale = this.transform.scale;
    let progress = 0;

    const animate = () => {
      progress += 0.04;
      const t = Math.min(1, progress);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic

      this.transform.x = startTx + (targetTx - startTx) * ease;
      this.transform.y = startTy + (targetTy - startTy) * ease;
      this.transform.scale = startScale + (targetScale - startScale) * ease;

      if (this.onZoomChange) this.onZoomChange(this.transform.scale);

      if (t < 1) {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }

  // 自动适配视口，确保所有节点可见
  _fitView() {
    if (this.nodes.length === 0) return;
    const visibleNodes = this.nodes.filter(n => n.visible);
    if (visibleNodes.length === 0) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    visibleNodes.forEach(n => {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    });

    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const padding = 60;
    const contentW = maxX - minX + padding * 2;
    const contentH = maxY - minY + padding * 2;

    const scale = Math.min(w / contentW, h / contentH, 2);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    this.transform = {
      x: w / 2 - centerX * scale,
      y: h / 2 - centerY * scale,
      scale: scale
    };
    if (this.onZoomChange) this.onZoomChange(scale);
  }

  _applyForces() {
    const REPULSION = 2500;
    const ATTRACTION = 0.004;
    const DAMPING = 0.82;
    const CENTER = 0.002;
    const cx = this.canvas.width / this.dpr / 2;
    const cy = this.canvas.height / this.dpr / 2;
    const visibleNodes = this.nodes.filter(n => n.visible);

    // 斥力
    for (let i = 0; i < visibleNodes.length; i++) {
      for (let j = i + 1; j < visibleNodes.length; j++) {
        const a = visibleNodes[i], b = visibleNodes[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = REPULSION * this.alpha / (dist * dist);
        const fx = (dx / dist) * f, fy = (dy / dist) * f;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }

    // 引力（边）
    const nodeMap = new Map(this.nodes.map(n => [n.id, n]));
    this.edges.forEach(e => {
      const s = nodeMap.get(e.source_id), t = nodeMap.get(e.target_id);
      if (!s || !t || !s.visible || !t.visible) return;
      const dx = t.x - s.x, dy = t.y - s.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = dist * ATTRACTION * (e.strength || 0.5) * this.alpha;
      s.vx += (dx / dist) * f; s.vy += (dy / dist) * f;
      t.vx -= (dx / dist) * f; t.vy -= (dy / dist) * f;
    });

    // 中心引力
    visibleNodes.forEach(n => {
      n.vx += (cx - n.x) * CENTER;
      n.vy += (cy - n.y) * CENTER;
    });

    // 更新位置
    visibleNodes.forEach(n => {
      if (n === this.dragging) return;
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      n.x += n.vx;
      n.y += n.vy;
    });
  }

  _render() {
    const { ctx, canvas, transform, dpr } = this;
    const w = canvas.width / dpr, h = canvas.height / dpr;
    const tc = this._themeCache;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);

    // 背景渐变光球
    this._renderBgOrbs(w, h);

    const nodeMap = new Map(this.nodes.map(n => [n.id, n]));

    // 边
    this.edges.forEach(e => {
      const s = nodeMap.get(e.source_id), t = nodeMap.get(e.target_id);
      if (!s || !t || !s.visible || !t.visible) return;

      const isHoverRelated = this.hovering && (this.hovering.id === e.source_id || this.hovering.id === e.target_id);
      const isSelectedRelated = this.selectedNode && (this.selectedNode.id === e.source_id || this.selectedNode.id === e.target_id);
      const isConflictEdge = e.type === 'conflicts_with';

      ctx.beginPath();
      if (isConflictEdge) {
        ctx.setLineDash([4, 4]);
      }
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = isConflictEdge
        ? (isHoverRelated || isSelectedRelated ? 'rgba(255,59,48,0.6)' : 'rgba(255,59,48,0.25)')
        : (isHoverRelated || isSelectedRelated ? 'rgba(91,168,247,0.4)' : (tc.isDark ? 'rgba(148,163,184,0.15)' : 'rgba(174,174,178,0.2)'));
      ctx.lineWidth = Math.max(0.5, (e.strength || 0.3) * 2.5 * (isHoverRelated || isSelectedRelated ? 1.5 : 1));
      ctx.stroke();
      ctx.setLineDash([]);

      // 边标签
      if (isHoverRelated && e.label) {
        const mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
        ctx.fillStyle = tc.textSecondary;
        ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(e.label, mx, my - 4);
      }
    });

    // 节点
    this.nodes.forEach(n => {
      if (!n.visible) return;
      const r = this._radius(n);
      const color = this._nodeColor(n);
      const isHovered = this.hovering?.id === n.id;
      const isSelected = this.selectedNode?.id === n.id;
      const dimmed = n.dimmed;

      ctx.globalAlpha = dimmed ? 0.2 : 1;

      // 缺口脉冲
      if (n.density === 'gap' && !dimmed) {
        const pulse = Math.sin(Date.now() / 500) * 4 + r + 4;
        ctx.beginPath();
        ctx.arc(n.x, n.y, pulse, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,59,48,0.12)';
        ctx.fill();
      }

      // 冲突闪烁
      if (n.health === 'conflicting' && !dimmed) {
        const flash = 0.5 + 0.5 * Math.sin(Date.now() / 300);
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,149,0,${flash * 0.2})`;
        ctx.fill();
      }

      // 节点光晕（选中/悬停）
      if ((isHovered || isSelected) && !dimmed) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 8, 0, Math.PI * 2);
        ctx.fillStyle = color.replace(')', ',0.15)').replace('rgb', 'rgba');
        ctx.fill();
      }

      // 形状
      ctx.beginPath();
      if (n.type === 'question') {
        ctx.moveTo(n.x, n.y - r);
        ctx.lineTo(n.x - r, n.y + r * 0.6);
        ctx.lineTo(n.x + r, n.y + r * 0.6);
        ctx.closePath();
      } else {
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      }

      // 填充渐变
      const grad = ctx.createRadialGradient(n.x - r * 0.3, n.y - r * 0.3, 0, n.x, n.y, r);
      grad.addColorStop(0, color.replace('rgb(', 'rgba(').replace(')', ',0.93)'));
      grad.addColorStop(1, color.replace('rgb(', 'rgba(').replace(')', ',0.6)'));
      ctx.fillStyle = grad;
      ctx.fill();

      // 边框
      if (isHovered || isSelected) {
        ctx.strokeStyle = tc.isDark ? 'rgba(232,236,244,0.6)' : 'rgba(29,29,31,0.8)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      } else if (n.health === 'outdated') {
        ctx.strokeStyle = 'rgba(255,149,0,0.6)';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 人物图标
      if (n.type === 'person') {
        ctx.fillStyle = '#fff';
        ctx.font = `${Math.max(8, r * 0.8)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('\u{1F464}', n.x, n.y);
      }

      // 健康标记小圆点
      if (n.health && n.health !== 'healthy' && !dimmed) {
        const hx = n.x + r * 0.7, hy = n.y - r * 0.7;
        ctx.beginPath();
        ctx.arc(hx, hy, 4, 0, Math.PI * 2);
        ctx.fillStyle = n.health === 'conflicting' ? '#FF9500'
                       : n.health === 'outdated' ? '#FF9500'
                       : n.health === 'duplicate' ? '#86868b'
                       : n.health === 'orphaned' ? '#86868b'
                       : n.health === 'unanswered' ? '#FF9500'
                       : '#FF3B30';
        ctx.fill();
        ctx.strokeStyle = tc.isDark ? 'rgba(21,25,34,0.8)' : '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // 标签 — 根据主题自动适配文字颜色
      ctx.fillStyle = dimmed
        ? (tc.isDark ? 'rgba(232,236,244,0.2)' : 'rgba(29,29,31,0.2)')
        : tc.textPrimary;
      ctx.font = `${isHovered || isSelected ? '600 12' : '500 11'}px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const label = n.label.length > 10 ? n.label.substring(0, 10) + '...' : n.label;
      ctx.fillText(label, n.x, n.y + r + 5);

      ctx.globalAlpha = 1;
    });

    ctx.restore();
  }

  _renderBgOrbs(w, h) {
    const tc = this._themeCache;
    // 微妙的渐变光球背景 — 根据主题调整
    const orbs = tc.isDark
      ? [
          { x: w * 0.2, y: h * 0.3, r: 200, color: 'rgba(91,168,247,0.04)' },
          { x: w * 0.7, y: h * 0.6, r: 250, color: 'rgba(74,222,128,0.03)' },
          { x: w * 0.5, y: h * 0.8, r: 180, color: 'rgba(251,191,36,0.02)' }
        ]
      : [
          { x: w * 0.2, y: h * 0.3, r: 200, color: 'rgba(0,122,255,0.03)' },
          { x: w * 0.7, y: h * 0.6, r: 250, color: 'rgba(52,199,89,0.03)' },
          { x: w * 0.5, y: h * 0.8, r: 180, color: 'rgba(255,149,0,0.02)' }
        ];
    orbs.forEach(orb => {
      const grad = this.ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.r);
      grad.addColorStop(0, orb.color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      this.ctx.fillStyle = grad;
      this.ctx.fillRect(0, 0, w, h);
    });
  }

  _nodeColor(n) {
    if (n.density === 'gap') return 'rgb(255,59,48)';
    if (n.health === 'conflicting') return 'rgb(255,149,0)';
    if (n.health === 'unanswered') return 'rgb(255,149,0)';
    const colors = {
      domain: 'rgb(0,122,255)',
      cluster: 'rgb(88,86,214)',
      atom: 'rgb(52,199,89)',
      person: 'rgb(175,82,222)',
      question: 'rgb(255,149,0)',
      gap: 'rgb(255,59,48)'
    };
    return colors[n.type] || 'rgb(134,134,139)';
  }

  _radius(n) {
    const base = { domain: 28, cluster: 18, atom: 12, person: 14, question: 12, gap: 14 };
    const b = base[n.type] || 12;
    // 使用 sqrt 缩放避免极端差异：weight 1-13 映射到合理范围
    const w = Math.max(1, n.weight || 5);
    const scale = 0.5 + Math.sqrt(w) * 0.25;
    return Math.max(8, Math.round(b * scale));
  }

  filter(type) {
    this.filterType = type;
    if (type === 'all') {
      this.nodes.forEach(n => n.visible = true);
    } else if (type === 'gap') {
      this.nodes.forEach(n => n.visible = n.density === 'gap');
    } else if (type === 'unhealthy') {
      this.nodes.forEach(n => n.visible = n.health !== 'healthy');
    } else {
      this.nodes.forEach(n => n.visible = n.type === type);
    }
    // 只显示两端都可见的边
  }

  search(query) {
    this.searchQuery = query.toLowerCase();
    if (!query) {
      this.nodes.forEach(n => n.dimmed = false);
      return;
    }
    this.nodes.forEach(n => {
      const match = (n.label || '').toLowerCase().includes(this.searchQuery) ||
                    (n.domain || '').toLowerCase().includes(this.searchQuery) ||
                    (n.summary || '').toLowerCase().includes(this.searchQuery);
      n.dimmed = !match;
    });
  }

  highlight(nodeId) {
    const connected = new Set([nodeId]);
    this.edges.forEach(e => {
      if (e.source_id === nodeId) connected.add(e.target_id);
      if (e.target_id === nodeId) connected.add(e.source_id);
    });
    this.nodes.forEach(n => n.dimmed = !connected.has(n.id));
  }

  clearHighlight() {
    this.nodes.forEach(n => n.dimmed = false);
    this.selectedNode = null;
  }

  _bindEvents() {
    let isPanning = false;
    let lastMouse = { x: 0, y: 0 };

    this.canvas.addEventListener('mousedown', e => {
      const pos = this._screenToGraph(e);
      const node = this._hitTest(pos);
      if (node) {
        this.dragging = node;
      } else {
        isPanning = true;
      }
      lastMouse = { x: e.clientX, y: e.clientY };
    });

    this.canvas.addEventListener('mousemove', e => {
      if (this.dragging) {
        const pos = this._screenToGraph(e);
        this.dragging.x = pos.x;
        this.dragging.y = pos.y;
        this.dragging.vx = 0;
        this.dragging.vy = 0;
        return;
      }
      if (isPanning) {
        this.transform.x += e.clientX - lastMouse.x;
        this.transform.y += e.clientY - lastMouse.y;
        lastMouse = { x: e.clientX, y: e.clientY };
        return;
      }
      const pos = this._screenToGraph(e);
      this.hovering = this._hitTest(pos);
      this.canvas.style.cursor = this.hovering ? 'pointer' : 'grab';
    });

    this.canvas.addEventListener('mouseup', () => {
      // 拖拽结束后直接静止，不重启力模拟
      this.dragging = null;
      isPanning = false;
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.dragging = null;
      isPanning = false;
      this.hovering = null;
    });

    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.transform.x = mx - (mx - this.transform.x) * delta;
      this.transform.y = my - (my - this.transform.y) * delta;
      this.transform.scale *= delta;
      this.transform.scale = Math.max(0.2, Math.min(5, this.transform.scale));
      if (this.onZoomChange) this.onZoomChange(this.transform.scale);
    }, { passive: false });

    this.canvas.addEventListener('click', e => {
      if (this.dragging) return;
      const pos = this._screenToGraph(e);
      const node = this._hitTest(pos);
      if (node && this.onNodeClick) {
        this.onNodeClick(node);
      } else if (!node) {
        this.clearHighlight();
      }
    });

    this.canvas.addEventListener('dblclick', e => {
      const pos = this._screenToGraph(e);
      const node = this._hitTest(pos);
      if (node && this.onNodeDblClick) {
        this.onNodeDblClick(node);
      }
    });

    // 触摸支持
    let touchStart = null;
    this.canvas.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        const pos = this._screenToGraph(touch);
        const node = this._hitTest(pos);
        if (node) {
          this.dragging = node;
        }
        touchStart = { x: touch.clientX, y: touch.clientY };
      }
    }, { passive: true });

    this.canvas.addEventListener('touchmove', e => {
      if (this.dragging && e.touches.length === 1) {
        e.preventDefault();
        const pos = this._screenToGraph(e.touches[0]);
        this.dragging.x = pos.x;
        this.dragging.y = pos.y;
      }
    }, { passive: false });

    this.canvas.addEventListener('touchend', () => {
      this.dragging = null;
    });

    // 窗口大小变化
    const ro = new ResizeObserver(() => this._resize());
    ro.observe(this.canvas.parentElement);
  }

  _screenToGraph(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - this.transform.x) / this.transform.scale,
      y: (e.clientY - rect.top - this.transform.y) / this.transform.scale
    };
  }

  _hitTest(pos) {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      if (!n.visible) continue;
      const r = this._radius(n) + 6;
      const dx = pos.x - n.x, dy = pos.y - n.y;
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  }

  _resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  destroy() {
    this.running = false;
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
  }
}

window.ForceLayout = ForceLayout;
