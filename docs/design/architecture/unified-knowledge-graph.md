# Memora 统一知识图谱设计 v2

> ADP 构建图谱 + sql.js 持久化 + 知识体检 + Graph RAG 问答
> 不改变原有功能，在原有知识萃取视图上新增标签

---

## 一、核心架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Memora 现有数据 (JSON)                        │
│  memories.json · atoms.json · clusters.json · entity-graph.json     │
│  knowledge-items.json · recommendations.json · profile.json         │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ 打包摘要
                               ▼
                    ┌─────────────────────┐
                    │   ADP 智能体 (3 重任务) │
                    │  ① 图谱构建          │
                    │  ② 知识体检          │
                    │  ③ 冲突检测          │
                    └──────────┬──────────┘
                               │ 结构化 JSON
                               ▼
                    ┌─────────────────────┐
                    │   sql.js (SQLite)    │
                    │   knowledge-graph.db │
                    │  - nodes 表          │
                    │  - edges 表          │
                    │  - health_reports 表 │
                    │  - FTS5 全文检索      │
                    └──────────┬──────────┘
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
            ┌──────────────┐    ┌──────────────────┐
            │ 图谱可视化    │    │ Graph RAG 问答    │
            │ Canvas 渲染   │    │ 小助手结合图谱     │
            └──────────────┘    └──────────────────┘
```

### 设计原则

1. **AI 做重活**：图谱构建、关系识别、知识体检、冲突检测全部交给 ADP
2. **sql.js 持久化**：图数据存 SQLite，支持图遍历查询，JSON 不再是瓶颈
3. **原有功能零改动**：现有 JSON 存储不变，SQLite 是新增的并行层
4. **知识可回溯**：每次 ADP 构建都保存版本快照，可对比知识变化

---

## 二、存储方案：为什么选 sql.js

### 2.1 JSON 瓶颈分析

| 知识规模 | atoms.json 大小 | 加载耗时 | 全量写入耗时 | 问题 |
|---------|----------------|---------|------------|------|
| 当前 ~300 原子 | 34KB | <50ms | <10ms | 无 |
| 3,000 原子 | ~340KB | ~200ms | ~50ms | 轻微 |
| 10,000 原子 | ~1.5MB | ~800ms | ~200ms | 写放大 |
| 50,000 原子 | ~7.5MB | ~4s | ~1s | 严重瓶颈 |

**瓶颈根源**：
- 全量读：每次启动 `JSON.parse()` 整个文件
- 全量写：每次修改重写整个文件，写放大严重
- 无索引：所有查询都是 `O(n)` 线性扫描
- 无事务：写入中断可能损坏整个文件
- 图遍历无能：无法做 `WITH RECURSIVE` 多跳查询

### 2.2 方案对比

| 方案 | 包体积 | 原生编译 | 图遍历 | FTS | 事务 | Electron 打包 |
|------|--------|---------|--------|-----|------|--------------|
| **sql.js** (推荐) | +3MB WASM | 无需 | ✅ 递归 CTE | ✅ FTS5 | ✅ | 零配置 |
| better-sqlite3 | +5MB/.node | 需要 electron-rebuild | ✅ | ✅ | ✅ | 需配置 |
| LevelGraph | +2MB LevelDB | 需要 rebuild | 原生三元组 | ❌ | ❌ | 需配置 |
| 纯 JSON | 0 | 无需 | ❌ | ❌ | ❌ | 无 |

**选 sql.js 的理由**：
1. **零原生依赖**：WASM 编译，不需要 `electron-rebuild`，electron-builder 直接打包
2. **SQLite 全功能**：递归 CTE（图遍历）、FTS5（全文检索）、事务、索引
3. **性能足够**：<100K 节点时与 better-sqlite3 差距 <20%，个人知识管理远不到这个量
4. **未来可升级**：如需极致性能，无缝切换到 better-sqlite3（API 几乎一致）

### 2.3 两层存储策略

```
现有 JSON 文件（不动）          新增 SQLite（并行层）
├── memories.json              ├── knowledge-graph.db
├── atoms.json                 │   ├── nodes 表（图节点）
├── clusters.json              │   ├── edges 表（图关系）
├── entity-graph.json          │   ├── health_reports 表（体检报告）
├── knowledge-items.json       │   └── nodes_fts（全文检索）
└── profile.json               └── graph-versions/（历史快照）
```

**关键**：SQLite 中的数据始终可以从 JSON 源数据重建。它不是唯一数据源，而是索引+缓存层。

- 现有 JSON → 继续作为知识原子、记忆等的源数据（不动）
- SQLite → 存储图谱结构、体检报告、图索引（新增）
- 两者通过 `source_id` 关联

---

## 三、SQLite Schema 设计

### 3.1 节点表

```sql
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,              -- domain_前端开发 / cluster_xxx / atom_xxx
  type TEXT NOT NULL,               -- domain / cluster / atom / memory / question / person / gap
  label TEXT NOT NULL,              -- 显示名称
  domain TEXT,                      -- 所属领域
  density TEXT DEFAULT 'moderate',  -- rich / moderate / sparse / gap
  health TEXT DEFAULT 'healthy',    -- healthy / outdated / conflicting / duplicate / orphaned / incomplete
  health_detail TEXT,               -- JSON: 体检详情
  summary TEXT,                     -- AI 生成的摘要
  stats TEXT,                       -- JSON: { atomCount, clusterCount, ... }
  source_ids TEXT,                  -- JSON: 关联的源数据 ID 列表
  weight INTEGER DEFAULT 5,         -- 节点权重（影响可视化大小）
  extra TEXT,                       -- JSON: 扩展属性（如 suggestion, priority）
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_nodes_type ON nodes(type);
CREATE INDEX idx_nodes_domain ON nodes(domain);
CREATE INDEX idx_nodes_health ON nodes(health);
CREATE INDEX idx_nodes_density ON nodes(density);
```

### 3.2 边表

```sql
CREATE TABLE edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type TEXT NOT NULL,               -- belongs_to / related / similar / depends_on / conflicts_with / mentions
  strength REAL DEFAULT 0.5,        -- 0-1 关系强度
  label TEXT,                       -- 关系描述（如"属于"、"技术栈关联"）
  extra TEXT,                       -- JSON: 扩展属性
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE INDEX idx_edges_source ON edges(source_id);
CREATE INDEX idx_edges_target ON edges(target_id);
CREATE INDEX idx_edges_type ON edges(type);
```

### 3.3 体检报告表

```sql
CREATE TABLE health_reports (
  id TEXT PRIMARY KEY,
  report_type TEXT NOT NULL,        -- full / incremental
  built_at TEXT NOT NULL,
  node_count INTEGER,
  edge_count INTEGER,
  summary TEXT,                     -- JSON: 总体概况
  gaps TEXT,                        -- JSON: 缺口列表
  outdated TEXT,                    -- JSON: 过时知识列表
  conflicts TEXT,                   -- JSON: 冲突知识列表
  duplicates TEXT,                  -- JSON: 重复知识列表
  orphans TEXT,                     -- JSON: 孤立知识列表
  suggestions TEXT                  -- JSON: 改进建议
);

