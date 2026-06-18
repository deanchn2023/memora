/**
 * Memora v2.5 — 人脉图谱数据管理器
 * 负责图谱数据的 CRUD、查询、导入导出、持久化
 * 数据结构：nodes[] + edges[]，每个 node 有 label/type 属性
 * 支持插旗表全部 30 列数据导入
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
        version: 5,
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
        // 版本检测：v5 修复 BELONGS_TO 区域 ID 映射缺失问题
        if (!this._data.meta || this._data.meta.version < 5) {
          const customerCount = this._data.nodes.filter(n => n.label === 'Customer').length;
          const indEdges = this._data.edges.filter(e => e.type === 'COVERS').length;
          // 如果没有COVERS边（行业映射bug的旧数据），或没有客户，清除重新初始化
          if (customerCount === 0 || (indEdges === 0 && customerCount > 0)) {
            console.log(`[RelationshipStore] Old data v${this._data.meta?.version || 0}, customers=${customerCount}, COVERS edges=${indEdges}, clearing for re-init`);
            this.clear();
          } else {
            // 检查 BELONGS_TO 边是否指向不存在的区域节点（v4 数据有此 bug）
            const belongsEdges = this._data.edges.filter(e => e.type === 'BELONGS_TO');
            const regionIds = new Set(this._data.nodes.filter(n => n.label === 'Region').map(n => n.id));
            const brokenBelongs = belongsEdges.filter(e => !regionIds.has(e.target));
            if (brokenBelongs.length > 0) {
              console.log(`[RelationshipStore] v${this._data.meta?.version || 0} data has ${brokenBelongs.length} broken BELONGS_TO edges (region ID mismatch), clearing for re-init`);
              this.clear();
            } else {
              // 数据正常，升级版本号
              this._data.meta.version = 5;
              this.save();
            }
          }
        }
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

    // 多条件组合筛选
    if (centerNodeId) {
      const n = this.getNode(centerNodeId);
      if (n) centerNodes = [n];
    } else if (search) {
      // 搜索匹配 — 在所有属性中搜索
      const q = search.toLowerCase();
      centerNodes = this._data.nodes.filter(n => {
        for (const val of Object.values(n.properties)) {
          if (val && String(val).toLowerCase().includes(q)) return true;
        }
        return false;
      });
    } else if (region || industry || tier) {
      // 层级筛选组合：以客户为核心，找到满足所有条件的客户，再扩展关联
      let matchingCustomerIds = null; // null = 未开始筛选, Set = 已筛选

      // 区域筛选：找到该区域的客户
      if (region) {
        // 方式1：客户属性中的 region 字段
        const custByProp = this._data.nodes.filter(n =>
          n.label === 'Customer' && n.properties.region === region
        );
        // 方式2：通过 CUSTOMER_IN 边连接到 Region 节点的客户
        const regionNode = this._data.nodes.find(n => n.label === 'Region' && n.properties.name === region);
        const custByEdge = regionNode
          ? this.getConnectedNodes(regionNode.id, ['CUSTOMER_IN']).filter(n => n.label === 'Customer')
          : [];
        // 方式3：架构师属于该区域，架构师 SUPPORTS 的客户
        const archInRegion = regionNode
          ? this.getConnectedNodes(regionNode.id, ['BELONGS_TO']).filter(n => n.label === 'Architect')
          : [];
        const custByArch = [];
        archInRegion.forEach(arch => {
          this.getConnectedNodes(arch.id, ['SUPPORTS']).forEach(cn => {
            if (cn.label === 'Customer') custByArch.push(cn);
          });
        });

        const regionCustIds = new Set([
          ...custByProp.map(n => n.id),
          ...custByEdge.map(n => n.id),
          ...custByArch.map(n => n.id)
        ]);
        matchingCustomerIds = regionCustIds;
      }

      // 行业筛选：找到属于该行业的客户
      if (industry) {
        const indNode = this._data.nodes.find(n => n.label === 'Industry' && n.properties.name === industry);
        // 方式1：客户属性中的 industryL1/industryL2 字段
        const custByProp = this._data.nodes.filter(n =>
          n.label === 'Customer' && (n.properties.industryL1 === industry || n.properties.industryL2 === industry)
        );
        // 方式2：通过 CUSTOMER_IN 边连接到 Industry 节点的客户
        const custByEdge = indNode
          ? this.getConnectedNodes(indNode.id, ['CUSTOMER_IN']).filter(n => n.label === 'Customer')
          : [];
        // 方式3：架构师覆盖该行业，架构师 SUPPORTS 的客户
        const archInInd = indNode
          ? this.getConnectedNodes(indNode.id, ['COVERS']).filter(n => n.label === 'Architect')
          : [];
        const custByArch = [];
        archInInd.forEach(arch => {
          this.getConnectedNodes(arch.id, ['SUPPORTS']).forEach(cn => {
            if (cn.label === 'Customer') custByArch.push(cn);
          });
        });

        const indCustIds = new Set([
          ...custByProp.map(n => n.id),
          ...custByEdge.map(n => n.id),
          ...custByArch.map(n => n.id)
        ]);

        // 取交集
        if (matchingCustomerIds !== null) {
          matchingCustomerIds = new Set([...matchingCustomerIds].filter(id => indCustIds.has(id)));
        } else {
          matchingCustomerIds = indCustIds;
        }
      }

      // 客户分层筛选
      if (tier) {
        const tierCustIds = new Set(
          this._data.nodes.filter(n => n.label === 'Customer' && n.properties.tier === tier).map(n => n.id)
        );
        if (matchingCustomerIds !== null) {
          matchingCustomerIds = new Set([...matchingCustomerIds].filter(id => tierCustIds.has(id)));
        } else {
          matchingCustomerIds = tierCustIds;
        }
      }

      // 构建中心节点：匹配的客户 + 它们的直接关联节点
      const matchedCustomers = (matchingCustomerIds || new Set())
        .map ? [...matchingCustomerIds].map(id => this.getNode(id)).filter(Boolean) : [];

      // 收集所有需要展示的节点
      const resultNodeIds = new Set(matchedCustomers.map(n => n.id));

      // 从每个匹配客户扩展1跳，收集关联节点
      matchedCustomers.forEach(cust => {
        const edges = this.getEdgesForNode(cust.id);
        edges.forEach(e => {
          const otherId = e.source === cust.id ? e.target : e.source;
          const other = this.getNode(otherId);
          if (other) resultNodeIds.add(otherId);
        });
      });

      // 如果选了区域，确保 Region 节点也在
      if (region) {
        const regionNode = this._data.nodes.find(n => n.label === 'Region' && n.properties.name === region);
        if (regionNode) resultNodeIds.add(regionNode.id);
      }
      // 如果选了行业，确保 Industry 节点也在
      if (industry) {
        const indNode = this._data.nodes.find(n => n.label === 'Industry' && n.properties.name === industry);
        if (indNode) resultNodeIds.add(indNode.id);
      }

      centerNodes = [...resultNodeIds].map(id => this.getNode(id)).filter(Boolean);
    } else if (labels && labels.length > 0) {
      centerNodes = this._data.nodes.filter(n => labels.includes(n.label));
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

    // 如果没有特定条件，返回概览
    if (centerNodes.length === 0 && !centerNodeId && !search && !labels && !region && !industry && !tier) {
      centerNodes = this._data.nodes.filter(n =>
        n.label === 'Architect' || n.label === 'Region' || n.label === 'Industry'
      );
      expand(centerNodes, 0);
    } else {
      expand(centerNodes, 0);
    }

    return {
      nodes: [...resultNodes].map(id => this.getNode(id)).filter(Boolean),
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

  // ===== 从插旗表全量数据初始化 =====

  /** 从插旗表全量 JSON 数据初始化图谱 */
  initFromFlagmapData(flagmapRecords) {
    this.clear();
    const schema = window.RelationshipSchema;

    // 索引缓存
    const nameIndex = {
      architect: {},  // name → id
      region: {},     // name → id
      industryL1: {}, // name → id
      industryL2: {}, // name → id
      sales: {},      // name → id
      product: {},    // name → id
      partner: {},    // name → id
      channel: {},    // name → id
      customer: {},   // name → id
    };

    // ===== 1. 区域（从 Excel 区域列提取唯一值 + 初始数据的北华东华南） =====
    const regionNames = new Set(['华北', '华东', '华南']);
    flagmapRecords.forEach(r => {
      if (r['区域']) regionNames.add(r['区域'].trim());
    });
    [...regionNames].forEach(name => {
      const id = `region-${this._slugId(name)}`;
      this.addNode('Region', { id, name, code: name.charAt(0) });
      nameIndex.region[name] = id;
    });

    // ===== 2. 一级行业（去重） =====
    const l1Names = new Set();
    flagmapRecords.forEach(r => {
      if (r['一级行业']) l1Names.add(r['一级行业'].trim());
    });
    // 合并初始数据中的行业
    const initialIndustries = [
      '泛互/战略', '教育', '零售消费', '金融', '能源/制造/消费电子',
      '医疗', '运营商', '政务政法', '文旅地产', '数金交传', '出行', '海外'
    ];
    initialIndustries.forEach(n => l1Names.add(n));
    [...l1Names].sort().forEach(name => {
      const id = `ind-l1-${this._slugId(name)}`;
      this.addNode('Industry', { id, name, level: 'L1', priority: 'medium' });
      nameIndex.industryL1[name] = id;
    });

    // ===== 3. 二级行业（去重） =====
    const l2Names = new Set();
    flagmapRecords.forEach(r => {
      if (r['二级行业']) l2Names.add(r['二级行业'].trim());
    });
    [...l2Names].sort().forEach(name => {
      const id = `ind-l2-${this._slugId(name)}`;
      this.addNode('Industry', { id, name, level: 'L2', priority: 'medium' });
      nameIndex.industryL2[name] = id;
    });

    // ===== 4. 通路（去重） =====
    const channelNames = new Set();
    flagmapRecords.forEach(r => {
      if (r['通路']) channelNames.add(r['通路'].trim());
    });
    ['KA', '区域', '渠道', '区域销售', '渠道销售'].forEach(n => channelNames.add(n));
    [...channelNames].filter(n => n && n !== '无').forEach(name => {
      const id = `ch-${this._slugId(name)}`;
      this.addNode('Channel', { id, name });
      nameIndex.channel[name] = id;
    });

    // ===== 5. 产品（去重，从产品列+中标方列提取） =====
    const productNames = new Set(['ADP', 'CodeBuddy', 'WorkBuddy', 'Agent Portal', 'Claw Pro', '百炼', 'Coze', 'Dify', 'FastGPT', 'HiAgent', 'Ti', '数智人', '大模型客服']);
    flagmapRecords.forEach(r => {
      if (r['产品']) {
        // 产品列可能包含多个产品，用中文逗号/顿号/英文逗号分隔
        r['产品'].split(/[,，、;；\s]+/).forEach(p => {
          const trimmed = p.trim();
          if (trimmed && trimmed !== '0') productNames.add(trimmed);
        });
      }
    });
    [...productNames].sort().forEach(name => {
      const id = `prod-${this._slugId(name)}`;
      this.addNode('Product', { id, name, version: '' });
      nameIndex.product[name] = id;
    });

    // ===== 6. 架构师（从初始数据 + Excel 补充） =====
    const archData = window.INITIAL_DATA?.architects || [];
    archData.forEach(a => {
      this.addNode('Architect', { ...a, city: undefined, cityId: a.city || '' });
      nameIndex.architect[a.name] = a.id;
      if (a.accountId) nameIndex.architect[a.accountId] = a.id;
    });
    // 从 Excel 补充未在初始数据中的架构师
    const archNames = new Set(archData.map(a => a.name));
    flagmapRecords.forEach(r => {
      if (r['产品架构师']) {
        r['产品架构师'].split(/[,，、;；\s]+/).forEach(name => {
          name = name.trim();
          if (name && !archNames.has(name)) {
            archNames.add(name);
            const id = `arch-${this._slugId(name)}`;
            this.addNode('Architect', { id, name, city: '', role: '产品架构师', accountId: '', isPrimary: true });
            nameIndex.architect[name] = id;
          }
        });
      }
    });

    // ===== 7. 行业销售（去重） =====
    const salesNames = new Set();
    flagmapRecords.forEach(r => {
      if (r['行业销售']) {
        r['行业销售'].split(/[,，、&;；\s]+/).forEach(name => {
          name = name.trim();
          if (name) salesNames.add(name);
        });
      }
    });
    [...salesNames].sort().forEach(name => {
      const id = `sales-${this._slugId(name)}`;
      this.addNode('Sales', { id, name, region: '' });
      nameIndex.sales[name] = id;
    });

    // ===== 8. 伙伴（去重） =====
    const partnerNames = new Set();
    flagmapRecords.forEach(r => {
      if (r['伙伴名称']) {
        r['伙伴名称'].split(/[,，、;；\s]+/).forEach(name => {
          name = name.trim();
          if (name) partnerNames.add(name);
        });
      }
    });
    [...partnerNames].sort().forEach(name => {
      const id = `partner-${this._slugId(name)}`;
      this.addNode('Partner', { id, name, status: '', channelManager: '' });
      nameIndex.partner[name] = id;
    });

    // ===== 9. 客户（全量 1659 条） =====
    flagmapRecords.forEach(r => {
      const customerName = (r['客户名'] || '').trim();
      if (!customerName) return;

      const id = `cust-${this._slugId(customerName)}`;
      const props = { id, name: customerName };

      // 映射所有字段
      if (r['一级行业']) props.industryL1 = r['一级行业'].trim();
      if (r['二级行业']) props.industryL2 = r['二级行业'].trim();
      if (r['通路'] && r['通路'] !== '无') props.channel = r['通路'].trim();
      if (r['客户对智能体需求']) props.aiDemand = r['客户对智能体需求'].trim();
      if (r['产品形态'] && r['产品形态'] !== '0') props.productForm = r['产品形态'].trim();
      if (r['中标方']) props.biddingWinner = r['中标方'].trim();
      if (r['中标时间'] && r['中标时间'] !== '0') props.biddingDate = String(r['中标时间']).trim();
      if (r['腾讯是否参与poc/投标']) props.tencentParticipated = r['腾讯是否参与poc/投标'].trim();
      if (r['客户分层']) props.tier = r['客户分层'].trim();
      if (r['云产三是否已建联']) props.cloudProductConnected = r['云产三是否已建联'].trim();
      if (r['是否转为商机']) props.convertedToOpportunity = r['是否转为商机'].trim();
      if (r['跟进状态']) props.followupStatus = r['跟进状态'].trim();
      if (r['签约状态']) props.signingStatus = r['签约状态'].trim();
      if (r['参与友商']) props.competitorProducts = r['参与友商'].trim();
      if (r['产品'] && r['产品'] !== '0') props.product = r['产品'].trim();
      if (r['CEM链接']) props.cemLink = r['CEM链接'].trim();
      if (r['备注']) props.notes = r['备注'].trim();
      if (r['权威标签']) props.authorityTag = r['权威标签'].trim();
      if (r['赛道']) props.track = r['赛道'].trim();
      if (r['标签']) props.tag = r['标签'].trim();
      if (r['区域']) props.region = r['区域'].trim();
      if (r['相关资料']) props.relatedMaterials = r['相关资料'].trim();
      if (r['目标客户']) props.targetCustomer = String(r['目标客户']).trim();

      this.addNode('Customer', props);
      nameIndex.customer[customerName] = id;
    });

    // ===== 10. 关系建立 =====

    // 行业 ID 映射：INITIAL_DATA 中的旧 ID → flagmap 数据创建的新 ID
    const industryIdMap = {
      'ind-paninternet': nameIndex.industryL1['泛互/战略'],
      'ind-education': nameIndex.industryL1['教育'],
      'ind-retail': nameIndex.industryL1['零售消费'],
      'ind-finance': nameIndex.industryL1['金融'],
      'ind-energy': nameIndex.industryL1['能源/制造/消费电子'],
      'ind-medical': nameIndex.industryL1['医疗'],
      'ind-carrier': nameIndex.industryL1['运营商'],
      'ind-gov': nameIndex.industryL1['政务政法'],
      'ind-travel': nameIndex.industryL1['文旅地产'],
      'ind-digifin': nameIndex.industryL1['数金交传'],
      'ind-transport': nameIndex.industryL1['出行'],
      'ind-overseas': nameIndex.industryL1['海外']
    };

    // 区域 ID 映射：INITIAL_DATA 中的旧 ID → flagmap 数据创建的新 ID
    const regionIdMap = {
      'region-north': nameIndex.region['华北'],
      'region-east': nameIndex.region['华东'],
      'region-south': nameIndex.region['华南']
    };

    // 架构师-区域（映射旧 ID 到新 ID）
    (window.INITIAL_DATA?.architectRegions || []).forEach(r => {
      const mappedRegId = regionIdMap[r.region] || r.region;
      const regNode = this.getNode(mappedRegId);
      if (regNode) {
        this.addEdge('BELONGS_TO', r.architect, mappedRegId, { isPrimary: r.isPrimary });
      } else {
        console.warn('[RelationshipStore] BELONGS_TO: region not found:', r.region, '→', mappedRegId);
      }
    });

    // 架构师-行业（映射旧 ID 到新 ID）
    (window.INITIAL_DATA?.architectIndustries || []).forEach(r => {
      const mappedIndId = industryIdMap[r.industry] || r.industry;
      const indNode = this.getNode(mappedIndId);
      if (indNode) {
        this.addEdge('COVERS', r.architect, mappedIndId, {});
      }
    });

    // 架构师-城市
    (window.INITIAL_DATA?.architects || []).forEach(a => {
      if (a.city) this.addEdge('LOCATED_IN', a.id, a.city, {});
    });

    // 跨区
    (window.INITIAL_DATA?.crossRegions || []).forEach(r =>
      this.addEdge('CROSS_REGION', r.source, r.target, { note: r.note })
    );

    // 协作
    (window.INITIAL_DATA?.cooperations || []).forEach(r =>
      this.addEdge('COOPERATES', r.source, r.target, { event: r.event })
    );

    // 区域-城市
    (window.INITIAL_DATA?.regionCities || []).forEach(r =>
      this.addEdge('CONTAINS', r.region, r.city, {})
    );

    // ===== 从 Excel 行建立关系 =====
    flagmapRecords.forEach(r => {
      const customerName = (r['客户名'] || '').trim();
      if (!customerName) return;
      const custId = nameIndex.customer[customerName];
      if (!custId) return;

      // 客户 → 一级行业
      if (r['一级行业']) {
        const indId = nameIndex.industryL1[r['一级行业'].trim()];
        if (indId) this.addEdge('CUSTOMER_IN', custId, indId, { level: 'L1' });
      }

      // 客户 → 二级行业
      if (r['二级行业']) {
        const indId = nameIndex.industryL2[r['二级行业'].trim()];
        if (indId) this.addEdge('CUSTOMER_IN', custId, indId, { level: 'L2' });
      }

      // 客户 → 通路
      if (r['通路'] && r['通路'] !== '无') {
        const chId = nameIndex.channel[r['通路'].trim()];
        if (chId) this.addEdge('VIA_CHANNEL', custId, chId, {});
      }

      // 客户 → 区域
      if (r['区域']) {
        const regId = nameIndex.region[r['区域'].trim()];
        if (regId) this.addEdge('CUSTOMER_IN', custId, regId, {});
      }

      // 架构师 → 客户（SUPPORTS）
      if (r['产品架构师']) {
        r['产品架构师'].split(/[,，、;；\s]+/).forEach(archName => {
          archName = archName.trim();
          const archId = nameIndex.architect[archName];
          if (archId && archId !== custId) {
            this.addEdge('SUPPORTS', archId, custId, {});
          }
        });
      }

      // 客户 → 行业销售（SOLD_BY）
      if (r['行业销售']) {
        r['行业销售'].split(/[,，、&;；\s]+/).forEach(salesName => {
          salesName = salesName.trim();
          const salesId = nameIndex.sales[salesName];
          if (salesId) this.addEdge('SOLD_BY', custId, salesId, {});
        });
      }

      // 客户 → 伙伴（PARTNER_WITH）
      if (r['伙伴名称']) {
        r['伙伴名称'].split(/[,，、;；\s]+/).forEach(partnerName => {
          partnerName = partnerName.trim();
          const partnerId = nameIndex.partner[partnerName];
          if (partnerId) {
            this.addEdge('PARTNER_WITH', custId, partnerId, {
              status: (r['伙伴合作状态'] || '').trim()
            });
          }
        });
      }

      // 客户 → 产品（通过 Case 中间节点）
      if (r['产品'] && r['产品'] !== '0') {
        r['产品'].split(/[,，、;；\s]+/).forEach(prodName => {
          prodName = prodName.trim();
          if (!prodName) return;
          // 尝试模糊匹配产品
          let prodId = nameIndex.product[prodName];
          if (!prodId) {
            // 尝试在产品名中查找包含关系
            for (const [key, id] of Object.entries(nameIndex.product)) {
              if (key.toLowerCase().includes(prodName.toLowerCase()) ||
                  prodName.toLowerCase().includes(key.toLowerCase())) {
                prodId = id;
                break;
              }
            }
          }
          if (prodId) {
            const caseId = `case-${this._slugId(customerName)}-${this._slugId(prodName)}`;
            const existingCase = this.getNode(caseId);
            if (!existingCase) {
              this.addNode('Case', {
                id: caseId,
                name: `${customerName} - ${prodName}`,
                status: r['跟进状态'] || r['签约状态'] || '未知',
                phase: '',
                deployMode: r['产品形态'] || ''
              });
              this.addEdge('FOR', caseId, custId, {});
              this.addEdge('USES', caseId, prodId, {});

              // 架构师主导案例
              if (r['产品架构师']) {
                r['产品架构师'].split(/[,，、;；\s]+/).forEach(archName => {
                  archName = archName.trim();
                  const archId = nameIndex.architect[archName];
                  if (archId) this.addEdge('LEADS', archId, caseId, {});
                });
              }
            }
          }
        });
      }
    });

    // 更新伙伴的渠道经理和合作状态
    flagmapRecords.forEach(r => {
      if (r['伙伴名称'] && r['渠道经理']) {
        const partnerId = nameIndex.partner[r['伙伴名称'].trim()];
        if (partnerId) {
          this.updateNode(partnerId, {
            channelManager: r['渠道经理'].trim(),
            status: (r['伙伴合作状态'] || '').trim()
          });
        }
      }
    });

    this.save();
    return this.getStats();
  },

  /** 用初始数据初始化（旧接口，保留兼容） */
  initFromInitialData(initialData, customerData) {
    // 如果有插旗表全量数据，优先用新方法
    if (customerData && Array.isArray(customerData) && customerData.length > 0) {
      return this.initFromFlagmapData(customerData);
    }
    // 旧逻辑
    this.clear();
    initialData.regions.forEach(r => this.addNode('Region', r));
    initialData.cities.forEach(c => this.addNode('City', c));
    initialData.industries.forEach(i => this.addNode('Industry', i));
    initialData.products.forEach(p => this.addNode('Product', p));
    initialData.architects.forEach(a => {
      const cityId = a.city;
      this.addNode('Architect', { ...a, city: undefined, cityId });
    });
    initialData.architectRegions.forEach(r =>
      this.addEdge('BELONGS_TO', r.architect, r.region, { isPrimary: r.isPrimary })
    );
    initialData.architectIndustries.forEach(r =>
      this.addEdge('COVERS', r.architect, r.industry, {})
    );
    initialData.architects.forEach(a => {
      if (a.city) this.addEdge('LOCATED_IN', a.id, a.city, {});
    });
    initialData.crossRegions.forEach(r =>
      this.addEdge('CROSS_REGION', r.source, r.target, { note: r.note })
    );
    initialData.cooperations.forEach(r =>
      this.addEdge('COOPERATES', r.source, r.target, { event: r.event })
    );
    initialData.regionCities.forEach(r =>
      this.addEdge('CONTAINS', r.region, r.city, {})
    );
    this.save();
    return this.getStats();
  },

  /** 生成 URL-safe ID */
  _slugId(str) {
    return str.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').substring(0, 50);
  },

  // ===== 语义检索 (GraphRAG) =====

  /**
   * 模糊搜索节点 — 支持部分匹配、包含匹配
   * @param {string} query - 搜索关键词
   * @param {string[]} labels - 限定节点类型
   * @param {number} limit - 最大返回数
   */
  fuzzySearch(query, labels = null, limit = 50) {
    if (!this._data) this.load();
    const q = (query || '').trim().toLowerCase();
    if (!q) return [];

    const results = [];
    for (const node of this._data.nodes) {
      if (labels && !labels.includes(node.label)) continue;
      const name = (node.properties.name || '').toLowerCase();
      const nameMatch = name.includes(q) || q.includes(name);

      // 检查其他属性
      let propMatch = false;
      if (!nameMatch) {
        for (const [key, val] of Object.entries(node.properties)) {
          if (key === 'id' || key === 'name') continue;
          if (val && String(val).toLowerCase().includes(q)) {
            propMatch = true;
            break;
          }
        }
      }

      if (nameMatch || propMatch) {
        let score = 0;
        if (name === q) score = 100;
        else if (name.startsWith(q)) score = 80;
        else if (name.includes(q)) score = 60;
        else if (q.includes(name) && name.length > 1) score = 50;
        else score = 30;

        results.push({ node, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit).map(r => r.node);
  },

  /**
   * 本地实体提取 — 基于图谱实际数据，通过字符串匹配从自然语言查询中提取实体
   * 不依赖任何 API 调用，即时返回结果
   * @param {string} query - 用户查询
   */
  extractEntitiesLocal(query) {
    if (!this._data) this.load();
    const q = (query || '').trim();
    if (!q) return { architects: [], regions: [], industries: [], customers: [], intent: q, entityTypes: [] };

    const result = { architects: [], regions: [], industries: [], customers: [], intent: q, entityTypes: [] };
    const qLower = q.toLowerCase();

    // 提取用户查询的实体类型意图（如"华东架构师" → 只查架构师）
    const typeKeywords = [
      { type: 'Architect', keywords: ['架构师', '架构', '负责人', '谁负责', '哪个人', '哪些人'] },
      { type: 'Customer', keywords: ['客户', '企业', '公司', '谁的客户', '哪些客户'] },
      { type: 'Industry', keywords: ['行业', '哪些行业', '什么行业'] },
      { type: 'Region', keywords: ['区域', '地区', '哪些区域'] },
    ];
    typeKeywords.forEach(tk => {
      if (tk.keywords.some(kw => q.includes(kw))) {
        result.entityTypes.push(tk.type);
      }
    });

    // 提取区域：检查图谱中所有区域名称是否出现在查询中
    const regions = this.getNodesByLabel('Region');
    regions.forEach(r => {
      const name = r.properties.name || '';
      if (name && name.length >= 2 && q.includes(name)) {
        result.regions.push(name);
      }
    });

    // 提取架构师：检查图谱中所有架构师名称
    const architects = this.getNodesByLabel('Architect');
    architects.forEach(a => {
      const name = a.properties.name || '';
      if (name && name.length >= 2 && q.includes(name)) {
        result.architects.push(name);
      }
    });

    // 提取行业：检查图谱中所有行业名称（优先一级行业）
    const industries = this.getNodesByLabel('Industry');
    const matchedIndustries = new Set();
    industries.forEach(ind => {
      const name = ind.properties.name || '';
      if (name && name.length >= 2 && q.includes(name)) {
        matchedIndustries.add(name);
      }
    });
    result.industries = [...matchedIndustries];

    // 提取客户：检查图谱中客户名称（支持模糊匹配）
    const customers = this.getNodesByLabel('Customer');
    customers.forEach(c => {
      const name = c.properties.name || '';
      // 精确包含匹配
      if (name && name.length >= 3 && q.includes(name)) {
        result.customers.push(name);
      }
      // 模糊匹配：查询中包含客户名的一部分（至少3个字）
      else if (name && name.length >= 4) {
        // 取客户名的前几个字进行匹配
        for (let len = Math.min(name.length, 6); len >= 3; len--) {
          const sub = name.substring(0, len);
          if (q.includes(sub) && !result.customers.includes(name)) {
            result.customers.push(name);
            break;
          }
        }
      }
    });

    // 如果没有匹配到任何实体，尝试关键词推断
    if (result.regions.length === 0) {
      // 常见区域别名
      const regionAliases = { '华东': '华东', '华北': '华北', '华南': '华南', '北京': '华北', '上海': '华东', '深圳': '华南', '广州': '华南' };
      for (const [alias, region] of Object.entries(regionAliases)) {
        if (q.includes(alias)) {
          result.regions.push(region);
          break;
        }
      }
    }

    // 如果查询中包含"全部""所有"等关键词，清除类型过滤
    if (q.includes('全部') || q.includes('所有') || q.includes('概览') || q.includes('总体')) {
      result.entityTypes = [];
    }

    return result;
  },

  /**
   * 语义检索 — 根据提取的实体查询图谱子图
   * @param {Object} entities - { architects, regions, industries, customers, entityTypes, intent }
   */
  semanticQuery(entities) {
    if (!this._data) this.load();
    const { architects = [], regions = [], industries = [], customers = [], intent = '', entityTypes = [] } = entities;

    const resultNodeIds = new Set();
    const resultEdges = new Set();
    const edgeKey = (e) => `${e.type}|${e.source}|${e.target}`;

    const collectNeighbors = (nodeId, depth = 1) => {
      if (depth <= 0) return;
      const edges = this.getEdgesForNode(nodeId);
      edges.forEach(e => {
        resultEdges.add(edgeKey(e));
        const otherId = e.source === nodeId ? e.target : e.source;
        if (!resultNodeIds.has(otherId)) {
          resultNodeIds.add(otherId);
          collectNeighbors(otherId, depth - 1);
        }
      });
    };

    // 架构师匹配
    architects.forEach(name => {
      const matches = this.fuzzySearch(name, ['Architect'], 5);
      matches.forEach(n => {
        resultNodeIds.add(n.id);
        collectNeighbors(n.id, 1);
      });
    });

    // 区域匹配 — 只收集 BELONGS_TO 边的邻居（架构师），避免拉入客户等不相关节点
    regions.forEach(name => {
      const matches = this.fuzzySearch(name, ['Region'], 3);
      matches.forEach(n => {
        resultNodeIds.add(n.id);
        // 如果用户指定了实体类型（如"华东架构师"），只收集该类型的邻居
        if (entityTypes.length > 0) {
          entityTypes.forEach(targetType => {
            const neighbors = this.getConnectedNodes(n.id);
            neighbors.forEach(nn => {
              if (nn.label === targetType) {
                resultNodeIds.add(nn.id);
                // 收集架构师到行业的边
                if (targetType === 'Architect') {
                  this.getEdgesForNode(nn.id).forEach(e => {
                    if (e.type === 'COVERS') {
                      resultEdges.add(edgeKey(e));
                      const otherId = e.source === nn.id ? e.target : e.source;
                      if (!resultNodeIds.has(otherId)) resultNodeIds.add(otherId);
                    }
                  });
                }
              }
            });
          });
        } else {
          // 没有指定类型，收集所有邻居
          collectNeighbors(n.id, 1);
        }
      });
    });

    // 行业匹配
    industries.forEach(name => {
      const matches = this.fuzzySearch(name, ['Industry'], 5);
      matches.forEach(n => {
        resultNodeIds.add(n.id);
        collectNeighbors(n.id, 1);
      });
    });

    // 客户匹配
    customers.forEach(name => {
      const matches = this.fuzzySearch(name, ['Customer'], 10);
      matches.forEach(n => {
        resultNodeIds.add(n.id);
        collectNeighbors(n.id, 1);
      });
    });

    // 如果没有匹配到任何实体，返回空
    if (resultNodeIds.size === 0) {
      return { nodes: [], edges: [], summary: '未找到匹配的图谱数据' };
    }

    const nodes = [...resultNodeIds].map(id => this.getNode(id)).filter(Boolean);
    const edges = [...resultEdges].map(key => {
      const [type, source, target] = key.split('|');
      return this._data.edges.find(e => e.type === type && e.source === source && e.target === target);
    }).filter(Boolean);

    return { nodes, edges, summary: `找到 ${nodes.length} 个节点, ${edges.length} 条关系` };
  },

  /**
   * 生成数据驱动的典型问题（5-6 条）
   * 基于图谱中的实际数据（架构师、区域、客户、行业）自动生成
   */
  generateSuggestedQuestions() {
    if (!this._data) this.load();
    const questions = [];

    // 获取实际数据
    const regions = this.getNodesByLabel('Region');
    const architects = this.getNodesByLabel('Architect');
    const customers = this.getNodesByLabel('Customer');
    const industries = this.getNodesByLabel('Industry').filter(i => i.properties.level === 'L1' || !i.properties.level);

    // Q1: 某区域有哪些架构师（取第一个有架构师的区域）
    for (const r of regions) {
      const archsInRegion = this.getConnectedNodes(r.id, ['BELONGS_TO']).filter(n => n.label === 'Architect');
      if (archsInRegion.length > 0) {
        questions.push({
          label: `${r.properties.name}架构师`,
          query: `${r.properties.name}有哪些架构师？`,
        });
        break;
      }
    }

    // Q2: 某架构师负责哪些行业（取第一个有行业的架构师）
    for (const a of architects) {
      const inds = this.getConnectedNodes(a.id, ['COVERS']).filter(n => n.label === 'Industry');
      if (inds.length > 0) {
        questions.push({
          label: `${a.properties.name}的行业`,
          query: `${a.properties.name}负责哪些行业？`,
        });
        break;
      }
    }

    // Q3: 某架构师有哪些客户（取第一个有客户的架构师）
    for (const a of architects) {
      const custs = this.getConnectedNodes(a.id, ['COVERS']).filter(n => n.label === 'Customer');
      if (custs.length > 0) {
        questions.push({
          label: `${a.properties.name}的客户`,
          query: `${a.properties.name}有哪些客户？`,
        });
        break;
      }
    }

    // Q4: 某客户是谁的（取第一个客户）
    if (customers.length > 0) {
      const c = customers[0];
      questions.push({
        label: c.properties.name,
        query: `${c.properties.name}是谁的客户？`,
      });
    }

    // Q5: 某行业有哪些架构师（取第一个行业）
    if (industries.length > 0) {
      const ind = industries[0];
      const archsInInd = this.getConnectedNodes(ind.id).filter(n => n.label === 'Architect');
      if (archsInInd.length > 0) {
        questions.push({
          label: `${ind.properties.name}行业`,
          query: `${ind.properties.name}行业有哪些架构师？`,
        });
      }
    }

    // Q6: 某区域客户概览（取第二个区域或第一个区域）
    if (regions.length > 0) {
      const r = regions.length > 1 ? regions[1] : regions[0];
      questions.push({
        label: `${r.properties.name}概览`,
        query: `${r.properties.name}有哪些客户？`,
      });
    }

    return questions.slice(0, 6);
  },

  /**
   * 导出子图为可读文本（用于 LLM 上下文）
   */
  subgraphToText(nodes, edges) {
    if (!nodes || nodes.length === 0) return '无数据';

    const schema = window.RelationshipSchema;
    const lines = [];

    // 按类型分组
    const byType = {};
    nodes.forEach(n => {
      if (!byType[n.label]) byType[n.label] = [];
      byType[n.label].push(n);
    });

    // 输出节点
    Object.entries(byType).forEach(([label, items]) => {
      const info = schema?.nodeTypes?.[label];
      const typeName = info?.label || label;
      lines.push(`\n## ${info?.icon || ''} ${typeName} (${items.length}个)`);
      items.slice(0, 50).forEach(n => {
        const p = n.properties;
        let desc = `  - ${p.name || n.id}`;
        if (p.role) desc += ` [角色: ${p.role}]`;
        if (p.tier) desc += ` [分层: ${p.tier}]`;
        if (p.industryL1) desc += ` [行业: ${p.industryL1}]`;
        if (p.region) desc += ` [区域: ${p.region}]`;
        if (p.followupStatus) desc += ` [状态: ${p.followupStatus}]`;
        if (p.signingStatus) desc += ` [签约: ${p.signingStatus}]`;
        if (p.product) desc += ` [产品: ${p.product}]`;
        if (p.status) desc += ` [状态: ${p.status}]`;
        lines.push(desc);
      });
      if (items.length > 50) lines.push(`  ... 还有 ${items.length - 50} 个`);
    });

    // 输出关键关系
    if (edges && edges.length > 0) {
      lines.push('\n## 关键关系');
      const edgeMap = {};
      edges.forEach(e => {
        if (!edgeMap[e.type]) edgeMap[e.type] = [];
        edgeMap[e.type].push(e);
      });
      Object.entries(edgeMap).forEach(([type, items]) => {
        const eInfo = schema?.edgeTypes?.[type];
        const typeName = eInfo?.label || type;
        lines.push(`  ${typeName}:`);
        items.slice(0, 30).forEach(e => {
          const src = this.getNode(e.source)?.properties?.name || e.source;
          const tgt = this.getNode(e.target)?.properties?.name || e.target;
          lines.push(`    - ${src} → ${tgt}`);
        });
        if (items.length > 30) lines.push(`    ... 还有 ${items.length - 30} 条`);
      });
    }

    return lines.join('\n');
  }
};

window.RelationshipStore = RelationshipStore;
console.log('[RelationshipStore] Graph data manager loaded (v2 - full columns)');
