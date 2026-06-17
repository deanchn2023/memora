/**
 * Memora v2.5 — 人脉图谱数据管理器
 * 负责图谱数据的 CRUD、查询、导入导出、持久化
 * 数据结构：nodes[] + edges[]，每个 node 有 label/type 属性
 */

const RelationshipStore = {
  _data: null,    // { nodes: [], edges: [], meta: {} }
  _dirty: false,

  /** 获取存储路径 */
  _getStorageKey() {
    return 'relationship-graph-data';
  },

  /** 初始化空数据结构 */
  _emptyData() {
    return {
      nodes: [],
      edges: [],
      meta: {
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodeCount: 0,
        edgeCount: 0
      }
    };
  },

  /** 从 localStorage 加载 */
  load() {
    try {
      const raw = localStorage.getItem(this._getStorageKey());
      if (raw) {
        this._data = JSON.parse(raw);
        return this._data;
      }
    } catch (e) {
      console.error('[RelationshipStore] Load error:', e);
    }
    this._data = this._emptyData();
    return this._data;
  },

  /** 保存到 localStorage */
  save() {
    if (!this._data) return;
    this._data.meta.updatedAt = new Date().toISOString();
    this._data.meta.nodeCount = this._data.nodes.length;
    this._data.meta.edgeCount = this._data.edges.length;
    try {
      localStorage.setItem(this._getStorageKey(), JSON.stringify(this._data));
      this._dirty = false;
    } catch (e) {
      console.error('[RelationshipStore] Save error:', e);
    }
  },

  /** 获取当前数据 */
  getData() {
    if (!this._data) this.load();
    return this._data;
  },

  /** 清空所有数据 */
  clear() {
    this._data = this._emptyData();
    localStorage.removeItem(this._getStorageKey());
    this._dirty = false;
  },

  // ===== 节点操作 =====

  /** 添加节点 */
  addNode(label, properties) {
    if (!this._data) this.load();
    const id = properties.id || `${label.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const node = {
      id,
      label,
      properties: { ...properties, id }
    };
    // 检查重复
    if (this._data.nodes.find(n => n.id === id)) {
      return this.updateNode(id, properties);
    }
    this._data.nodes.push(node);
    this._dirty = true;
    return node;
  },

  /** 批量添加节点 */
  addNodes(label, items) {
    return items.map(item => this.addNode(label, item));
  },

  /** 获取节点 */
  getNode(id) {
    if (!this._data) this.load();
    return this._data.nodes.find(n => n.id === id) || null;
  },

  /** 按类型查询节点 */
  getNodesByLabel(label) {
    if (!this._data) this.load();
    return this._data.nodes.filter(n => n.label === label);
  },

  /** 按属性查询节点 */
  queryNodes(label, filters) {
    if (!this._data) this.load();
    return this._data.nodes.filter(n => {
      if (label && n.label !== label) return false;
      if (filters) {
        for (const [key, val] of Object.entries(filters)) {
          if (n.properties[key] !== val) return false;
        }
      }
      return true;
    });
  },

  /** 更新节点属性 */
  updateNode(id, properties) {
    if (!this._data) this.load();
    const node = this._data.nodes.find(n => n.id === id);
    if (node) {
      Object.assign(node.properties, properties);
      this._dirty = true;
    }
    return node;
  },

  /** 删除节点（及其关联边） */
  deleteNode(id) {
    if (!this._data) this.load();
    this._data.nodes = this._data.nodes.filter(n => n.id !== id);
    this._data.edges = this._data.edges.filter(e => e.source !== id && e.target !== id);
    this._dirty = true;
  },

  // ===== 边操作 =====

  /** 添加边 */
  addEdge(type, sourceId, targetId, properties = {}) {
    if (!this._data) this.load();
    const edge = {
      type,
      source: sourceId,
      target: targetId,
      properties
    };
    // 查重：同 type + source + target 视为重复
    const dup = this._data.edges.find(e =>
      e.type === type && e.source === sourceId && e.target === targetId
    );
    if (dup) {
      Object.assign(dup.properties, properties);
      return dup;
    }
    this._data.edges.push(edge);
    this._dirty = true;
    return edge;
  },

  /** 获取节点的所有关联边 */
  getEdgesForNode(nodeId) {
    if (!this._data) this.load();
    return this._data.edges.filter(e => e.source === nodeId || e.target === nodeId);
  },

  /** 获取节点的一级关联节点 */
  getConnectedNodes(nodeId, edgeTypes = null) {
    const edges = this.getEdgesForNode(nodeId).filter(e =>
      !edgeTypes || edgeTypes.includes(e.type)
    );
    const ids = new Set();
    edges.forEach(e => {
      if (e.source !== nodeId) ids.add(e.source);
      if (e.target !== nodeId) ids.add(e.target);
    });
    return [...ids].map(id => this.getNode(id)).filter(Boolean);
  },

  /** 获取二级关联节点 */
  getSecondLevelNodes(nodeId) {
    const level1 = this.getConnectedNodes(nodeId);
    const level2Set = new Set();
    level1.forEach(n => {
      this.getConnectedNodes(n.id).forEach(n2 => {
        if (n2.id !== nodeId) level2Set.add(n2.id);
      });
    });
    return [...level2Set].map(id => this.getNode(id)).filter(Boolean);
  },

  /** 删除边 */
  deleteEdge(type, sourceId, targetId) {
    if (!this._data) this.load();
    this._data.edges = this._data.edges.filter(e =>
      !(e.type === type && e.source === sourceId && e.target === targetId)
    );
    this._dirty = true;
  },

  // ===== 查询 =====

  /** 按条件展开图谱 — 返回指定节点的子图 */
  expandSubgraph(options = {}) {
    const { centerNodeId, labels, edgeTypes, tier, industry, region, search, maxDepth = 2 } = options;
    if (!this._data) this.load();

    let centerNodes = [];

    if (centerNodeId) {
      const n = this.getNode(centerNodeId);
      if (n) centerNodes = [n];
    } else if (search) {
      // 搜索匹配
      const q = search.toLowerCase();
      centerNodes = this._data.nodes.filter(n =>
        (n.properties.name || '').toLowerCase().includes(q) ||
        (n.properties.role || '').toLowerCase().includes(q)
      );
    } else if (labels && labels.length > 0) {
      centerNodes = this._data.nodes.filter(n => labels.includes(n.label));
    } else if (region) {
      // 按区域展开：找到该区域的架构师
      const regionNode = this._data.nodes.find(n => n.label === 'Region' && n.properties.name === region);
      if (regionNode) {
        centerNodes = this.getConnectedNodes(regionNode.id, ['BELONGS_TO']);
      }
    } else if (industry) {
      const indNode = this._data.nodes.find(n => n.label === 'Industry' && n.properties.name === industry);
      if (indNode) {
        centerNodes = this.getConnectedNodes(indNode.id, ['COVERS']);
      }
    }

    // 扩展关联
    const visited = new Set();
    const resultNodes = new Set();
    const resultEdges = new Set();

    const expand = (nodes, depth) => {
      if (depth > maxDepth) return;
      nodes.forEach(n => {
        if (visited.has(n.id)) return;
        visited.add(n.id);
        resultNodes.add(n.id);

        // 如果指定了 edgeTypes 过滤
        const edges = this.getEdgesForNode(n.id).filter(e =>
          !edgeTypes || edgeTypes.includes(e.type)
        );
        edges.forEach(e => {
          resultEdges.add(`${e.type}|${e.source}|${e.target}`);
          const nextId = e.source === n.id ? e.target : e.source;
          if (!visited.has(nextId)) {
            const next = this.getNode(nextId);
            if (next) expand([next], depth + 1);
          }
        });
      });
    };

    // 如果没有特定条件，返回概览（只含 Architect + Region + Industry）
    if (centerNodes.length === 0 && !centerNodeId && !search && !labels) {
      centerNodes = this._data.nodes.filter(n =>
        n.label === 'Architect' || n.label === 'Region' || n.label === 'Industry'
      );
      // 概览模式只展开1层
      expand(centerNodes, 0);
    } else {
      expand(centerNodes, 0);
    }

    // tier 过滤（对 Customer 类型节点）
    const nodeIds = [...resultNodes];
    const filteredNodes = nodeIds.filter(id => {
      if (tier) {
        const n = this.getNode(id);
        if (n.label === 'Customer' && n.properties.tier !== tier) return false;
      }
      return true;
    });

    return {
      nodes: filteredNodes.map(id => this.getNode(id)).filter(Boolean),
      edges: [...resultEdges].map(key => {
        const [type, source, target] = key.split('|');
        return this._data.edges.find(e => e.type === type && e.source === source && e.target === target);
      }).filter(Boolean)
    };
  },

  /** 获取统计信息 */
  getStats() {
    if (!this._data) this.load();
    const stats = {};
    this._data.nodes.forEach(n => {
      stats[n.label] = (stats[n.label] || 0) + 1;
    });
    return {
      total: this._data.nodes.length,
      totalEdges: this._data.edges.length,
      byType: stats
    };
  },

  // ===== 导入导出 =====

  /** 导出为 JSON */
  exportJSON() {
    if (!this._data) this.load();
    return JSON.stringify(this._data, null, 2);
  },

  /** 从 JSON 导入 */
  importJSON(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      if (!data.nodes || !data.edges) {
        throw new Error('无效的图谱数据格式');
      }
      this._data = data;
      this.save();
      return { success: true, nodeCount: data.nodes.length, edgeCount: data.edges.length };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  /** 用初始数据初始化 */
  initFromInitialData(initialData, customerData) {
    this.clear();
    const schema = window.RelationshipSchema;

    // 1. 区域
    initialData.regions.forEach(r => this.addNode('Region', r));

    // 2. 城市
    initialData.cities.forEach(c => this.addNode('City', c));

    // 3. 行业
    initialData.industries.forEach(i => this.addNode('Industry', i));

    // 4. 产品
    initialData.products.forEach(p => this.addNode('Product', p));

    // 5. 架构师
    initialData.architects.forEach(a => {
      const cityId = a.city;
      this.addNode('Architect', { ...a, city: undefined, cityId });
    });

    // 6. 客户（从插旗表数据）
    if (customerData) {
      Object.values(customerData).forEach(c => {
        const id = `cust-${this._slugId(c.name)}`;
        this.addNode('Customer', {
          id,
          name: c.name,
          tier: c.tier || '其他',
          sector: c.industry || '',
          status: c.status || '未知'
        });
      });
    }

    // 7. 关系
    // BELONGS_TO
    initialData.architectRegions.forEach(r =>
      this.addEdge('BELONGS_TO', r.architect, r.region, { isPrimary: r.isPrimary })
    );

    // COVERS
    initialData.architectIndustries.forEach(r =>
      this.addEdge('COVERS', r.architect, r.industry, {})
    );

    // LOCATED_IN
    initialData.architects.forEach(a => {
      if (a.city) this.addEdge('LOCATED_IN', a.id, a.city, {});
    });

    // CROSS_REGION
    initialData.crossRegions.forEach(r =>
      this.addEdge('CROSS_REGION', r.source, r.target, { note: r.note })
    );

    // COOPERATES
    initialData.cooperations.forEach(r =>
      this.addEdge('COOPERATES', r.source, r.target, { event: r.event })
    );

    // CONTAINS
    initialData.regionCities.forEach(r =>
      this.addEdge('CONTAINS', r.region, r.city, {})
    );

    // SUPPORTS（架构师-客户，从插旗表数据）
    if (customerData) {
      const archMap = {};
      initialData.architects.forEach(a => {
        archMap[a.name] = a.id;
        if (a.accountId) archMap[a.accountId] = a.id;
      });
      Object.entries(customerData).forEach(([custName, c]) => {
        const custId = `cust-${this._slugId(custName)}`;
        // 架构师-客户关系
        (c.architects || []).forEach(archName => {
          const archId = archMap[archName];
          if (archId) {
            this.addEdge('SUPPORTS', archId, custId, {});
          }
        });
        // 客户-行业关系
        if (c.industry) {
          const indNode = this._data.nodes.find(n =>
            n.label === 'Industry' && n.properties.name.includes(c.industry)
          );
          if (indNode) {
            this.addEdge('CUSTOMER_IN', custId, indNode.id, {});
          }
        }
        // 客户-产品关系（通过 Case）
        if (c.products && c.products.length > 0) {
          c.products.forEach(prodName => {
            const prodNode = this._data.nodes.find(n =>
              n.label === 'Product' && n.properties.name === prodName
            );
            if (prodNode) {
              // 创建 Case 节点
              const caseId = `case-${this._slugId(custName)}-${prodName}`;
              const existingCase = this.getNode(caseId);
              if (!existingCase) {
                this.addNode('Case', {
                  id: caseId,
                  name: `${custName}-${prodName}`,
                  status: c.status || '未知',
                  phase: '',
                  deployMode: ''
                });
                this.addEdge('FOR', caseId, custId, {});
                this.addEdge('USES', caseId, prodNode.id, {});
              }
            }
          });
        }
      });
    }

    this.save();
    return this.getStats();
  },

  /** 生成 URL-safe ID */
  _slugId(str) {
    return str.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').substring(0, 50);
  }
};

window.RelationshipStore = RelationshipStore;
console.log('[RelationshipStore] Graph data manager loaded');