CREATE INDEX idx_health_reports_built ON health_reports(built_at);
```

### 3.4 全文检索

```sql
CREATE VIRTUAL TABLE nodes_fts USING fts5(
  id, label, summary, domain, properties,
  content='nodes',
  content_rowid='rowid'
);

-- 触发器：自动同步
CREATE TRIGGER nodes_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO nodes_fts(rowid, id, label, summary, domain, properties)
  VALUES (new.rowid, new.id, new.label, new.summary, new.domain, new.extra);
END;
CREATE TRIGGER nodes_ad AFTER DELETE ON nodes BEGIN
  INSERT INTO nodes_fts(nodes_fts, rowid, id, label, summary, domain, properties)
  VALUES ('delete', old.rowid, old.id, old.label, old.summary, old.domain, old.extra);
END;
```

### 3.5 图遍历查询示例（Graph RAG 用）

```sql
-- 1 跳邻居：查找某节点直接关联的所有节点
SELECT n.* FROM nodes n
JOIN edges e ON (e.target_id = n.id OR e.source_id = n.id)
WHERE e.source_id = ? OR e.target_id = ?
AND n.id != ?;

-- 2 跳遍历：查找某领域的知识网络
WITH RECURSIVE graph_traverse(id, depth) AS (
  VALUES (?, 0)
  UNION ALL
  SELECT
    CASE WHEN e.source_id = gt.id THEN e.target_id ELSE e.source_id END,
    gt.depth + 1
  FROM edges e
  JOIN graph_traverse gt ON (e.source_id = gt.id OR e.target_id = gt.id)
  WHERE gt.depth < 2
)
SELECT DISTINCT n.* FROM nodes n
JOIN graph_traverse gt ON n.id = gt.id
WHERE gt.depth > 0;

-- 全文搜索 + 图扩展：先搜关键词，再取关联节点
WITH matched AS (
  SELECT id FROM nodes_fts WHERE nodes_fts MATCH ? LIMIT 20
)
SELECT n.* FROM nodes n
WHERE n.id IN (SELECT id FROM matched)
UNION
SELECT n.* FROM nodes n
JOIN edges e ON (e.source_id IN (SELECT id FROM matched) AND e.target_id = n.id)
WHERE n.type IN ('atom', 'cluster', 'domain');
```

---

## 四、ADP Prompt 设计（三重任务）

构建图谱时，一次 ADP 调用同时完成三个任务，避免多次 API 调用。

### 4.1 综合构建 Prompt

```
你是一个知识图谱构建专家 + 知识体检医生。根据用户的知识数据，同时完成三个任务。

## 输入数据

{{summary_json}}

## 任务一：图谱构建

分析以上数据，识别知识体系中的关键节点和关系。

1. **节点类型**：
   - domain：知识领域（如"前端开发"、"项目管理"）
   - cluster：知识簇（atomCount ≥ 3 的）
   - person：高频人物（提及 ≥ 3 次）
   - question：尚未解答的问题
   - gap：知识缺口（被提及但无知识沉淀）

2. **边类型**：
   - belongs_to：包含/从属关系
   - related：语义关联
   - similar：相似/可比
   - depends_on：依赖关系
   - conflicts_with：矛盾/冲突关系

3. **密度评估**（每个节点）：
   - rich：知识充足有体系（原子 ≥ 10 且有簇）
   - moderate：有基础可深化（原子 3-9）
   - sparse：刚起步需补充（原子 1-2）
   - gap：空白区（提及 ≥ 3 次但原子 = 0）

## 任务二：知识体检

对每个节点进行健康评估：

1. **outdated（过时）**：知识超过 90 天未更新，且所属领域活跃度高 → 标记需复审
2. **conflicting（冲突）**：同一领域/簇内存在互相矛盾的知识原子 → 提取冲突内容
3. **duplicate（重复）**：语义高度相似的知识原子 → 建议合并
4. **orphaned（孤立）**：不属于任何簇且无关联实体的原子 → 建议归簇
5. **incomplete（不完整）**：知识簇只有 1-2 个原子 → 建议补充

## 任务三：冲突提炼

专门找出冲突知识对，生成人类可审核的冲突报告：
- 冲突的原子 ID 和内容摘要
- 冲突原因分析
- 推荐的解决方案（保留哪个/如何整合）

## 输出格式（严格 JSON）

