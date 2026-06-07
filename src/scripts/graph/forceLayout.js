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
    this._animFrame = null;

    this._resize();
    this._bindEvents();
  }

  setData(data) {
    const { nodes, edges } = data;
    const cx = this.canvas.width / this.dpr / 2;
    const cy = this.canvas.height / this.dpr / 2;

    // 按 domain 分组环形布局
    const domainGroups = {};
    nodes.forEach(n => {
      const group = n.domain || n.type;
      if (!domainGroups[group]) domainGroups[group] = [];
      domainGroups[group].push(n);
    });

    const groupKeys = Object.keys(domainGroups);
    const groupRadius = Math.min(cx, cy) * 0.35;

    groupKeys.forEach((key, gi) => {
      const angle = (2 * Math.PI * gi) / groupKeys.length - Math.PI / 2;
      const gx = cx + groupRadius * Math.cos(angle);
      const gy = cy + groupRadius * Math.sin(angle);

      domainGroups[key].forEach((n, ni) => {
        const subAngle = (2 * Math.PI * ni) / domainGroups[key].length;
        const subR = n.type === 'domain' ? 0 : 70;
        n.x = gx + subR * Math.cos(subAngle);
        n.y = gy + subR * Math.sin(subAngle);
        n.vx = 0;
        n.vy = 0;
        n.visible = true;
        n.dimmed = false;
      });
    });

    this.nodes = nodes;
    this.edges = edges;
    this.alpha = 1;
    this.running = true;
    this._tick();
  }

  _tick() {
    if (!this.running) return;
    if (this.alpha > 0.001) {
      this._applyForces();
      this.alpha *= 0.995;
    }
    this._render();
    this._animFrame = requestAnimationFrame(() => this._tick());
  }

  _applyForces() {
    const REPULSION = 900;
    const ATTRACTION = 0.008;
    const DAMPING = 0.85;
    const CENTER = 0.008;
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
        : (isHoverRelated || isSelectedRelated ? 'rgba(0,122,255,0.4)' : 'rgba(174,174,178,0.2)');
      ctx.lineWidth = Math.max(0.5, (e.strength || 0.3) * 2.5 * (isHoverRelated || isSelectedRelated ? 1.5 : 1));
      ctx.stroke();
      ctx.setLineDash([]);

      // 边标签
      if (isHoverRelated && e.label) {
        const mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
        ctx.fillStyle = '#86868b';
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
      grad.addColorStop(0, color + 'ee');
      grad.addColorStop(1, color + '99');
      ctx.fillStyle = grad;
      ctx.fill();

      // 边框
      if (isHovered || isSelected) {
        ctx.strokeStyle = '#1d1d1f';
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
                       : '#FF3B30';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // 标签
      ctx.fillStyle = dimmed ? 'rgba(29,29,31,0.2)' : '#1d1d1f';
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
    // 微妙的渐变光球背景
    const orbs = [
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
    const base = { domain: 24, cluster: 17, atom: 12, person: 14, question: 11, gap: 13 };
    return (base[n.type] || 10) * ((n.weight || 5) / 5);
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