```json
{
  "nodes": [
    {
      "id": "domain_前端开发",
      "type": "domain",
      "label": "前端开发",
      "domain": "前端开发",
      "weight": 8,
      "density": "rich",
      "health": "healthy",
      "health_detail": null,
      "summary": "知识体系完善，涵盖 React/Vue/架构设计",
      "stats": { "atomCount": 25, "clusterCount": 4, "outdatedCount": 2 },
      "source_ids": ["atom_xxx", "cluster_yyy"],
      "extra": null
    },
    {
      "id": "atom_xxx",
      "type": "atom",
      "label": "React Hooks 最佳实践",
      "domain": "前端开发",
      "weight": 4,
      "density": "moderate",
      "health": "outdated",
      "health_detail": {
        "reason": "该知识最后更新于 95 天前，React 19 已发布新 Hooks 规范",
        "last_updated": "2026-03-01",
        "suggestion": "复审并更新 Hooks 相关知识，关注 React 19 变化"
      },
      "summary": "涵盖 useState/useEf｜fect 常见模式",
      "stats": { "sourceClusterId": "cluster_react" },
      "source_ids": ["atom_xxx"],
      "extra": null
    },
    {
      "id": "gap_微服务网关",
      "type": "gap",
      "label": "微服务网关",
      "domain": "后端架构",
      "weight": 4,
      "density": "gap",
      "health": "incomplete",
      "health_detail": {
        "reason": "被提及 6 次但知识库中无相关记录",
        "mentionCount": 6,
        "suggestion": "搜索微服务网关最佳实践，记录架构选型经验"
      },
      "summary": "被提及6次但无知识记录",
      "stats": { "mentionCount": 6, "atomCount": 0 },
      "source_ids": [],
      "extra": { "suggestion": "搜索微服务API网关选型对比", "priority": "high" }
    }
  ],
  "edges": [
    { "source": "cluster_react", "target": "domain_前端开发", "type": "belongs_to", "strength": 0.8, "label": "属于" },
    { "source": "domain_前端开发", "target": "domain_后端架构", "type": "related", "strength": 0.4, "label": "技术栈关联" },
    { "source": "atom_hooks_old", "target": "atom_hooks_new", "type": "conflicts_with", "strength": 0.9, "label": "版本冲突" }
  ],
  "health_report": {
    "summary": {
      "totalNodes": 28,
      "healthyCount": 18,
      "outdatedCount": 4,
      "conflictingCount": 2,
      "duplicateCount": 3,
      "orphanedCount": 1,
      "gapCount": 3,
      "score": 72
    },
    "gaps": [
      {
        "nodeId": "gap_微服务网关",
        "label": "微服务网关",
        "severity": "high",
        "reason": "被提及6次但知识库中无相关记录",
        "suggestion": "搜索微服务网关最佳实践"
      }
    ],
    "outdated": [
      {
        "nodeId": "atom_xxx",
        "label": "React Hooks 最佳实践",
        "lastUpdated": "2026-03-01",
        "daysSince": 95,
        "reason": "React 19 已发布新 Hooks 规范",
        "action": "复审更新"
      }
    ],
    "conflicts": [
      {
        "id": "conflict_1",
        "atoms": [
          { "id": "atom_a", "content_summary": "微服务应使用 API 网关统一入口" },
          { "id": "atom_b", "content_summary": "微服务应使用 Service Mesh 侧车模式" }
        ],
        "reason": "两种架构模式有适用场景差异，当前知识未区分场景",
        "resolution_suggestion": "整合为：API 网关适合外部流量入口，Service Mesh 适合内部服务间通信。两者可共存。",
        "severity": "medium"
      }
    ],
    "duplicates": [
      {
        "atomIds": ["atom_c1", "atom_c2"],
        "label": "React 状态管理方案对比",
        "similarity": 0.92,
        "suggestion": "合并为一条完整知识原子"
      }
    ],
    "orphans": [
      {
        "atomId": "atom_orphan1",
        "label": "Docker Compose 网络配置",
        "reason": "不属于任何簇，无关联实体",
        "suggestion": "归入 DevOps 或容器化领域"
      }
    ]
  },
  "overview": {
    "totalNodes": 28,
    "totalEdges": 42,
    "densityDistribution": { "rich": 5, "moderate": 8, "sparse": 6, "gap": 3 },
    "healthDistribution": { "healthy": 18, "outdated": 4, "conflicting": 2, "duplicate": 3, "orphaned": 1 },
    "topDomains": ["前端开发", "产品规划", "项目管理"],
    "weakestAreas": ["微服务网关", "合规审计", "运营策略"],
    "knowledgeScore": 72,
    "lastWeekChange": "+12 atoms, -2 duplicates, 1 conflict resolved"
  }
}
```

只输出 JSON，不要输出其他内容。
```

### 4.2 缺口深度分析 Prompt（点击缺口时调用）

```
你是知识管理顾问。用户的知识库在以下领域存在缺口：

缺口信息：{{gap_detail}}

用户画像：
- 角色：{{user_role}}
- 行业：{{industries}}
- 活跃项目：{{active_projects}}

请给出具体的补全建议：

```json
{
  "gap": "微服务网关",
  "analysis": "你在项目讨论中多次提到微服务网关，但知识库中没有架构选型、技术方案等沉淀",
  "suggestions": [
    { "action": "search", "label": "搜索微服务网关最佳实践", "query": "微服务API网关选型对比 Kong vs Nginx vs Spring Cloud Gateway" },
    { "action": "record", "label": "记录你的网关架构经验", "template": "## 微服务网关架构\n\n### 选型考虑\n\n### 方案对比\n\n### 最终选择\n\n### 遇到的问题" },
    { "action": "ask_adp", "label": "请教AI：微服务网关设计要点", "query": "作为一个有微服务经验的产品经理，我需要了解API网关的核心设计要点和选型建议" }
  ],
  "relatedEntities": ["K8s", "Nginx", "服务治理"],
  "priority": "high"
}
```

只输出 JSON，不要输出其他内容。
```

### 4.3 冲突仲裁 Prompt（用户审核冲突时调用）

```
你是知识管理专家。用户的知识库中存在以下冲突：

冲突描述：{{conflict_detail}}

请分析：
1. 冲突的根本原因（技术演进？场景差异？认知偏差？）
2. 两种观点各自的适用场景
3. 推荐的整合方案

```json
{
  "conflict_id": "conflict_1",
  "root_cause": "技术架构的演进：API 网关是传统微服务入口模式，Service Mesh 是云原生演进方向",
  "viewpoints": [
    { "content": "API 网关统一入口", "applicable": "外部流量管理、限流熔断、协议转换" },
    { "content": "Service Mesh 侧车模式", "applicable": "服务间通信、可观测性、流量治理" }
  ],
  "resolution": {
    "type": "merge",
    "merged_content": "微服务流量管理分两层：API 网关处理外部流量（限流、认证、协议转换），Service Mesh 处理内部服务间流量（负载均衡、熔断、链路追踪）。两者互补共存。",
    "source_atom_ids": ["atom_a", "atom_b"]
  }
}
```

只输出 JSON，不要输出其他内容。
```

### 4.4 ADP 调用封装

```javascript
// graphDb.js 中
async function callADPForGraph(prompt) {
  const result = await auditedDeepSeekCall({
    module: 'graph_build',
    messages: [{ role: 'user', content: prompt }],
    model: 'deepseek-v4-pro',     // 图谱构建需要更强推理
    response_format: { type: 'json_object' },
    temperature: 0.3               // 低温度保证输出稳定
  });

  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('ADP 返回格式异常');
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('[Graph] Failed to parse ADP response:', e);
    return {
      nodes: [], edges: [],
      health_report: { summary: {}, gaps: [], outdated: [], conflicts: [], duplicates: [], orphans: [] },
      overview: { totalNodes: 0, totalEdges: 0, densityDistribution: {}, healthDistribution: {}, topDomains: [], weakestAreas: [], knowledgeScore: 0 }
    };
  }
}
```

---

## 五、GraphDB 模块设计

### 5.1 模块结构

```
src/scripts/graph/
├── graphDb.js            # sql.js 数据库封装（初始化/CRUD/查询）
├── graphView.js          # 图谱视图控制器（Tab 切换、筛选、搜索）
├── forceLayout.js        # Canvas 力导向布局 + 渲染
├── graphPanel.js         # 节点详情面板 + 缺口操作面板 + 冲突审核面板
└── graphRAG.js           # Graph RAG 查询构建器

src/styles/graph.css      # 图谱样式

prompts/
├── graph_build.md        # 图谱构建 + 知识体检 Prompt
├── graph_gap.md          # 缺口分析 Prompt
└── graph_conflict.md     # 冲突仲裁 Prompt
```

### 5.2 GraphDB 核心类

```javascript
// graphDb.js
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

class GraphDB {
  constructor(userDataPath) {
    this.dbPath = path.join(userDataPath, 'knowledge', 'knowledge-graph.db');
    this.db = null;
  }

  async init() {
    const SQL = await initSqlJs();
    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
    } else {
      this.db = new SQL.Database();
    }
    this._createTables();
    return this;
  }

  _createTables() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL,
        domain TEXT, density TEXT DEFAULT 'moderate',
        health TEXT DEFAULT 'healthy', health_detail TEXT,
        summary TEXT, stats TEXT, source_ids TEXT,
        weight INTEGER DEFAULT 5, extra TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      -- ... (edges, health_reports, FTS5 等同上文 Schema)
    `);
    this.save();
  }

  save() {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  // ========== 节点操作 ==========
  upsertNodes(nodes) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO nodes
      (id, type, label, domain, density, health, health_detail, summary, stats, source_ids, weight, extra, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const n of nodes) {
      stmt.run([
        n.id, n.type, n.label, n.domain, n.density, n.health,
        JSON.stringify(n.health_detail || null),
        n.summary,
        JSON.stringify(n.stats || {}),
        JSON.stringify(n.source_ids || []),
        n.weight || 5,
        JSON.stringify(n.extra || null),
        n.created_at || new Date().toISOString(),
        n.updated_at || new Date().toISOString()
      ]);
    }
    stmt.free();
    this.save();
  }

  getNodes(filter = {}) {
    let sql = 'SELECT * FROM nodes WHERE 1=1';
    const params = [];
    if (filter.type) { sql += ' AND type = ?'; params.push(filter.type); }
    if (filter.domain) { sql += ' AND domain = ?'; params.push(filter.domain); }
    if (filter.density) { sql += ' AND density = ?'; params.push(filter.density); }
    if (filter.health) { sql += ' AND health = ?'; params.push(filter.health); }
    sql += ' ORDER BY weight DESC';
    const results = this.db.exec(sql, params);
    return this._rowsToObjects(results);
  }

  searchNodes(query, limit = 20) {
    const results = this.db.exec(
      'SELECT * FROM nodes WHERE id IN (SELECT id FROM nodes_fts WHERE nodes_fts MATCH ?) LIMIT ?',
      [query, limit]
    );
    return this._rowsToObjects(results);
  }

  // ========== 边操作 ==========
  upsertEdges(edges) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO edges (id, source_id, target_id, type, strength, label, extra, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const e of edges) {
      stmt.run([
        e.id || `${e.source_id}_${e.type}_${e.target_id}`,
        e.source_id, e.target_id, e.type,
        e.strength || 0.5, e.label,
        JSON.stringify(e.extra || null),
        new Date().toISOString()
      ]);
    }
    stmt.free();
    this.save();
  }

  // ========== 图遍历 ==========
  getNeighbors(nodeId, depth = 1) {
    const results = this.db.exec(`
      WITH RECURSIVE gt(id, depth) AS (
        VALUES (?, 0)
        UNION ALL
        SELECT
          CASE WHEN e.source_id = gt.id THEN e.target_id ELSE e.source_id END,
          gt.depth + 1
        FROM edges e
        JOIN gt ON (e.source_id = gt.id OR e.target_id = gt.id)
        WHERE gt.depth < ?
      )
      SELECT DISTINCT n.* FROM nodes n
      JOIN gt ON n.id = gt.id
      WHERE gt.depth > 0
    `, [nodeId, depth]);
    return this._rowsToObjects(result);
  }

  getSubgraph(domainNodeId) {
    // 获取某领域节点的完整子图
    const nodesResult = this.db.exec(`
      WITH RECURSIVE subgraph(id) AS (
        VALUES (?)
        UNION ALL
        SELECT CASE WHEN e.source_id = subgraph.id THEN e.target_id ELSE e.source_id END
        FROM edges e
        JOIN subgraph ON (e.source_id = subgraph.id OR e.target_id = subgraph.id)
      )
      SELECT DISTINCT n.* FROM nodes n WHERE n.id IN subgraph
    `, [domainNodeId]);
    const edgesResult = this.db.exec(`
      SELECT e.* FROM edges e
      WHERE e.source_id IN (SELECT id FROM nodes WHERE domain = (SELECT domain FROM nodes WHERE id = ?))
         OR e.target_id IN (SELECT id FROM nodes WHERE domain = (SELECT domain FROM nodes WHERE id = ?))
    `, [domainNodeId, domainNodeId]);
    return { nodes: this._rowsToObjects(nodesResult), edges: this._rowsToObjects(edgesResult) };
  }

  // ========== 体检报告 ==========
  saveHealthReport(report) {
    this.db.run(`
      INSERT OR REPLACE INTO health_reports
      (id, report_type, built_at, node_count, edge_count, summary, gaps, outdated, conflicts, duplicates, orphans, suggestions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      `report_${Date.now()}`, 'full', report.built_at,
      report.node_count, report.edge_count,
      JSON.stringify(report.summary),
      JSON.stringify(report.gaps),
      JSON.stringify(report.outdated),
      JSON.stringify(report.conflicts),
      JSON.stringify(report.duplicates),
      JSON.stringify(report.orphans),
      JSON.stringify(report.suggestions)
    ]);
    this.save();
  }

  getLatestHealthReport() {
    const results = this.db.exec(
      'SELECT * FROM health_reports ORDER BY built_at DESC LIMIT 1'
    );
    return this._rowsToObjects(results)[0] || null;
  }

  // ========== 统计 ==========
  getStats() {
    const nodeCount = this.db.exec('SELECT COUNT(*) as count FROM nodes')[0]?.values[0]?.[0] || 0;
    const edgeCount = this.db.exec('SELECT COUNT(*) as count FROM edges')[0]?.values[0]?.[0] || 0;
    const healthDist = this._rowsToObjects(
      this.db.exec('SELECT health, COUNT(*) as count FROM nodes GROUP BY health')
    );
    const densityDist = this._rowsToObjects(
      this.db.exec('SELECT density, COUNT(*) as count FROM nodes GROUP BY density')
    );
    return { nodeCount, edgeCount, healthDist, densityDist };
  }

  // ========== 工具 ==========
  _rowsToObjects(results) {
    if (!results || results.length === 0) return [];
    const columns = results[0].columns;
    return results[0].values.map(row => {
      const obj = {};
      columns.forEach((col, i) => {
        let val = row[i];
        // 自动解析 JSON 字段
        if (['stats', 'source_ids', 'extra', 'health_detail', 'summary', 'gaps', 'outdated', 'conflicts', 'duplicates', 'orphans', 'suggestions'].includes(col)) {
          try { val = JSON.parse(val); } catch (e) {}
        }
        obj[col] = val;
      });
      return obj;
    });
  }

  destroy() {
    this.db.close();
  }
}

module.exports = { GraphDB };
```

---

## 六、Graph RAG 设计

### 6.1 架构流程

```
用户提问："微服务网关应该怎么选型？"
         ↓
Step 1: 实体提取（ADP 轻量调用）
  → 提取关键实体：["微服务", "API网关", "选型"]
         ↓
Step 2: 图谱检索（SQLite 本地查询）
  → FTS5 全文匹配 + 图遍历扩展
  → 匹配节点：gap_微服务网关, domain_后端架构, atom_gateway_1, atom_gateway_2
  → 1-hop 扩展：atom_kong, atom_nginx, cluster_api_design
         ↓
Step 3: 上下文组装
  → 匹配节点的 summary + stats + 关联知识原子的完整内容
  → 图谱结构摘要（哪些领域覆盖、哪些缺失）
  → 体检信息（是否有冲突/过时知识）
         ↓
Step 4: 增强 Prompt + ADP 回答
  → 将图谱上下文注入 system prompt
  → ADP 基于具体知识而非泛泛回答
  → 回答中标注知识来源（来自哪个图谱节点）
```

### 6.2 Graph RAG Prompt 模板

```
你是 Memora 的知识助手。请基于用户的知识图谱来回答问题。

## 用户的知识图谱上下文

### 匹配的图谱节点
{{matched_nodes_json}}

### 关联的知识原子
{{related_atoms_content}}

### 知识体检信息
{{health_context}}

### 图谱结构摘要
{{graph_structure_summary}}

## 回答要求

1. 优先引用用户已有的知识（标注来源节点 ID）
2. 如果存在冲突知识，指出冲突并说明各观点
3. 如果用户知识库存在缺口，提示可以补充
4. 如果有过时知识，提醒需要更新
5. 回答末尾附上"知识图谱建议"：基于本次对话可以新增哪些知识节点

## 用户问题

{{user_question}}
```

### 6.3 代码实现

```javascript
// graphRAG.js
class GraphRAG {
  constructor(graphDb, knowledgeStore, memoryStore) {
    this.graphDb = graphDb;
    this.knowledgeStore = knowledgeStore;
    this.memoryStore = memoryStore;
  }

  /**
   * 构建图谱增强的上下文
   * @param {string} question - 用户问题
   * @returns {Object} { context, matchedNodes, healthContext }
   */
  buildContext(question) {
    // Step 1: 提取关键词（简单分词，不用 AI）
    const keywords = this._extractKeywords(question);

    // Step 2: FTS5 检索匹配节点
    let matchedNodes = [];
    for (const kw of keywords) {
      try {
        const results = this.graphDb.searchNodes(kw, 10);
        matchedNodes.push(...results);
      } catch (e) {
        // FTS5 查询语法可能出错，降级为 LIKE
        const likeResults = this.graphDb.getNodes({ domain: kw });
        matchedNodes.push(...likeResults);
      }
    }
    // 去重
    matchedNodes = this._deduplicate(matchedNodes);

    // Step 3: 图遍历扩展（1-hop）
    const expandedIds = new Set(matchedNodes.map(n => n.id));
    for (const node of matchedNodes.slice(0, 5)) { // 只扩展 top5，避免过大
      const neighbors = this.graphDb.getNeighbors(node.id, 1);
      neighbors.forEach(n => expandedIds.add(n.id));
    }

    // Step 4: 获取关联知识原子的完整内容
    const relatedAtoms = [];
    for (const node of matchedNodes) {
      if (node.source_ids) {
        for (const sid of node.source_ids) {
          const atom = this.knowledgeStore.getAtomById(sid);
          if (atom) relatedAtoms.push(atom);
        }
      }
    }

    // Step 5: 获取体检上下文
    const healthReport = this.graphDb.getLatestHealthReport();
    const healthContext = this._buildHealthContext(matchedNodes, healthReport);

    // Step 6: 构建图谱结构摘要
    const stats = this.graphDb.getStats();

    return {
      matchedNodes,
      relatedAtoms: relatedAtoms.slice(0, 20), // 限制上下文长度
      healthContext,
      graphStats: stats
    };
  }

  _extractKeywords(question) {
    // 简单中英文关键词提取
    const stopWords = new Set(['的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '这', '中', '大', '为', '上', '个', '到', '说', '们', '么', '那', '要', '会', '对', 'how', 'what', 'why', 'should', 'can', 'the', 'is', 'are', 'do', 'does']);
    const words = question.match(/[\u4e00-\u9fa5]{2,}|[a-zA-Z]{2,}/g) || [];
    return words.filter(w => !stopWords.has(w.toLowerCase()));
  }

  _deduplicate(nodes) {
    const seen = new Set();
    return nodes.filter(n => {
      if (seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });
  }

  _buildHealthContext(nodes, report) {
    if (!report) return '暂无体检报告';
    const nodeIds = new Set(nodes.map(n => n.id));
    const relevant = {
      conflicts: (report.conflicts || []).filter(c =>
        c.atoms?.some(a => nodeIds.has(a.id))
      ),
      outdated: (report.outdated || []).filter(o => nodeIds.has(o.nodeId)),
      gaps: (report.gaps || []).filter(g => nodeIds.has(g.nodeId))
    };
    return relevant;
  }
}

module.exports = { GraphRAG };
```

### 6.4 集成到小助手

在现有 ADP 对话流程中，增加 Graph RAG 增强：

```javascript
// main.js 中现有 assistant:chat handler 修改
ipcMain.handle('assistant:chat', async (event, { message, conversationId }) => {
  // ... 现有逻辑 ...

  // 新增：Graph RAG 增强
  let graphContext = null;
  if (graphDb) {
    const rag = new GraphRAG(graphDb, knowledgeStore, memoryStore);
    graphContext = rag.buildContext(message);
  }

  // 组装 system prompt
  let systemPrompt = getBaseSystemPrompt();
  if (graphContext && graphContext.matchedNodes.length > 0) {
    systemPrompt += '\n\n## 用户的知识图谱上下文\n';
    systemPrompt += `匹配节点: ${graphContext.matchedNodes.map(n => `${n.label}(${n.type}/${n.density})`).join(', ')}\n`;
    systemPrompt += `关联知识: ${graphContext.relatedAtoms.map(a => a.content.substring(0, 100)).join('; ')}\n`;
    if (graphContext.healthContext.conflicts?.length > 0) {
      systemPrompt += `⚠️ 存在冲突知识: ${graphContext.healthContext.conflicts.map(c => c.reason).join('; ')}\n`;
    }
  }

  // ... 继续现有 ADP 调用 ...
});
```

---

## 七、前端渲染

### 7.1 视图入口：知识萃取新增标签

在现有知识萃取视图的 Tab 栏新增"全局图谱"和"知识体检"：

```
现有：图谱 | 文章 | 问题 | 搜索
搜索提到第一位
改为： 搜索｜图谱 | 全局图谱 | 知识体检 | 文章 | 问题 
         ↑现有    ↑新增      ↑新增
```

### 7.2 全局图谱页面布局

```
┌───────────────────────────────────────────────────────────────────┐
│  🗺 全局知识图谱                 [🔄 重建] [⏱ 2小时前] [评分:72] │
│                                                                   │
│  筛选：◉ 全部 ○ 领域 ○ 人物 ○ 缺口 ○ 问题 ○ 冲突  搜索：[____] │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                                                              │  │
│  │              Canvas 力导向图                                  │  │
│  │                                                              │  │
│  │    🟢前端开发 ─── 🟢React模式 ─── ⚠️Hooks(过时)             │  │
│  │       │                                                      │  │
│  │    🔵产品规划 ─── 👤张三                                     │  │
│  │       │                                                      │  │
│  │    🔴合规审计 ← 缺口!                                        │  │
│  │       │                                                      │  │
│  │    ⚡API网关 vs Service Mesh ← 冲突!                         │  │
│  │                                                              │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────┐ ┌─────────────────┐ ┌───────────────────┐  │
│  │ 📊 密度分布       │ │ 🏥 健康状况      │ │ 🔴 知识缺口 (3)    │  │
│  │ 🟢充足:5 🔵适中:8 │ │ ✅健康:18        │ │ 🔴[高] 微服务网关  │  │
│  │ 🟠稀疏:6 🔴缺口:3 │ │ ⚠️过时:4         │ │ 🟠[中] 合规审计    │  │
│  │                   │ │ ⚡冲突:2         │ │ 🟡[低] 运营策略    │  │
│  │                   │ │ 🔄重复:3         │ │                   │  │
│  │                   │ │ 🏚孤立:1         │ │                   │  │
│  └─────────────────┘ └─────────────────┘ └───────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

### 7.3 知识体检页面布局

```
┌───────────────────────────────────────────────────────────────────┐
│  🏥 知识体检报告                              [🔄 重新体检]      │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  知识健康评分: 72/100                                         │ │
│  │  ████████████████░░░░░░░░░░░░                                │ │
│  │  比上次 +3 分                              上次体检: 6月5日   │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─ ⚠️ 过时知识 (4) ─────────────────────────── [批量复审] ──┐  │
│  │  🔸 React Hooks 最佳实践 — 95天未更新 — [复审] [忽略]      │  │
│  │  🔸 Docker 部署流程 — 102天未更新 — [复审] [忽略]          │  │
│  │  🔸 Git 分页策略 — 88天未更新 — [复审] [忽略]              │  │
│  │  🔸 REST API 设计规范 — 91天未更新 — [复审] [忽略]         │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ ⚡ 知识冲突 (2) ─────────────────────────── [AI 仲裁] ───┐  │
│  │  🔴 API网关 vs Service Mesh — 两种架构模式冲突              │  │
│  │     [查看详情] [AI仲裁] [手动合并] [保留两者]               │  │
│  │  🔴 单体测试 vs 微服务测试 — 测试策略冲突                   │  │
│  │     [查看详情] [AI仲裁] [手动合并] [保留两者]               │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ 🔄 重复知识 (3) ────────────────────────── [批量合并] ──┐  │
│  │  🔸 React 状态管理方案对比 ×2 — 相似度 92% — [合并]        │  │
│  │  🔸 微服务通信机制 ×2 — 相似度 87% — [合并]               │  │
│  │  🔸 Docker 网络配置 ×2 — 相似度 95% — [合并]              │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ 🏚 孤立知识 (1) ────────────────────────────────────────┐  │
│  │  🔸 Docker Compose 网络配置 — 无簇归属 — [归簇] [删除]     │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ 💡 改进建议 ──────────────────────────────────────────────┐ │
│  │  1. 补充"微服务网关"领域知识（当前被提及6次但无记录）         │ │
│  │  2. 复审4条过时知识，关注版本更新带来的变化                   │ │
│  │  3. 解决2条冲突知识，明确适用场景                             │ │
│  │  4. 合并3条重复知识，减少冗余                                 │ │
│  └─────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

### 7.4 节点视觉规范

| 节点 type | 形状 | 大小 | 密度颜色 | 健康状态标记 |
|-----------|------|------|---------|------------|
| domain | 大圆 | weight×6px | 🟢/🔵/🟠/🔴 | 无变化 |
| cluster | 中圆 | weight×4px | 同上 | ⚠️过时=虚线边框, ⚡冲突=闪烁 |
| atom | 小圆 | weight×3px | 同上 | ⚠️过时=灰色内圈, 🔄重复=半透明 |
| person | 圆+👤 | weight×3px | 同上 | 无 |
| question | 三角形 | 10px | 🔴 | 无 |
| gap | 圆+脉冲 | weight×4px | 🔴脉冲 | 无 |

### 7.5 交互行为

| 操作 | 效果 |
|------|------|
| 点击节点 | 右侧弹出详情面板 |
| 点击 gap 节点 | 弹出缺口详情+操作按钮（搜索/记录/请教AI） |
| 点击冲突边 | 弹出冲突审核面板（两种观点 + AI仲裁 + 手动处理） |
| 点击过时节点 | 弹出复审面板（当前内容 + 建议更新方向） |
| 悬停节点 | Tooltip（label、density、health、stats） |
| 双击 domain | 高亮子图，其余变暗 |
| 筛选器 | 按 type / density / health 过滤 |
| "知识体检"标签 | 切换到体检报告视图 |

---

## 八、IPC 接口

| IPC Channel | 参数 | 返回 | 说明 |
|------------|------|------|------|
| `graph:build` | `{ forceRefresh? }` | `{ source, stats }` | 构建/获取图谱（调用 ADP + 写 SQLite） |
| `graph:get-nodes` | `{ type?, domain?, density?, health? }` | `[{ nodes }]` | 查询节点（从 SQLite 读取） |
| `graph:get-edges` | `{ sourceId?, type? }` | `[{ edges }]` | 查询边 |
| `graph:search` | `{ query }` | `[{ nodes }]` | FTS5 全文搜索 |
| `graph:neighbors` | `{ nodeId, depth? }` | `[{ nodes }]` | 图遍历 |
| `graph:subgraph` | `{ domainNodeId }` | `{ nodes, edges }` | 获取子图 |
| `graph:gap-detail` | `{ gapId }` | `{ analysis, suggestions }` | 缺口深度分析（调用 ADP） |
| `graph:conflict-resolve` | `{ conflictId, action, data? }` | `{ success }` | 冲突处理（合并/保留/删除） |
| `graph:conflict-arbitrate` | `{ conflictId }` | `{ resolution }` | AI 仲裁冲突（调用 ADP） |
| `graph:health-report` | — | `{ report }` | 获取最新体检报告 |
| `graph:health-recheck` | — | `{ report }` | 重新体检（调用 ADP） |
| `graph:outdated-review` | `{ nodeId, action }` | `{ success }` | 过时知识复审（更新/忽略） |
| `graph:stats` | — | `{ stats }` | 图谱统计 |

共 13 个 IPC，全部基于 SQLite 本地查询（只有 `graph:build`、`graph:gap-detail`、`graph:conflict-arbitrate`、`graph:health-recheck` 调用 ADP）。

---

## 九、数据打包（发给 ADP 前）

```javascript
// main.js 中 graph:build handler
ipcMain.handle('graph:build', async (event, { forceRefresh } = {}) => {
  // 1. 检查缓存（SQLite 中有数据且不超过 24h）
  const stats = graphDb.getStats();
  const latestReport = graphDb.getLatestHealthReport();
  if (!forceRefresh && stats.nodeCount > 0 && latestReport) {
    const age = Date.now() - new Date(latestReport.built_at).getTime();
    if (age < 24 * 3600 * 1000) {
      return { source: 'cache', stats };
    }
  }

  // 2. 收集摘要数据
  const summary = buildSummary(knowledgeStore, memoryStore);

  // 3. 调用 ADP
  const prompt = buildGraphPrompt(summary);
  const graphData = await callADPForGraph(prompt);

  // 4. 写入 SQLite
  graphDb.upsertNodes(graphData.nodes);
  graphDb.upsertEdges(graphData.edges);
  graphDb.saveHealthReport({
    built_at: new Date().toISOString(),
    node_count: graphData.nodes.length,
    edge_count: graphData.edges.length,
    ...graphData.health_report
  });

  // 5. 标记现有 JSON 数据中的健康状态（可选）
  syncHealthToJSON(graphData.health_report);

  return { source: 'adp', stats: graphDb.getStats() };
});

function buildSummary(ks, ms) {
  const summary = {
    domains: {},
    clusters: [],
    topEntities: [],
    personSummary: [],
    questionList: [],
    outdatedAtoms: [],
    profileProjects: [],
    atomCount: ks.atoms.length,
    memoryCount: ms.memories.length,
    clusterCount: ks.clusters.length
  };

  // 领域分布
  ks.atoms.forEach(a => {
    const d = a.domain || '未分类';
    if (!summary.domains[d]) summary.domains[d] = { atomCount: 0, clusterCount: 0, atomTypes: {} };
    summary.domains[d].atomCount++;
    summary.domains[d].atomTypes[a.type] = (summary.domains[d].atomTypes[a.type] || 0) + 1;
  });
  ks.clusters.forEach(c => {
    const d = c.domain || '未分类';
    if (!summary.domains[d]) summary.domains[d] = { atomCount: 0, clusterCount: 0, atomTypes: {} };
    summary.domains[d].clusterCount++;
  });

  // 知识簇摘要
  summary.clusters = ks.clusters.map(c => ({
    id: c.id, name: c.name, domain: c.domain,
    atomCount: c.atom_ids?.length || 0,
    status: c.status, keywords: c.keywords,
    daysSinceUpdate: Math.floor((Date.now() - new Date(c.updated_at).getTime()) / 86400000)
  }));

  // 高频实体
  const graph = ms.entityGraph;
  if (graph) {
    summary.topEntities = Object.entries(graph)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 50)
      .map(([name, info]) => ({ name, type: info.type, count: info.count, related: (info.related || []).slice(0, 5) }));
  }

  // 人物摘要
  summary.personSummary = Object.entries(graph || {})
    .filter(([_, info]) => info.type === 'person' || info.count >= 3)
    .slice(0, 30)
    .map(([name, info]) => ({ name, count: info.count, related: (info.related || []).slice(0, 5) }));

  // 问题
  summary.questionList = ks.atoms
    .filter(a => a.type === 'question' || a.type === 'problem')
    .map(a => ({ id: a.id, content: a.content.substring(0, 100), domain: a.domain }));

  // 过时检测（超过 90 天未更新）
  const ninetyDaysAgo = Date.now() - 90 * 86400000;
  summary.outdatedAtoms = ks.atoms
    .filter(a => new Date(a.updated_at).getTime() < ninetyDaysAgo)
    .map(a => ({ id: a.id, content: a.content.substring(0, 80), domain: a.domain, daysSince: Math.floor((Date.now() - new Date(a.updated_at).getTime()) / 86400000) }));

  // 画像
  const profile = loadProfile();
  summary.profileProjects = (profile.active_projects || []).map(p => typeof p === 'string' ? p : p.name);

  return summary;
}
```

---

## 十、冲突处理流程

### 10.1 冲突检测 → 人类审核 → 解决

```
ADP 检测到冲突
     ↓
写入 SQLite health_reports.conflicts
     ↓
前端展示冲突卡片（两种观点对比）
     ↓
用户选择处理方式：
  ├─ [AI 仲裁] → 调用 conflict-arbitrate Prompt → 生成合并方案 → 用户确认
  ├─ [手动合并] → 打开编辑器，用户自己写合并后的内容
  ├─ [保留两者] → 标记为"场景差异，不冲突"，添加 depends_on 边
  └─ [删除一方] → 删除选中的知识原子
     ↓
更新 SQLite 中的 health 状态
```

### 10.2 冲突审核面板

```
┌────────────────────────────────────────────────────────────────┐
│ ⚡ 知识冲突：API 网关 vs Service Mesh                           │
│                                                                │
│ ┌──────────────────────┐  ┌──────────────────────┐            │
│ │ 观点 A               │  │ 观点 B               │            │
│ │ 微服务应使用 API 网关 │  │ 微服务应使用 Service  │            │
│ │ 统一入口              │  │ Mesh 侧车模式        │            │
│ │                      │  │                      │            │
│ │ 来源：atom_a          │  │ 来源：atom_b          │            │
│ │ 更新：2026-03-15      │  │ 更新：2026-05-20      │            │
│ └──────────────────────┘  └──────────────────────┘            │
│                                                                │
│ 🤖 AI 分析                                                     │
│ 根本原因：技术架构的演进，API 网关是传统入口模式，              │
│ Service Mesh 是云原生演进方向。两者不矛盾，                     │
│ 分别解决不同层面的问题。                                        │
│                                                                │
│ 📝 推荐整合方案                                                 │
│ "微服务流量管理分两层：API 网关处理外部流量（限流、             │
│ 认证、协议转换），Service Mesh 处理内部服务间流量               │
│ （负载均衡、熔断、链路追踪）。两者互补共存。"                   │
│                                                                │
│ [✅ 采纳AI方案合并] [✏️ 手动编辑合并] [🔄 保留两者] [🗑 删除一方] │
└────────────────────────────────────────────────────────────────┘
```

---

## 十一、缓存与同步策略

### 11.1 缓存策略

| 场景 | 行为 |
|------|------|
| 打开图谱视图 | SQLite 读取，秒加载 |
| 点击"重建图谱" | 调用 ADP 重建，更新 SQLite |
| 新增知识原子后 | 标记缓存过期（`graph_stale = true`），下次打开自动重建 |
| ADP 调用失败 | 使用旧数据，提示"图谱可能不是最新" |
| 首次使用（无数据） | 提示"请先登录并连接 ADP 以构建知识图谱" |

### 11.2 与现有 JSON 的同步

```javascript
// knowledgeStore 变更时标记图谱缓存过期
// 在 addAtom / deleteAtom / addCluster / deleteCluster 等方法末尾加：
function markGraphStale() {
  if (graphDb) {
    graphDb.db.run("INSERT OR REPLACE INTO config (key, value) VALUES ('graph_stale', '1')");
    graphDb.save();
  }
}
```

Graph RAG 不依赖最新图谱，可以容忍短暂的过期。重建图谱是手动或自动（检测 stale）触发。

---

## 十二、新增依赖

| 包 | 版本 | 大小 | 用途 | 必要性 |
|----|------|------|------|--------|
| sql.js | ^1.11 | ~3MB WASM | SQLite 嵌入式数据库 | 必须 |

**仅 1 个新增依赖**。sql.js 是纯 WASM，不需要原生编译，electron-builder 直接打包。

---

## 十三、修改文件清单

### 新增文件

| 文件 | 行数 | 说明 |
|------|------|------|
| `src/scripts/graph/graphDb.js` | ~200 | sql.js 数据库封装 |
| `src/scripts/graph/graphView.js` | ~80 | 图谱视图控制器 |
| `src/scripts/graph/forceLayout.js` | ~250 | Canvas 力导向渲染 |
| `src/scripts/graph/graphPanel.js` | ~150 | 详情/缺口/冲突面板 |
| `src/scripts/graph/graphRAG.js` | ~120 | Graph RAG 查询构建 |
| `src/styles/graph.css` | ~80 | 图谱样式 |
| `prompts/graph_build.md` | ~60 | 图谱构建 Prompt |
| `prompts/graph_gap.md` | ~30 | 缺口分析 Prompt |
| `prompts/graph_conflict.md` | ~30 | 冲突仲裁 Prompt |

### 修改文件

| 文件 | 改动 | 量级 |
|------|------|------|
| `main.js` | 新增 13 个 graph:* IPC + GraphDB 初始化 + 数据打包 + Graph RAG 增强 | ~200 行 |
| `preload.js` | 暴露 graph API | ~20 行 |
| `src/index.html` | 新增"全局图谱"+"知识体检"Tab + Canvas + 面板容器 | ~60 行 |
| `src/scripts/knowledgeDistillation.js` | Tab 切换逻辑 | ~20 行 |
| `src/scripts/knowledgeStore.js` | 变更方法中调用 `markGraphStale()` | ~10 行 |
| `package.json` | 新增 sql.js 依赖 | ~1 行 |

**总计**：约 1020 行新代码 + 311 行修改。现有功能零改动。

---

## 十四、实施计划

### Phase 1：基础设施（1.5天）

| 任务 | 优先级 | 涉及文件 |
|------|--------|---------|
| 安装 sql.js，实现 GraphDB 类 | P0 | `graphDb.js` |
| SQLite Schema + FTS5 + 触发器 | P0 | `graphDb.js` |
| ADP Prompt 设计（三重任务） | P0 | `prompts/graph_build.md` |
| main.js: graph:build IPC + 数据打包 | P0 | `main.js` |
| main.js: GraphDB 初始化 | P0 | `main.js` |
| knowledgeStore 集成 markGraphStale | P1 | `knowledgeStore.js` |

### Phase 2：图谱可视化（2天）

| 任务 | 优先级 | 涉及文件 |
|------|--------|---------|
| Canvas 力导向布局 | P0 | `forceLayout.js` |
| 节点形状/颜色/健康标记 | P0 | `forceLayout.js` |
| 交互：拖拽/缩放/悬停/点击 | P0 | `forceLayout.js` |
| HTML: 新增 Tab + Canvas 容器 | P0 | `index.html` |
| graphView.js: Tab 切换/刷新/加载 | P0 | `graphView.js` |
| 筛选器 + 搜索 | P1 | `graphView.js` |
| 底部统计栏 | P1 | `graphView.js` |
| Apple Design 样式 | P1 | `graph.css` |

### Phase 3：知识体检（1.5天）

| 任务 | 优先级 | 涉及文件 |
|------|--------|---------|
| 体检报告页面 | P0 | `graphPanel.js` + `index.html` |
| 过时知识复审面板 | P0 | `graphPanel.js` |
| 冲突审核面板 | P0 | `graphPanel.js` |
| 重复知识合并 | P1 | `graphPanel.js` |
| 孤立知识归簇 | P1 | `graphPanel.js` |
| IPC: graph:conflict-resolve/arbitrate | P0 | `main.js` |
| IPC: graph:outdated-review | P1 | `main.js` |

### Phase 4：Graph RAG（1天）

| 任务 | 优先级 | 涉及文件 |
|------|--------|---------|
| GraphRAG 类实现 | P0 | `graphRAG.js` |
| 集成到 assistant:chat | P0 | `main.js` |
| RAG Prompt 模板 | P0 | `main.js` |
| 测试：基于图谱回答 vs 无图谱回答 | P1 | — |

**总工时约 6 天**。

---

## 十五、总结

| 维度 | v1 设计 | v2 设计（本版） |
|------|---------|----------------|
| 存储方案 | graph-cache.json | **sql.js SQLite**（FTS5 + 递归 CTE + 事务） |
| 瓶颈风险 | JSON 全量读写，>10K 时卡顿 | SQLite 增量查询，支持 100K+ 节点 |
| 知识体检 | 无 | **5 维健康评估**（过时/冲突/重复/孤立/缺口） |
| 冲突检测 | 无 | **ADP 语义检测 + 人类审核 + AI 仲裁** |
| Graph RAG | 无 | **图遍历检索 + 上下文增强 + 来源标注** |
| ADP 调用 | 2 次 | **1 次三重任务** + 按需缺口/冲突分析 |
| 新增代码 | ~400 行 | ~1020 行（但能力提升 3 倍） |
| 新增依赖 | 0 | **1 个**（sql.js, 3MB WASM） |
| 原有改动 | 极少 | 极少（仅标记缓存过期） |

**核心价值**：
1. **一图看全貌** — 知识密度、健康状态、缺口位置一目了然
2. **知识可维护** — 过时/冲突/重复知识自动检出，人类一键处理
3. **问答更精准** — Graph RAG 让小助手基于你的知识体系回答，而非泛泛而谈
4. **可持续增长** — SQLite 承载 100K+ 知识无压力，不会随规模增长而退化
