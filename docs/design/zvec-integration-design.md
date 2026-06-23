# Zvec 向量数据库集成设计方案

> 评估 Memora 整合阿里开源嵌入式向量数据库 zvec 的必要性、可行性及实施方案。

---

## 一、背景：Memora 当前搜索架构的瓶颈

### 1.1 现状

| 模块 | 搜索方式 | 核心代码 | 问题 |
|------|---------|---------|------|
| 记事本 | 关键词 `includes()` 匹配 | `notebook.js:searchNotes()` | 搜"里程碑进展"找不到"项目进度" |
| 记忆 | 关键词分词 + 业务分类加分 | `memory.js:searchRelated()` | 语义相近但用词不同的记忆无法命中 |
| 本地知识检索 | `calculateLocalRelevance()` 词频打分 | `main.js:15285` | 召回率低，大量相关内容被遗漏 |
| RAG 上下文注入 | LLM 意图分类 → 关键词检索 | `app-ai-tasks.js:_retrieveLocalContext()` | 注入的上下文不够精准，AI 回答质量受限 |
| CC 模式 | CLAUDE.md 全量注入 | `main.js:syncCLAUDEMdToCC()` | 无语义检索，上下文噪声大 |

### 1.2 核心痛点

```
用户问："上次跟客户聊的 K8s 方案进展如何？"
当前搜索：keyword = ["上次","客户","聊","K8s","方案","进展","如何"]
→ 记事本中存的是"周三和腾讯云团队讨论了容器编排迁移方案"
→ 关键词完全不匹配 → 搜索结果为空 → AI 回答"没有找到相关信息"
```

**根因**：关键词匹配无法理解语义等价性，"K8s"≈"容器编排"、"进展"≈"讨论了"。

### 1.3 数据量评估

| 数据类型 | 预估量级 | 向量化必要性 |
|----------|---------|-------------|
| 记事本笔记 | 500-2000 条 | **高** — 内容长短不一，语义多样 |
| 记忆条目 | 500-1500 条 | **高** — 是 RAG 的核心数据源 |
| 待办任务 | 100-500 条 | **中** — 标题简短，关键词可覆盖 |
| 知识原子 | 200-800 条 | **高** — 知识图谱节点，语义检索价值大 |
| 用户画像 | 10-50 条 | **低** — 结构化字段，精确匹配即可 |
| 人脉节点 | 100-500 条 | **中** — 姓名+角色+项目组合查询 |

---

## 二、Zvec 核心能力与适配分析

### 2.1 Zvec 是什么

阿里开源的**嵌入式（进程内）向量数据库**，无需独立部署服务，直接嵌入应用程序：

| 特性 | 说明 | 对 Memora 的价值 |
|------|------|-----------------|
| 进程内运行 | 纯库嵌入，无服务器 | 完美适配 Electron 桌面应用，零运维 |
| Node.js SDK | `npm install @zvec/zvec` | 原生集成 Electron 主进程 |
| 稠密+稀疏向量 | 支持两种向量类型 | 稠密做语义，稀疏做关键词，混合检索 |
| 全文检索(FTS) | 原生关键词搜索 | 替代当前手写的 `includes()` 搜索 |
| 混合检索 | 单次查询融合向量+FTS+标量过滤 | 语义+关键词+分类过滤一次完成 |
| WAL 持久化 | 预写日志，崩溃不丢数据 | 满足本地数据安全要求 |
| 毫秒级响应 | 十亿级向量毫秒检索 | 500-2000 条数据秒杀 |
| 多进程读 | 支持并发读取 | 主进程写 + 渲染进程读不冲突 |

### 2.2 与 Memora 架构的契合度

```
Memora 本地优先架构:
  本地 SQLite + JSON 文件 → 敏感数据不出本地
  云端 AI → 按需调用（DeepSeek/ADP）

Zvec 嵌入式架构:
  本地向量数据库 → 向量数据不出本地
  Embedding API → 按需调用（DeepSeek/Volcano）

完美契合：数据在本地，智能在云端
```

### 2.3 Embedding 模型选型

| 模型 | 来源 | 维度 | 中文支持 | 延迟 | 费用 |
|------|------|------|---------|------|------|
| `doubao-embedding-text` | 火山引擎 Agent Plan | 2048 | 优秀 | ~100ms | AFP 额度内免费 |
| `deepseek-embedding` | DeepSeek API | 1024 | 良好 | ~150ms | 极低 |
| 本地 BGE 模型 | 本地 ONNX | 768 | 良好 | ~50ms | 免费，但需 ~200MB 模型 |

**推荐**：火山引擎 `doubao-embedding-text`（已有配置）+ 本地 BGE 降级（离线可用）。

---

## 三、必要性评估

### 3.1 高必要性场景（强烈建议整合）

#### 场景 1：RAG 上下文注入 — 质量飞跃

```
当前流程：
  用户问题 → LLM 意图分类 → 关键词搜索记忆/笔记 → 注入上下文 → AI 回答
  问题：关键词搜索召回率低，注入的上下文不够相关

整合后流程：
  用户问题 → Embedding → 向量检索 Top-K → 混合 FTS+标量过滤 → 注入上下文 → AI 回答
  提升：语义召回 + 关键词精确 + 时间/分类过滤，三重保障
```

**预期提升**：RAG 上下文相关度提升 40-60%，AI 回答"我不知道"的概率降低 50%。

#### 场景 2：记事本/记忆语义搜索 — 体验提升

```
当前：搜 "K8s" → 只匹配包含 "K8s" 字面的笔记
整合后：搜 "K8s" → 匹配 "容器编排"、"Kubernetes"、"Pod调度" 等语义相关笔记
```

**预期提升**：搜索召回率提升 3-5 倍，用户不再需要"猜关键词"。

#### 场景 3：知识图谱语义聚类 — 自动化提升

```
当前：知识原子靠 AI 手动聚类，分类不够精准
整合后：向量相似度自动发现"应该归为一类"的知识原子，辅助 AI 聚类
```

### 3.2 中必要性场景（建议二期）

#### 场景 4：CC 模式上下文增强

```
当前：CC 模式通过 CLAUDE.md 全量注入记忆，上下文噪声大
整合后：CC 模式发起对话前，用向量检索 Top-5 最相关记忆，精准注入
```

**预期提升**：CC 回答更聚焦，Token 消耗减少 30%（注入的上下文更精简）。

#### 场景 5：人脉图谱语义检索

```
当前：人脉搜索按姓名/公司精确匹配
整合后：搜 "容器云专家" → 语义匹配做过 K8s 项目的架构师
```

### 3.3 低必要性场景（暂不整合）

- **待办任务搜索**：任务标题简短且结构化，关键词搜索已够用
- **用户画像**：字段固定，精确匹配更合适
- **番茄钟/提醒**：无搜索需求

### 3.4 评估结论

| 维度 | 评分 | 说明 |
|------|------|------|
| 搜索质量提升 | ★★★★★ | 从关键词匹配跃升到语义理解 |
| RAG 质量提升 | ★★★★★ | 直接影响 AI 回答准确率 |
| 架构契合度 | ★★★★☆ | 嵌入式完美适配本地优先架构 |
| 实现复杂度 | ★★★☆☆ | 需引入原生依赖 + Embedding API |
| 性能影响 | ★★☆☆☆ | 毫秒级检索，几乎无感知 |
| 存储开销 | ★★☆☆☆ | 2000条 × 2048维 ≈ 16MB，可忽略 |

**结论：强烈建议整合，优先级 P1。**

---

## 四、整合方案设计

### 4.1 整体架构

```
┌─────────────────────────────────────────────────────┐
│                    Electron 主进程                    │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Notebook  │  │ Memory   │  │ KnowledgeStore   │   │
│  │ (JSON)    │  │ (JSON)   │  │ (SQLite)         │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────────────┘   │
│       │              │              │                  │
│       ▼              ▼              ▼                  │
│  ┌────────────────────────────────────────────────┐  │
│  │           VectorIndexManager (新增)             │  │
│  │  ┌──────────────────────────────────────────┐  │  │
│  │  │  Zvec Collections                         │  │  │
│  │  │  ├── notes_vec    (笔记向量)              │  │  │
│  │  │  ├── memories_vec (记忆向量)              │  │  │
│  │  │  ├── knowledge_vec(知识原子向量)          │  │  │
│  │  │  └── tasks_vec    (待办向量,可选)         │  │  │
│  │  └──────────────────────────────────────────┘  │  │
│  └────────────────────┬───────────────────────────┘  │
│                       │                               │
│  ┌────────────────────▼───────────────────────────┐  │
│  │           EmbeddingService (新增)               │  │
│  │  ├── doubao-embedding (火山引擎,默认)          │  │
│  │  ├── deepseek-embedding (备用)                 │  │
│  │  └── local-bge (离线降级,可选)                 │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │           HybridSearchService (新增)            │  │
│  │  输入: query + filters(分类/时间/类型)          │  │
│  │  输出: [{ id, score, source, content }]         │  │
│  │  策略: 向量相似度 × 0.7 + FTS × 0.3            │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
          │ IPC
          ▼
┌─────────────────────────────────────────────────────┐
│                    渲染进程 (前端)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ 笔记搜索  │  │ 记忆搜索  │  │ RAG上下文注入     │   │
│  │ (语义)   │  │ (语义)   │  │ (HybridSearch)   │   │
│  └──────────┘  └──────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### 4.2 数据模型 — Zvec Collection Schema

#### 4.2.1 notes_vec（笔记向量）

```python
schema = zvec.CollectionSchema(
    name="notes_vec",
    vectors=zvec.VectorSchema("embedding", zvec.DataType.VECTOR_FP32, 2048),
    fields=[
        zvec.FieldSchema("note_id", zvec.DataType.STRING),        # 关联 notebook.js 的 note.id
        zvec.FieldSchema("title", zvec.DataType.STRING),           # 笔记标题（FTS索引）
        zvec.FieldSchema("content", zvec.DataType.STRING),         # 笔记内容（FTS索引）
        zvec.FieldSchema("category", zvec.DataType.STRING),        # 分类（标量过滤）
        zvec.FieldSchema("tags", zvec.DataType.STRING),            # 标签（逗号分隔）
        zvec.FieldSchema("created_at", zvec.DataType.INT64),       # 创建时间戳（标量过滤）
        zvec.FieldSchema("has_analysis", zvec.DataType.BOOL),      # 是否已AI分析
    ],
    # FTS 索引挂在 title 和 content 上
    fts_fields=["title", "content"],
)
```

#### 4.2.2 memories_vec（记忆向量）

```python
schema = zvec.CollectionSchema(
    name="memories_vec",
    vectors=zvec.VectorSchema("embedding", zvec.DataType.VECTOR_FP32, 2048),
    fields=[
        zvec.FieldSchema("memory_id", zvec.DataType.STRING),
        zvec.FieldSchema("content", zvec.DataType.STRING),         # 记忆内容（FTS索引）
        zvec.FieldSchema("type", zvec.DataType.STRING),            # instant/short/long（标量过滤）
        zvec.FieldSchema("category", zvec.DataType.STRING),        # task/knowledge/person/...
        zvec.FieldSchema("business_category", zvec.DataType.STRING),
        zvec.FieldSchema("importance", zvec.DataType.STRING),      # high/medium/low
        zvec.FieldSchema("created_at", zvec.DataType.INT64),
    ],
    fts_fields=["content"],
)
```

#### 4.2.3 knowledge_vec（知识原子向量）

```python
schema = zvec.CollectionSchema(
    name="knowledge_vec",
    vectors=zvec.VectorSchema("embedding", zvec.DataType.VECTOR_FP32, 2048),
    fields=[
        zvec.FieldSchema("atom_id", zvec.DataType.STRING),
        zvec.FieldSchema("content", zvec.DataType.STRING),
        zvec.FieldSchema("domain", zvec.DataType.STRING),          # 领域（标量过滤）
        zvec.FieldSchema("type", zvec.DataType.STRING),            # atom/cluster/article
        zvec.FieldSchema("importance", zvec.DataType.FLOAT),
        zvec.FieldSchema("created_at", zvec.DataType.INT64),
    ],
    fts_fields=["content"],
)
```

### 4.3 核心模块设计

#### 4.3.1 EmbeddingService — 向量化服务

```javascript
// src/services/embeddingService.js

class EmbeddingService {
  constructor() {
    this.provider = null;       // 'volcano' | 'deepseek' | 'local'
    this.apiConfig = null;
    this.cache = new Map();     // content hash → vector，避免重复 Embedding
    this.cacheMaxSize = 5000;
  }

  async init() {
    const config = await this._loadConfig();
    this.provider = config.provider || 'volcano';
    this.apiConfig = config[this.provider];
  }

  /**
   * 向量化单条文本
   * @returns {Promise<Float32Array>} 2048维向量
   */
  async embed(text) {
    if (!text || !text.trim()) return null;

    // 缓存命中
    const hash = this._hash(text);
    if (this.cache.has(hash)) return this.cache.get(hash);

    let vector;
    switch (this.provider) {
      case 'volcano':
        vector = await this._embedVolcano(text);
        break;
      case 'deepseek':
        vector = await this._embedDeepseek(text);
        break;
      case 'local':
        vector = await this._embedLocal(text);
        break;
    }

    // 写缓存
    if (vector && this.cache.size < this.cacheMaxSize) {
      this.cache.set(hash, vector);
    }

    return vector;
  }

  /**
   * 批量向量化（减少 API 调用次数）
   */
  async embedBatch(texts) {
    // 过滤空文本
    const valid = texts.map((t, i) => ({ text: t, index: i })).filter(x => x.text?.trim());
    // 分批（API 限制每批 32 条）
    const batchSize = 32;
    const results = new Array(texts.length).fill(null);

    for (let i = 0; i < valid.length; i += batchSize) {
      const batch = valid.slice(i, i + batchSize);
      const vectors = await this._embedBatchAPI(batch.map(b => b.text));
      batch.forEach((b, j) => { results[b.index] = vectors[j]; });
    }

    return results;
  }

  async _embedVolcano(text) {
    // 火山引擎 doubao-embedding-text
    const response = await fetch(`${this.apiConfig.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: 'doubao-embedding-text',
        input: text,
      }),
    });
    const data = await response.json();
    return new Float32Array(data.data[0].embedding);
  }
}
```

#### 4.3.2 VectorIndexManager — 向量索引管理

```javascript
// src/services/vectorIndexManager.js

const zvec = require('@zvec/zvec');

class VectorIndexManager {
  constructor() {
    this.collections = {};
    this.dbPath = null;  // userData/vector_db/
  }

  async init(userDataPath) {
    this.dbPath = path.join(userDataPath, 'vector_db');

    // 初始化各 Collection
    this.collections.notes = await this._openCollection('notes_vec', notesSchema);
    this.collections.memories = await this._openCollection('memories_vec', memoriesSchema);
    this.collections.knowledge = await this._openCollection('knowledge_vec', knowledgeSchema);
  }

  /**
   * 插入/更新笔记向量
   */
  async upsertNote(note) {
    const vector = await embeddingService.embed(
      `${note.title || ''} ${note.content}`.trim()
    );
    if (!vector) return;

    // 先删除旧向量（如果存在）
    await this.collections.notes.delete({ filter: `note_id = "${note.id}"` });

    await this.collections.notes.insert([{
      id: `note_${note.id}`,
      vectors: { embedding: Array.from(vector) },
      fields: {
        note_id: note.id,
        title: note.title || '',
        content: note.content.substring(0, 2000),  // FTS 不需要全文，截断省空间
        category: note.category || 'general',
        tags: (note.tags || []).join(','),
        created_at: new Date(note.createdAt).getTime(),
        has_analysis: !!note.analyzed,
      }
    }]);
  }

  /**
   * 删除笔记向量
   */
  async deleteNote(noteId) {
    await this.collections.notes.delete({ filter: `note_id = "${noteId}"` });
  }

  /**
   * 混合检索：向量 + FTS + 标量过滤
   */
  async hybridSearch(query, options = {}) {
    const queryVector = await embeddingService.embed(query);
    if (!queryVector) {
      // Embedding 失败，降级为纯 FTS
      return this._ftsFallback(query, options);
    }

    const collections = options.sources || ['notes', 'memories', 'knowledge'];
    const results = [];

    for (const colName of collections) {
      const collection = this.collections[colName];
      if (!collection) continue;

      // 构建标量过滤条件
      const filters = this._buildFilters(options, colName);

      // 混合查询：向量 + FTS
      const multiQuery = zvec.MultiQuery()
        .add(zvec.VectorQuery("embedding", vector=Array.from(queryVector), topk=options.topK || 10))
        .add(zvec.FTSQuery(query, fields=["title", "content"], topk=options.topK || 10))
        .filter(filters)
        .fusion(zvec.FusionMethod.RRF);  // Reciprocal Rank Fusion

      const hits = await collection.query(multiQuery);
      hits.forEach(hit => {
        results.push({
          source: colName,
          id: hit.fields.note_id || hit.fields.memory_id || hit.fields.atom_id,
          score: hit.score,
          content: hit.fields.content,
          title: hit.fields.title,
          category: hit.fields.category,
          created_at: hit.fields.created_at,
        });
      });
    }

    // 合并排序
    return results.sort((a, b) => b.score - a.score).slice(0, options.limit || 20);
  }

  /**
   * 全量重建索引（数据迁移或修复时用）
   */
  async rebuildAll(notes, memories, knowledgeAtoms) {
    console.log('[VectorIndex] Rebuilding all collections...');

    // 清空
    for (const col of Object.values(this.collections)) {
      await col.delete({});
    }

    // 批量向量化
    const noteTexts = notes.map(n => `${n.title || ''} ${n.content}`.trim());
    const noteVectors = await embeddingService.embedBatch(noteTexts);
    // ... 批量插入

    console.log(`[VectorIndex] Rebuilt: ${notes.length} notes, ${memories.length} memories, ${knowledgeAtoms.length} atoms`);
  }
}
```

#### 4.3.3 HybridSearchService — 混合搜索服务

```javascript
// src/services/hybridSearchService.js

class HybridSearchService {
  constructor(vectorIndex, embeddingService) {
    this.vectorIndex = vectorIndex;
    this.embedding = embeddingService;
  }

  /**
   * RAG 上下文检索 — 替代当前 retrieveContext()
   * 输入用户问题，返回最相关的本地数据
   */
  async retrieveForRAG(query, intent = {}) {
    const options = {
      topK: 5,
      limit: 10,
      sources: [],
    };

    // 根据意图分类决定检索哪些数据源
    if (intent.need_notebook) options.sources.push('notes');
    if (intent.need_memory) options.sources.push('memories');
    if (intent.need_knowledge) options.sources.push('knowledge');

    // 时间范围过滤
    if (intent.notebook_time_range) {
      options.timeRange = this._parseTimeRange(intent.notebook_time_range);
    }

    // 分类过滤
    if (intent.memory_category) {
      options.category = intent.memory_category;
    }

    const results = await this.vectorIndex.hybridSearch(query, options);

    // 组装 RAG 上下文
    return this._assembleContext(results, intent);
  }

  /**
   * 笔记语义搜索 — 替代 notebook.searchNotes()
   */
  async searchNotes(query, category = null, limit = 20) {
    const results = await this.vectorIndex.hybridSearch(query, {
      sources: ['notes'],
      category,
      limit,
      topK: limit,
    });
    return results.map(r => ({
      id: r.id,
      title: r.title,
      content: r.content,
      category: r.category,
      score: r.score,
    }));
  }

  /**
   * CC 模式上下文检索
   */
  async retrieveForCC(query, workdir = null) {
    // 检索与当前编码任务相关的记忆和笔记
    const results = await this.vectorIndex.hybridSearch(query, {
      sources: ['memories', 'notes'],
      topK: 5,
      limit: 8,
    });

    // 格式化为 CC 可读的上下文
    return this._formatForCLAUDE(results, workdir);
  }
}
```

### 4.4 数据同步策略

#### 4.4.1 增量同步（实时）

```javascript
// 笔记保存时自动向量化
// main.js — notebook-update-note handler 增加钩子

ipcMain.handle('notebook-add-note', async (event, note) => {
  const result = notebook.addNote(note);
  if (result && vectorIndex) {
    // 异步向量化，不阻塞保存
    vectorIndex.upsertNote(result).catch(e =>
      console.error('[VectorIndex] upsertNote failed:', e)
    );
  }
  return { success: true, note: result };
});

ipcMain.handle('notebook-update-note', async (event, id, updates) => {
  const result = notebook.updateNote(id, updates);
  if (result && vectorIndex) {
    vectorIndex.upsertNote(result).catch(e =>
      console.error('[VectorIndex] upsertNote failed:', e)
    );
  }
  return { success: true, note: result };
});

ipcMain.handle('notebook-delete-note', async (event, id, reason) => {
  notebook.deleteNote(id);
  if (vectorIndex) {
    vectorIndex.deleteNote(id).catch(e =>
      console.error('[VectorIndex] deleteNote failed:', e)
    );
  }
  return { success: true };
});
```

#### 4.4.2 全量重建（首次/修复）

```javascript
// 设置页面新增"重建向量索引"按钮
ipcMain.handle('vector:rebuild', async () => {
  const notes = notebook.getAllNotes();
  const memories = memoryStore.getAllMemories();
  const atoms = await knowledgeStore.getAllAtoms();

  await vectorIndex.rebuildAll(notes, memories, atoms);
  return { success: true, count: { notes: notes.length, memories: memories.length, atoms: atoms.length } };
});
```

#### 4.4.3 云端同步适配

```
本地数据变更 → 更新本地 Zvec 索引 → 标记需同步
云端数据拉取 → 合并到本地 → 增量向量化新数据
```

向量化数据**不上传云端**（向量是本地派生数据，可随时从内容重建）。

### 4.5 搜索降级策略

```
用户发起搜索
    │
    ▼
Embedding API 可用？
    ├── 是 → 混合检索（向量 + FTS + 标量过滤）→ 返回结果
    │
    └── 否（网络不可用/API 额度耗尽）
         │
         ▼
    本地 BGE 模型可用？
        ├── 是 → 本地向量化 + 向量检索
        │
        └── 否 → 降级为纯 FTS 全文检索（仍优于当前的 includes()）
```

### 4.6 IPC 通道设计

| 通道 | 方向 | 参数 | 说明 |
|------|------|------|------|
| `vector:search` | 渲染→主 | `{ query, sources?, category?, timeRange?, limit? }` | 混合语义搜索 |
| `vector:search-notes` | 渲染→主 | `{ query, category?, limit? }` | 笔记语义搜索 |
| `vector:retrieve-rag` | 渲染→主 | `{ query, intent? }` | RAG 上下文检索 |
| `vector:retrieve-cc` | 渲染→主 | `{ query, workdir? }` | CC 模式上下文 |
| `vector:rebuild` | 渲染→主 | — | 全量重建索引 |
| `vector:status` | 渲染→主 | — | 索引状态（条目数/最后更新） |

---

## 五、与现有模块的整合点

### 5.1 记事本搜索

```javascript
// notebook.js — searchNotes() 改造

// 旧：纯关键词匹配
searchNotes(query) {
  const lowerQuery = query.toLowerCase();
  return this.notes.filter(note =>
    note.title.toLowerCase().includes(lowerQuery) ||
    note.content.toLowerCase().includes(lowerQuery)
  );
}

// 新：优先语义搜索，降级关键词
async searchNotes(query) {
  // 尝试向量搜索
  if (window.electronAPI?.vectorSearchNotes) {
    const result = await window.electronAPI.vectorSearchNotes({ query, limit: 50 });
    if (result.success && result.results.length > 0) {
      // 补全完整笔记数据
      return result.results.map(r => this.getNoteById(r.id)).filter(Boolean);
    }
  }
  // 降级：关键词搜索
  return this._keywordSearch(query);
}
```

### 5.2 RAG 上下文注入

```javascript
// app-ai-tasks.js — _retrieveLocalContext() 改造

async _retrieveLocalContext(classification) {
  // 尝试向量检索
  if (window.electronAPI?.vectorRetrieveRAG) {
    try {
      const result = await window.electronAPI.vectorRetrieveRAG({
        query: classification.intent_summary || '',
        intent: classification,
      });
      if (result.success && result.context) {
        return { systemRole: result.context, sources: result.sources };
      }
    } catch (e) {
      console.warn('[RAG] Vector retrieval failed, falling back to keyword:', e);
    }
  }
  // 降级：现有的关键词检索逻辑
  return this._retrieveLocalContextFallback();
}
```

### 5.3 CC 模式上下文增强

```javascript
// main.js — ccInvoke handler 改造

async function buildCCSystemPrompt(workdir, userMessage) {
  let prompt = await readCLAUDEMd(workdir);

  // 新增：向量检索最相关记忆
  if (vectorIndex && userMessage) {
    const ragContext = await hybridSearch.retrieveForCC(userMessage, workdir);
    if (ragContext) {
      prompt += `\n\n## 相关记忆\n${ragContext}\n`;
    }
  }

  return prompt;
}
```

### 5.4 记忆系统整合

```javascript
// main.js — memory:add handler 增加向量化

ipcMain.handle('memory:add', async (event, memoryData) => {
  const result = memoryStore.addMemory(memoryData);
  if (result && vectorIndex) {
    vectorIndex.upsertMemory(result).catch(e =>
      console.error('[VectorIndex] upsertMemory failed:', e)
    );
  }
  return { success: true, memory: result };
});
```

---

## 六、实施计划

### Phase 1：基础设施（1 周）

| 任务 | 说明 | 工时 |
|------|------|------|
| 安装 zvec npm 包 | `npm install @zvec/zvec` | 0.5h |
| EmbeddingService 实现 | 火山引擎 + DeepSeek 双通道 | 4h |
| VectorIndexManager 实现 | 3 个 Collection 初始化 + CRUD | 6h |
| 全量索引构建脚本 | 首次迁移用 | 2h |
| IPC 通道 + preload 暴露 | 6 个通道 | 2h |

### Phase 2：搜索整合（3 天）

| 任务 | 说明 | 工时 |
|------|------|------|
| 记事本语义搜索 | 替换 `searchNotes()` | 3h |
| 记忆语义搜索 | 替换 `searchRelated()` | 3h |
| 混合搜索服务 | HybridSearchService | 4h |
| 前端搜索 UI 适配 | 搜索结果展示 score | 2h |

### Phase 3：RAG 增强（2 天）

| 任务 | 说明 | 工时 |
|------|------|------|
| RAG 上下文检索 | 替换 `retrieveContext()` | 4h |
| LLM 意图分类适配 | 意图结果传入向量检索 | 2h |
| 降级策略 | API 不可用时回退关键词 | 2h |

### Phase 4：CC 模式 + 优化（2 天）

| 任务 | 说明 | 工时 |
|------|------|------|
| CC 上下文向量检索 | 替代 CLAUDE.md 全量注入 | 3h |
| 索引状态监控 | 设置页面展示索引状态 | 2h |
| 性能优化 | 批量 Embedding + 缓存 | 3h |

**总工时：约 2.5 周**

---

## 七、预期提升总结

### 7.1 搜索质量

| 指标 | 当前（关键词） | 整合后（向量+FTS） | 提升 |
|------|--------------|-------------------|------|
| 召回率 | ~30% | ~85% | **+183%** |
| 精确率 | ~70% | ~80% | +14% |
| 语义匹配 | 不支持 | 支持 | **质变** |
| 跨语言匹配 | 不支持 | 支持 | **质变** |

### 7.2 RAG 上下文质量

| 指标 | 当前 | 整合后 | 提升 |
|------|------|--------|------|
| 上下文相关度 | ~40% | ~80% | **+100%** |
| AI 回答准确率 | ~60% | ~85% | +42% |
| 上下文 Token 消耗 | 全量注入 | Top-K 精准注入 | **-30%** |

### 7.3 CC 模式提升

| 指标 | 当前 | 整合后 | 提升 |
|------|------|--------|------|
| 上下文相关性 | 低（全量 CLAUDE.md） | 高（向量检索 Top-5） | **质变** |
| 编码建议准确率 | ~50% | ~70% | +40% |
| Token 浪费 | 高 | 低 | **-40%** |

### 7.4 用户体验

| 场景 | 当前 | 整合后 |
|------|------|--------|
| 搜笔记 | 必须记住精确关键词 | 自然语言搜索即可 |
| 问 AI | "没找到相关信息"频繁 | AI 能找到语义相关内容 |
| CC 编码 | 上下文不聚焦 | 精准注入相关记忆 |
| 离线使用 | 搜索完全不可用 | 本地 BGE 降级仍可语义搜索 |

---

## 八、风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| zvec npm 包含原生二进制 | 跨平台构建复杂 | 预编译多平台二进制，CI 覆盖 mac/linux/win |
| Embedding API 额度限制 | 批量向量化受阻 | 本地 BGE 降级 + 增量同步避免批量 |
| 向量索引损坏 | 搜索不可用 | 全量重建机制 + 降级关键词搜索 |
| 首次全量索引耗时 | 用户等待 | 后台静默构建 + 进度提示 |
| 存储空间增长 | 磁盘占用 | 2000条≈16MB，可忽略；超大数据用 DiskANN |

---

## 九、结论

**强烈建议整合 zvec**。理由：

1. **架构完美契合**：嵌入式进程内运行，零运维，符合 Memora 本地优先架构
2. **搜索质量质变**：从关键词匹配跃升到语义理解，召回率从 30% 提升到 85%
3. **RAG 质量飞跃**：AI 回答准确率提升 40%+，直接提升产品核心价值
4. **CC 模式增强**：精准上下文注入替代全量注入，编码建议更聚焦
5. **成本可控**：Embedding API 费用极低（火山引擎 AFP 额度内免费），存储开销 <20MB
6. **降级完善**：API 不可用 → 本地 BGE → 纯 FTS，三级降级确保可用性

**优先级**：P1（RAG 质量提升是 Memora "越用越懂你"承诺的技术基础）

---

## 十、向量化同步/异步策略（补充设计）

### 10.1 核心原则

**用户操作零阻塞**：所有向量化操作均为异步，不阻塞用户的增删改查交互。

### 10.2 双通道写入机制

```
用户操作（保存笔记/添加记忆/创建待办）
    │
    ├── 同步通道（立即完成）→ JSON/SQLite 写入 → 返回成功给用户
    │                                    ↓
    │                              用户无感知，操作已完成
    │
    └── 异步通道（后台执行）→ 向量化队列 → Embedding API → Zvec 写入
         │                                         ↓
         │                                   向量索引更新
         │
         └── 队列状态：pending → embedding → indexed → done
             失败自动重试（最多3次，指数退避）
```

### 10.3 向量化队列设计

```javascript
// src/services/vectorQueue.js

class VectorizationQueue {
  constructor() {
    this.queue = [];          // 待处理队列
    this.processing = false;  // 是否正在处理
    this.maxRetries = 3;
    this.batchSize = 10;      // 批量向量化，减少API调用
    this.flushInterval = 5000; // 5秒flush一次（聚合快速连续操作）
  }

  /**
   * 入队（不阻塞调用方）
   * @param {string} operation - 'upsert' | 'delete'
   * @param {string} collection - 'notes' | 'memories' | 'knowledge' | 'tasks' | 'profile'
   * @param {object} data - 原始数据
   */
  enqueue(operation, collection, data) {
    // 去重：同一条数据的最新操作覆盖旧操作
    const existingIdx = this.queue.findIndex(
      item => item.collection === collection && item.data?.id === data?.id
    );
    if (existingIdx !== -1) {
      this.queue[existingIdx] = { operation, collection, data, retries: 0, status: 'pending' };
    } else {
      this.queue.push({ operation, collection, data, retries: 0, status: 'pending' });
    }

    // 延迟处理（聚合连续操作）
    if (this._flushTimer) clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => this._process(), this.flushInterval);
  }

  async _process() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    // 取出待处理项，按 collection 分组批量处理
    const batch = this.queue.splice(0, this.batchSize);

    // 按 collection 分组
    const grouped = {};
    batch.forEach(item => {
      if (!grouped[item.collection]) grouped[item.collection] = [];
      grouped[item.collection].push(item);
    });

    for (const [collection, items] of Object.entries(grouped)) {
      try {
        // 批量向量化
        const texts = items.map(i => this._extractText(i.data, collection));
        const vectors = await embeddingService.embedBatch(texts);

        // 批量写入 Zvec
        for (let i = 0; i < items.length; i++) {
          if (items[i].operation === 'delete') {
            await vectorIndex.delete(collection, items[i].data.id);
          } else if (vectors[i]) {
            await vectorIndex.upsert(collection, items[i].data, vectors[i]);
          }
          items[i].status = 'done';
        }
      } catch (e) {
        console.error('[VectorQueue] Batch failed:', e);
        // 重试
        items.forEach(item => {
          item.retries++;
          if (item.retries < this.maxRetries) {
            item.status = 'pending';
            this.queue.push(item); // 重新入队
          } else {
            item.status = 'failed';
            console.error(`[VectorQueue] Max retries exceeded for ${collection}/${item.data.id}`);
          }
        });
      }
    }

    this.processing = false;
    // 如果队列还有数据，继续处理
    if (this.queue.length > 0) {
      setTimeout(() => this._process(), 1000);
    }
  }

  _extractText(data, collection) {
    switch (collection) {
      case 'notes': return `${data.title || ''} ${data.content || ''}`.trim();
      case 'memories': return data.content || '';
      case 'tasks': return `${data.title || ''} ${data.description || ''}`.trim();
      case 'knowledge': return data.content || '';
      case 'profile': return JSON.stringify(data); // 画像结构化数据
      default: return '';
    }
  }
}
```

### 10.4 各数据源同步策略

| 数据源 | 同步方式 | 触发时机 | 阻塞用户？ |
|--------|---------|---------|-----------|
| 记事本 | 异步入队 | add/update/delete 时 | 否 |
| 记忆 | 异步入队 | add/update/delete 时 | 否 |
| 待办任务 | 异步入队 | add/update/complete 时 | 否 |
| 知识原子 | 异步入队 | add/merge/delete 时 | 否 |
| 用户画像 | 异步入队 | 修改画像字段时 | 否 |
| 人脉节点 | 异步入队 | add/update 时 | 否 |
| **全量重建** | **后台批量** | 手动触发/首次启动 | 否（进度提示） |

### 10.5 索引一致性保障

```
数据写入 JSON/SQLite（成功） → 入向量化队列
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                 成功             失败重试         重试耗尽
                    │               │               │
              索引已更新        重新入队        标记为失败
                                    │               │
                              下次flush重试    下次全量重建修复
```

**兜底机制**：应用启动时检测 `JSON/SQLite 数据量` vs `Zvec 索引量`，差异超过 5% 时自动触发增量补全。

---

## 十一、AI 原生统一上下文层（核心补充设计）

### 11.1 问题：当前衔接不够紧密

```
当前痛点：
  用户问 AI 助手 "上周跟腾讯云讨论的方案进展"
  → ADP 模式：直接发消息，AI 不知道本地有什么 → 回答"无法获取信息"
  → LLM 模式：需手动选择文件/记忆作为附件 → 操作繁琐
  → CC 模式：只有 CLAUDE.md 全量注入 → 噪声大，相关内容可能被淹没
```

### 11.2 目标：每次对话自动注入语义相关上下文

```
整合后：
  用户问 AI 助手 "上周跟腾讯云讨论的方案进展"
  → 统一上下文层拦截请求
  → 向量检索: "腾讯云" + "方案" + "讨论" + "进展"
  → 命中: 记事本"周三和腾讯云团队讨论容器编排迁移方案"(score:0.89)
         记忆"腾讯云客户偏好私有化部署"(score:0.82)
         待办"跟进腾讯云容器方案报价"(score:0.75)
  → 自动注入到 ADP/LLM/CC 的 system prompt 或前置消息
  → AI 回答："根据您的记事本记录，上周三与腾讯云团队讨论了容器编排迁移方案..."
```

### 11.3 统一上下文层架构

```
┌──────────────────────────────────────────────────────────┐
│                    用户发送消息                            │
│  (ADP Agent / LLM 模式 / CC 模式 / 定时AI任务)            │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│              UnifiedContextLayer (新增)                    │
│                                                          │
│  Step 1: 快速意图检测（规则优先，≤1ms）                    │
│    - 是否包含疑问词？→ 需要检索                            │
│    - 是否包含人名/项目名？→ 精确+语义双重检索              │
│    - 是否闲聊/问候？→ 跳过检索                             │
│                                                          │
│  Step 2: 向量检索（异步并行，≤50ms）                      │
│    ┌─────────┬─────────┬─────────┬─────────┐             │
│    │ notes   │ memories│ tasks   │knowledge│             │
│    │ Top-3   │ Top-3   │ Top-2   │ Top-2   │             │
│    └────┬────┴────┬────┴────┬────┴────┬────┘             │
│         └────────┴────────┴────────┘                     │
│                    │                                     │
│  Step 3: 上下文组装（智能截断，控制Token）                 │
│    - 总 Token 预算: 2000 tokens                           │
│    - 分配: 笔记40% + 记忆30% + 待办15% + 知识15%          │
│    - 按 score 降序截取                                    │
│                                                          │
│  Step 4: 注入到请求                                       │
│    - ADP 模式 → SystemRole 字段                           │
│    - LLM 模式 → messages[0] system message               │
│    - CC 模式 → CLAUDE.md 动态追加段                       │
│    - 定时任务 → systemRole 参数                           │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│              AI 执行（ADP/LLM/CC）                         │
│    收到: 用户消息 + [自动注入的相关上下文]                  │
└──────────────────────────────────────────────────────────┘
```

### 11.4 各模式注入实现

#### 11.4.1 ADP Agent 模式

```javascript
// main.js — sendADPMessage 改造

ipcMain.handle('adp:send-message', async (event, { message, appKey, ...options }) => {
  let systemRole = options.systemRole || '';

  // 🆕 统一上下文层：自动检索相关本地数据
  if (unifiedContextLayer && message) {
    const contextResult = await unifiedContextLayer.retrieve(message, {
      mode: 'adp',
      excludeExpert: options._expertMode, // 专家模式不注入（专家有自己的上下文）
    });
    if (contextResult.context) {
      systemRole = systemRole
        ? `${systemRole}\n\n${contextResult.context}`
        : contextResult.context;
    }
    // 记录注入了哪些来源（用于前端展示"已引用X条记忆"）
    event.sender.send('context:sources', contextResult.sources);
  }

  // 原有 ADP 调用逻辑...
  return await callADPSSE({ message, appKey, systemRole, ...options });
});
```

#### 11.4.2 LLM 模式

```javascript
// main.js — callAI 改造

async function callAI({ module, category, messages, ...options }) {
  // 🆕 统一上下文层：为 LLM 模式自动注入
  if (messages.length > 0) {
    const lastUserMsg = messages.findLast(m => m.role === 'user');
    if (lastUserMsg && unifiedContextLayer) {
      const contextResult = await unifiedContextLayer.retrieve(
        typeof lastUserMsg.content === 'string' ? lastUserMsg.content : '',
        { mode: 'llm', module }
      );
      if (contextResult.context) {
        // 注入到 system message
        const systemIdx = messages.findIndex(m => m.role === 'system');
        if (systemIdx !== -1) {
          messages[systemIdx].content += '\n\n' + contextResult.context;
        } else {
          messages.unshift({ role: 'system', content: contextResult.context });
        }
      }
    }
  }

  // 原有 callAI 逻辑...
}
```

#### 11.4.3 CC 模式

```javascript
// main.js — ccInvoke 改造

ipcMain.handle('cc:invoke', async (event, { message, ...options }) => {
  // 🆕 统一上下文层：CC 模式精准注入（替代全量CLAUDE.md）
  let dynamicContext = '';
  if (unifiedContextLayer && message) {
    const contextResult = await unifiedContextLayer.retrieve(message, {
      mode: 'cc',
      workdir: options.workdir,
      topK: 5,         // CC 模式精简注入
      tokenBudget: 1000, // 限制 Token 避免 CC 上下文过长
    });
    dynamicContext = contextResult.context || '';
  }

  // 构建 system prompt = CLAUDE.md（静态）+ 动态上下文（向量检索）
  let systemPrompt = await buildCCSystemPrompt(options.workdir);
  if (dynamicContext) {
    systemPrompt += `\n\n## 当前对话相关上下文（自动检索）\n${dynamicContext}\n`;
  }

  // 原有 CC 调用逻辑...
});
```

#### 11.4.4 定时 AI 任务

```javascript
// app-ai-tasks.js — _executeAITask 改造

async _executeAITask(task) {
  // 🆕 统一上下文层：定时任务也自动注入
  let localContextSystemRole = '';
  if (window.electronAPI?.vectorRetrieveRAG) {
    const result = await window.electronAPI.vectorRetrieveRAG({
      query: task.title, // 用任务标题作为检索 query
      intent: { need_notebook: true, need_memory: true, need_tasks: true },
      mode: 'scheduled_task',
    });
    if (result.success) {
      localContextSystemRole = result.context;
    }
  }
  // 降级到原有逻辑
  if (!localContextSystemRole) {
    localContextSystemRole = await this._buildAITaskLocalContext(task);
  }

  await this.sendAIMessage(undefined, { systemRole: localContextSystemRole });
}
```

### 11.5 前端展示：上下文来源透明化

```javascript
// 前端监听注入的上下文来源，展示给用户
// 让用户知道 AI "参考了哪些数据"

electronAPI.onContextSources((sources) => {
  // sources = [
  //   { source: 'notes', title: '周三和腾讯云团队讨论容器编排迁移方案', score: 0.89 },
  //   { source: 'memories', title: '腾讯云客户偏好私有化部署', score: 0.82 },
  //   { source: 'tasks', title: '跟进腾讯云容器方案报价', score: 0.75 },
  // ]

  // 在 AI 回复消息上方显示引用来源
  const contextBadge = document.createElement('div');
  contextBadge.className = 'context-sources-badge';
  contextBadge.innerHTML = `
    <span class="context-sources-label">📚 已参考 ${sources.length} 条本地数据：</span>
    ${sources.map(s => `
      <span class="context-source-chip" data-source="${s.source}" data-id="${s.id}"
            title="相关度: ${Math.round(s.score * 100)}%">
        ${this._getSourceIcon(s.source)} ${this.escapeHtml(s.title.substring(0, 20))}
      </span>
    `).join('')}
  `;
  // 插入到助手消息前
  chatMessages.insertBefore(contextBadge, assistantMessage);
});
```

### 11.6 意图检测：何时跳过检索

```javascript
// UnifiedContextLayer — 快速意图检测

_shouldRetrieve(message) {
  if (!message || message.length < 5) return false;

  // 跳过检索的场景
  const skipPatterns = [
    /^(你好|hi|hello|hey|在吗|在不在)/i,           // 问候
    /^(谢谢|感谢|thanks|ok|好的|收到)/i,           // 应答
    /^(哈哈|呵呵|嗯|哦|啊)/i,                       // 语气词
  ];
  if (skipPatterns.some(p => p.test(message.trim()))) return false;

  // 需要检索的信号
  const retrieveSignals = [
    /[?？]/,                    // 问号
    /怎么|如何|什么|为什么|哪里|哪个|谁/i,  // 疑问词
    /上次|最近|之前|之前说的|那个/i,       // 时间引用
    /进展|状态|进度|结果|反馈/i,           // 状态查询
    /找|搜索|查|查看|看看/i,              // 查询意图
  ];

  return retrieveSignals.some(p => p.test(message));
}
```

### 11.7 Token 预算控制

```javascript
// 不同模式的 Token 预算
const TOKEN_BUDGETS = {
  adp: 2000,       // ADP 模式预算充足
  llm: 1500,       // LLM 模式适中
  cc: 1000,        // CC 模式精简（CC 本身有 CLAUDE.md）
  scheduled: 1500, // 定时任务适中
  clipboard: 500,  // 剪贴板分析精简
};

// 按来源分配预算
const SOURCE_WEIGHTS = {
  notes: 0.35,      // 笔记最常被引用
  memories: 0.30,   // 记忆次之
  tasks: 0.15,      // 待办
  knowledge: 0.15,  // 知识原子
  profile: 0.05,    // 画像（简短）
};
```

---

## 十二、Prompt 优化器审计日志（补充设计）

### 12.1 问题

当前 `prompt_optimizer.js` 运行后只写 `candidates/*.report.json` 文件，不记录到审计日志系统，用户无法在审计面板中查看优化前后的变化。

### 12.2 方案：新增 `prompt_optimization` 审计类别

```javascript
// scripts/prompt_optimizer.js — main() 函数增加审计日志

async function main() {
  // ... 现有逻辑 ...

  const oldEval = await evaluateOnBadCases(currentPrompt.content, testSet);
  const optimization = await generateNewPrompt(currentPrompt, trainSet);
  const newEval = await evaluateOnBadCases(optimization.new_prompt_full, testSet);
  const improvement = newEval.rate - oldEval.rate;

  // 🆕 写入审计日志
  const auditRecord = {
    module: 'prompt_optimization',           // 新增审计类别
    action: 'optimize',
    input: {
      prompt_module: opts.module,             // task_recognition / memory_extraction
      old_version: currentPrompt.version,
      bad_cases_count: badCases.length,
      train_size: trainSet.length,
      test_size: testSet.length,
      old_pass_rate: oldEval.rate,
    },
    output: {
      new_version: newVersion,
      new_pass_rate: newEval.rate,
      improvement: improvement,               // 通过率提升
      version_bump: optimization.version_bump,
      failure_patterns: optimization.failure_patterns,  // 识别的失败模式
      improvements: optimization.improvements,           // 具体改进项
      expected_improvements: optimization.expected_improvements,
      applied: improvement >= 0.05 && opts.autoApply,   // 是否已应用
    },
    tokens: { /* optimizer API 调用的 token 消耗 */ },
    latencyMs: totalTime,
    timestamp: new Date().toISOString(),
  };

  // 写入审计日志文件（与现有审计日志格式一致）
  const auditPath = path.join(CONFIG.feedbackDir, '..', 'audit',
    `audit_${new Date().toISOString().slice(0, 10)}.json`);
  appendAuditRecord(auditPath, auditRecord);

  // ... 现有的 candidate 写入逻辑 ...
}
```

### 12.3 审计日志记录格式

```json
{
  "id": "audit_opt_1719148800000_abc123",
  "module": "prompt_optimization",
  "action": "optimize",
  "timestamp": "2026-06-23T12:00:00.000Z",
  "input": {
    "prompt_module": "task_recognition",
    "old_version": "v2.0",
    "bad_cases_count": 30,
    "train_size": 21,
    "test_size": 9,
    "old_pass_rate": 0.67
  },
  "output": {
    "new_version": "v2.1",
    "new_pass_rate": 0.89,
    "improvement": 0.22,
    "version_bump": "minor",
    "failure_patterns": [
      {
        "pattern": "时间词'上午'被解析为下午时间",
        "evidence_cases": [3, 7, 12],
        "root_cause": "Prompt中未明确上午/下午的时间映射规则"
      },
      {
        "pattern": "闲聊被误判为有效信息",
        "evidence_cases": [5, 9],
        "root_cause": "闲聊排除规则不够严格，缺少语气词模式"
      }
    ],
    "improvements": [
      {
        "target_section": "硬性规则",
        "old_text": "时间不绝对明确时normalized为null",
        "new_text": "上午→8:00-11:00, 下午→13:00-17:00...",
        "rationale": "明确时间语义映射，避免AI自由发挥"
      },
      {
        "target_section": "闲聊排除规则",
        "old_text": "社交对话强制is_valid_info=false",
        "new_text": "新增6种闲聊模式（问候/应答/语气词/情绪/泛泛提问/短句疑问）",
        "rationale": "覆盖更多闲聊变体"
      }
    ],
    "expected_improvements": "时间解析准确率提升，闲聊误判减少",
    "applied": true
  },
  "tokens": {
    "optimizer_call": 8200,
    "eval_calls": 4500,
    "total_tokens": 12700
  },
  "latencyMs": 45000
}
```

### 12.4 审计面板展示优化

在审计日志面板的模块筛选下拉中新增 `prompt_optimization` 选项，展示格式：

```
┌──────────────────────────────────────────────────────┐
│ 🔄 Prompt 优化 | task_recognition v2.0 → v2.1        │
│──────────────────────────────────────────────────────│
│ 通过率: 67% → 89% (+22%)  ✅ 已应用                  │
│ Bad Cases: 30条 (训练21/测试9)                        │
│                                                      │
│ 📋 识别的失败模式:                                    │
│  1. 时间词'上午'被解析为下午时间 (3个案例)            │
│  2. 闲聊被误判为有效信息 (2个案例)                    │
│                                                      │
│ 🔧 改进项:                                           │
│  1. [硬性规则] 明确时间语义映射                       │
│  2. [闲聊排除规则] 新增6种闲聊模式                    │
│                                                      │
│ 💡 预期效果: 时间解析准确率提升，闲聊误判减少         │
│ ⏱ 耗时: 45s  📊 Token: 12.7k                        │
└──────────────────────────────────────────────────────┘
```

### 12.5 结合行为的优化增强

```javascript
// 优化器不仅基于 bad cases，还结合用户行为模式

async function loadBehaviorSignals(module) {
  // 从审计日志中提取行为模式
  const auditRecords = await loadAuditRecords({
    module: module.startsWith('task_recognition') ? 'clipboard_analysis' : 'memory_extraction',
    days: 7,
  });

  // 统计行为信号
  const signals = {
    reject_rate: 0,          // 拒绝率
    edit_rate: 0,            // 编辑率（用户修改了AI输出）
    common_reject_reasons: [], // 常见拒绝原因
    common_edit_patterns: [],  // 常见编辑模式
    time_distribution: {},     // 拒绝/编辑的时间分布
  };

  const total = auditRecords.length;
  const rejects = auditRecords.filter(r => r.action === 'reject');
  const edits = auditRecords.filter(r => r.action === 'edit');

  signals.reject_rate = total > 0 ? rejects.length / total : 0;
  signals.edit_rate = total > 0 ? edits.length / total : 0;

  // 提取常见拒绝原因
  const reasonCounts = {};
  rejects.forEach(r => {
    const reason = r.reason || '未分类';
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  });
  signals.common_reject_reasons = Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count, percentage: count / rejects.length }));

  return signals;
}

// 将行为信号注入优化 Prompt
async function generateNewPrompt(currentPrompt, badCases, behaviorSignals) {
  const behaviorSection = behaviorSignals.reject_rate > 0.1
    ? `\n## 用户行为分析（近7天）\n
       - 拒绝率: ${(behaviorSignals.reject_rate * 100).toFixed(1)}%
       - 编辑率: ${(behaviorSignals.edit_rate * 100).toFixed(1)}%
       - 常见拒绝原因:\n${behaviorSignals.common_reject_reasons.map(r => `  • ${r.reason} (${r.count}次, ${r.percentage}%)`).join('\n')}
       \n请重点优化这些高频拒绝场景。`
    : '';

  // 注入到优化 Prompt...
}
```

---

## 十三、记忆激活与利用率提升（补充设计）

### 13.1 问题：记忆利用率低

当前记忆系统的痛点：
1. **写入多，读取少**：记忆不断积累但很少被检索使用
2. **无活跃度追踪**：不知道哪些记忆"有用"哪些"沉睡"
3. **无自动晋升**：短期记忆不会自动晋升为长期记忆
4. **无遗忘机制**：无用记忆永久占据空间和检索噪声

### 13.2 记忆活跃度评分模型

```javascript
// src/services/memoryActivation.js

class MemoryActivationService {
  /**
   * 记忆活跃度评分（0-100）
   * 基于多维信号计算
   */
  calculateScore(memory, context = {}) {
    let score = 0;

    // 1. 检索命中加分（被向量检索命中的记忆 +10/次）
    score += (memory.metadata?.retrievalCount || 0) * 10;

    // 2. 时间衰减（越新分越高）
    const ageDays = (Date.now() - new Date(memory.createdAt).getTime()) / 86400000;
    if (ageDays < 1) score += 30;
    else if (ageDays < 7) score += 20;
    else if (ageDays < 30) score += 10;
    else if (ageDays < 90) score += 5;

    // 3. 用户交互加分（被点击查看/引用 +15/次）
    score += (memory.metadata?.clickCount || 0) * 15;

    // 4. AI 引用加分（被注入到 AI 上下文 +5/次）
    score += (memory.metadata?.injectionCount || 0) * 5;

    // 5. 重要性加权
    const importanceWeight = { high: 1.5, medium: 1.0, low: 0.5 };
    score *= importanceWeight[memory.importance] || 1.0;

    // 6. 记忆类型加权（长期记忆基础分更高）
    const typeBonus = { long: 20, short: 10, instant: 0 };
    score += typeBonus[memory.type] || 0;

    return Math.min(Math.round(score), 100);
  }

  /**
   * 更新记忆的活跃度（在检索命中时调用）
   */
  async onRetrievalHit(memoryIds, query) {
    for (const id of memoryIds) {
      const memory = memoryStore.getById(id);
      if (!memory) continue;

      // 更新活跃度元数据
      memoryStore.updateMemory(id, {
        metadata: {
          ...memory.metadata,
          retrievalCount: (memory.metadata?.retrievalCount || 0) + 1,
          lastRetrievedAt: new Date().toISOString(),
          lastRetrievedQuery: query.substring(0, 100),
        }
      });
    }
  }

  /**
   * 记忆晋升：短期 → 长期
   * 条件：7天内被检索命中 ≥3 次 且 活跃度 ≥ 50
   */
  async checkPromotion() {
    const shortMemories = memoryStore.getMemories({ type: 'short' });
    const now = Date.now();

    for (const memory of shortMemories) {
      const retrievalCount = memory.metadata?.retrievalCount || 0;
      const lastRetrieved = memory.metadata?.lastRetrievedAt;

      if (retrievalCount >= 3 && lastRetrieved) {
        const daysSinceLastRetrieve = (now - new Date(lastRetrieved).getTime()) / 86400000;
        if (daysSinceLastRetrieve <= 7) {
          // 晋升为长期记忆
          memoryStore.updateMemory(memory.id, { type: 'long' });
          console.log(`[MemoryActivation] Promoted memory ${memory.id} to long-term`);

          // 审计记录
          auditLogger.log({
            module: 'memory_activation',
            action: 'promote',
            input: { memory_id: memory.id, old_type: 'short', retrieval_count: retrievalCount },
            output: { new_type: 'long' },
          });
        }
      }
    }
  }

  /**
   * 记忆遗忘：降低沉睡记忆的检索权重
   * 条件：90天未被检索 且 活跃度 < 10
   */
  async checkForgetting() {
    const allMemories = memoryStore.getAllMemories();
    const now = Date.now();

    for (const memory of allMemories) {
      const lastRetrieved = memory.metadata?.lastRetrievedAt || memory.createdAt;
      const daysSinceLastRetrieve = (now - new Date(lastRetrieved).getTime()) / 86400000;

      if (daysSinceLastRetrieve > 90) {
        const score = this.calculateScore(memory);
        if (score < 10) {
          // 标记为"沉睡"状态，检索时降权（不从Zvec删除，但加 dimmed 标记）
          memoryStore.updateMemory(memory.id, {
            metadata: { ...memory.metadata, status: 'dormant' }
          });
          // Zvec 中更新标量字段，检索时可过滤
          await vectorIndex.updateMemoryStatus(memory.id, 'dormant');
        }
      }
    }
  }
}
```

### 13.3 记忆利用率提升策略

```
┌─────────────────────────────────────────────────────────┐
│                   记忆生命周期管理                        │
│                                                         │
│  创建 ──→ 短期记忆 ──→ [检索命中≥3次] ──→ 长期记忆     │
│              │           (7天内)                        │
│              │                                           │
│              └──→ [90天未命中] ──→ 沉睡（降权）         │
│                                   │                     │
│                                   └──→ [180天未命中]   │
│                                        → 归档（移出Zvec）│
│                                                         │
│  每次检索命中:                                           │
│    retrievalCount++ → 活跃度↑ → 检索权重↑              │
│    → 更容易被下次检索命中（正反馈循环）                   │
└─────────────────────────────────────────────────────────┘
```

### 13.4 记忆主动推荐

```javascript
// 不仅仅是被动检索，还要主动推送相关记忆

class MemoryProactiveService {
  /**
   * 场景触发：当用户创建待办/笔记时，主动推荐相关记忆
   */
  async onNoteCreated(note) {
    // 向量检索与新笔记相关的记忆
    const related = await vectorIndex.hybridSearch(note.content, {
      sources: ['memories'],
      topK: 3,
      minScore: 0.7,  // 只推荐高相关度记忆
    });

    if (related.length > 0) {
      // 推送到前端展示
      event.sender.send('memory:proactive-recommendation', {
        trigger: 'note_created',
        triggerId: note.id,
        memories: related.map(r => ({
          id: r.id,
          content: r.content,
          score: r.score,
          relation: `与新笔记"${note.title}"相关`,
        })),
      });
    }
  }

  /**
   * 场景触发：当用户开始 AI 对话时，主动推送近期热点记忆
   */
  async onAIConversationStart() {
    // 获取最近7天检索频率最高的记忆（热点记忆）
    const hotMemories = memoryStore.getMemories({
      limit: 5,
      sortBy: 'retrievalCount',
      timeRange: '7d',
    });

    if (hotMemories.length > 0) {
      event.sender.send('memory:hot-topics', {
        memories: hotMemories.map(m => ({
          id: m.id,
          content: m.content.substring(0, 80),
          retrievalCount: m.metadata?.retrievalCount || 0,
        })),
      });
    }
  }
}
```

### 13.5 记忆利用率指标

```javascript
// 在设置页面展示记忆利用率仪表盘

async getMemoryUtilizationStats() {
  const allMemories = memoryStore.getAllMemories();
  const total = allMemories.length;

  const retrieved = allMemories.filter(m => (m.metadata?.retrievalCount || 0) > 0);
  const dormant = allMemories.filter(m => m.metadata?.status === 'dormant');
  const longTerm = allMemories.filter(m => m.type === 'long');

  return {
    total,
    utilizationRate: total > 0 ? retrieved.length / total : 0,  // 利用率
    dormantRate: total > 0 ? dormant.length / total : 0,        // 沉睡率
    longTermRate: total > 0 ? longTerm.length / total : 0,      // 长期化率
    avgRetrievalCount: total > 0
      ? allMemories.reduce((sum, m) => sum + (m.metadata?.retrievalCount || 0), 0) / total
      : 0,
    topRetrieved: allMemories
      .sort((a, b) => (b.metadata?.retrievalCount || 0) - (a.metadata?.retrievalCount || 0))
      .slice(0, 5)
      .map(m => ({
        content: m.content.substring(0, 50),
        count: m.metadata?.retrievalCount || 0,
      })),
  };
}
```

---

## 十四、整体 AI 原生架构总览

### 14.1 AI 赋能的全景图

```
┌─────────────────────────────────────────────────────────────┐
│                    Memora AI 原生架构                        │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              统一上下文层 (UnifiedContextLayer)       │   │
│  │  自动为每次 AI 调用检索并注入语义相关上下文            │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                   │
│  ┌──────────┬───────────┼───────────┬──────────────────┐   │
│  │ ADP Agent│  LLM 模式  │  CC 模式  │  定时AI任务      │   │
│  │ 自动注入 │  自动注入  │  自动注入  │  自动注入        │   │
│  └──────────┴───────────┴───────────┴──────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              向量数据库 (Zvec)                        │   │
│  │  notes_vec | memories_vec | tasks_vec | knowledge_vec│   │
│  │  混合检索: 向量语义 + FTS关键词 + 标量过滤            │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                   │
│  ┌──────────┬───────────┼───────────┬──────────────────┐   │
│  │ 记事本   │  记忆系统  │  待办任务  │  知识图谱        │   │
│  │ 自动索引 │  活跃度管理│  自动索引  │  语义聚类        │   │
│  │ 异步队列 │  晋升/遗忘 │  异步队列  │  自动发现        │   │
│  └──────────┴───────────┴───────────┴──────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              AI 自我进化层                            │   │
│  │  Prompt 优化器 → 审计日志 → 行为分析 → 反馈闭环       │   │
│  │  记忆激活 → 正反馈循环 → 利用率提升                   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 14.2 AI 原生的六大原则

| 原则 | 实现 | 状态 |
|------|------|------|
| **1. 自动感知** | 剪贴板检测 → AI 分析 → 自动创建任务/笔记 | ✅ 已有 |
| **2. 自动检索** | 统一上下文层 → 向量检索 → 自动注入上下文 | 🆕 本方案 |
| **3. 自动进化** | Prompt 优化器 → 行为分析 → 审计日志 → 反馈闭环 | 🆕 增强 |
| **4. 自动激活** | 记忆活跃度评分 → 晋升/遗忘 → 正反馈循环 | 🆕 本方案 |
| **5. 全模式覆盖** | ADP/LLM/CC/定时任务 统一注入上下文 | 🆕 本方案 |
| **6. 透明可观测** | 上下文来源展示 + 审计日志 + 利用率仪表盘 | 🆕 本方案 |

### 14.3 数据流全景

```
用户操作                          AI 调用                        自我进化
─────────                        ────────                       ────────
创建笔记 ──→ 异步入队 ──→ Zvec索引    用户提问 ──→ 统一上下文层 ──→ 向量检索    用户反馈 ──→ 审计日志
创建记忆 ──→ 异步入队 ──→ Zvec索引                │              │           │
创建待办 ──→ 异步入队 ──→ Zvec索引                ├─→ ADP 注入   │           ├─→ Prompt 优化器
                                                  ├─→ LLM 注入   │           │
记忆检索 ──→ 活跃度++ ──→ 正反馈                  ├─→ CC 注入    │           ├─→ 行为分析
                                                  └─→ 定时任务   │           │
                                                                ▼           ▼
记忆晋升 ──→ 短期→长期 ──→ 权重↑               AI 回答 + 上下文来源展示    优化后 Prompt
                                                                │           │
记忆遗忘 ──→ 90天未用 ──→ 降权                     用户交互      ▼           ▼
                                                  点击/删除/编辑 → 反馈记录 → 下次优化
```

---

## 十五、更新后的实施计划

### Phase 1：向量基础设施 + 异步队列（1.5 周）

| 任务 | 说明 |
|------|------|
| zvec 安装 + Collection 初始化 | 4 个 Collection |
| EmbeddingService（火山引擎+DeepSeek） | 双通道 + 缓存 |
| **VectorizationQueue（异步队列）** | 批量处理 + 重试 + 去重 |
| VectorIndexManager CRUD | upsert/delete/hybridSearch |
| 全量索引构建 + 启动时一致性检查 | 差异检测 + 增量补全 |

### Phase 2：统一上下文层（1 周）

| 任务 | 说明 |
|------|------|
| **UnifiedContextLayer** | 意图检测 + 向量检索 + 上下文组装 |
| **ADP 模式注入** | sendADPMessage 改造 |
| **LLM 模式注入** | callAI 改造 |
| **CC 模式注入** | ccInvoke 改造 |
| **定时任务注入** | _executeAITask 改造 |
| 前端上下文来源展示 | 引用来源 badge |
| Token 预算控制 | 按模式分配 + 按来源加权 |

### Phase 3：搜索 + RAG 整合（3 天）

| 任务 | 说明 |
|------|------|
| 记事本语义搜索 | 替换 searchNotes() |
| 记忆语义搜索 | 替换 searchRelated() |
| RAG 上下文检索 | 替换 retrieveContext() |
| 降级策略 | API→本地BGE→FTS |

### Phase 4：记忆激活 + 审计增强（1 周）

| 任务 | 说明 |
|------|------|
| **MemoryActivationService** | 活跃度评分 + 晋升 + 遗忘 |
| **记忆主动推荐** | 笔记创建/对话开始时推送 |
| **记忆利用率仪表盘** | 设置页面展示利用率指标 |
| **Prompt 优化器审计日志** | 新增 prompt_optimization 类别 |
| **行为信号注入优化器** | 拒绝率/编辑模式分析 |
| 审计面板展示优化 | 优化记录可视化 |

**总工时：约 4 周**（较原方案增加 1.5 周，涵盖统一上下文层 + 记忆激活 + 审计增强）

---

## 十六、向量数据与原始数据的关联追溯（补充设计）

### 16.1 问题

用户在 AI 对话中看到 AI 引用了本地数据，但无法知道：
- 具体引用了哪条笔记/记忆/待办？
- 这些原始数据在哪里可以查看？
- AI 回答中的某段话是基于哪条数据得出的？
- 向量库里存的和原始数据是否一致？

### 16.2 关联链路设计

```
┌──────────┐    ID 映射     ┌──────────┐    检索命中    ┌──────────────┐
│ 原始数据  │◄─────────────│ Zvec 向量 │◄─────────────│ AI 对话上下文 │
│ (JSON/DB)│   note_id 等   │ (向量库)  │   score+id    │ (注入来源)    │
└──────────┘                └──────────┘                └──────────────┘
      │                                                      │
      │              完整可追溯链路                            │
      └──────────────────────────────────────────────────────┘
                      用户可点击溯源
```

### 16.3 三层关联机制

#### 第一层：ID 绑定（向量 → 原始数据）

每条向量记录通过**原始 ID 字段**绑定到源数据：

| Zvec Collection | ID 字段 | 原始数据源 | 关联方式 |
|-----------------|---------|-----------|---------|
| notes_vec | `note_id` | notebook.notes[].id | 精确匹配 |
| memories_vec | `memory_id` | memoryStore.memories[].id | 精确匹配 |
| tasks_vec | `task_id` | Store.tasks[].id | 精确匹配 |
| knowledge_vec | `atom_id` | knowledgeStore.atoms[].id | 精确匹配 |

```javascript
// 向量记录示例 — notes_vec 中的一条数据
{
  id: "note_1719148800000_abc123",     // Zvec 内部 ID（自动生成）
  vectors: { embedding: [0.12, 0.34, ...] },  // 2048维向量
  fields: {
    note_id: "1719148800000-abc123",    // 🔑 关联原始笔记的 ID
    title: "周三和腾讯云团队讨论容器编排迁移方案",
    content: "周三下午和腾讯云团队...",  // 截断内容（FTS用）
    category: "meeting",
    created_at: 1719148800000,
    // 🆕 追溯元数据
    source_type: "notebook",            // 数据来源类型
    source_collection: "notes",         // 原始数据集合名
    vectorized_at: "2026-06-23T12:00:00Z", // 向量化时间
    content_hash: "a3f2e1...",          // 内容哈希（检测内容是否变更）
  }
}
```

#### 第二层：来源引用（AI 上下文 → 向量记录）

统一上下文层检索后，每条命中结果携带完整的**来源引用信息**：

```javascript
// UnifiedContextLayer.retrieve() 返回值

{
  context: "【相关笔记】\n1. 周三和腾讯云团队讨论容器编排迁移方案...\n\n【相关记忆】\n1. 腾讯云客户偏好私有化部署...",
  sources: [
    {
      // 🔑 完整追溯信息
      trace_id: "ctx_1719148800000_xyz",     // 本次检索的唯一追踪ID
      source_type: "notebook",                 // 数据来源：记事本
      source_id: "1719148800000-abc123",      // 原始笔记 ID
      vector_id: "note_1719148800000_abc123", // Zvec 中的向量记录 ID
      collection: "notes_vec",                // Zvec Collection 名
      title: "周三和腾讯云团队讨论容器编排迁移方案",
      content_preview: "周三下午和腾讯云团队讨论了K8s容器编排迁移方案，涉及...",
      score: 0.89,                            // 向量相似度分数
      match_type: "hybrid",                   // 匹配类型：vector/fts/hybrid
      created_at: "2026-06-20T14:00:00Z",    // 原始数据创建时间
      metadata: {
        category: "meeting",
        tags: ["腾讯云", "K8s"],
      }
    },
    {
      trace_id: "ctx_1719148800000_xyz",
      source_type: "memory",
      source_id: "mem_1719200000000_def",
      vector_id: "mem_1719200000000_def",
      collection: "memories_vec",
      title: "腾讯云客户偏好私有化部署",
      content_preview: "腾讯云团队倾向于私有化部署方案...",
      score: 0.82,
      match_type: "vector",
      created_at: "2026-06-21T10:00:00Z",
      metadata: {
        memory_type: "short",
        category: "customer",
      }
    }
  ],
  retrieval_meta: {
    query: "上周跟腾讯云讨论的方案进展",
    query_embedding_time: 45,     // 向量化耗时 ms
    search_time: 12,              // 检索耗时 ms
    total_time: 57,               // 总耗时 ms
    token_count: 350,             // 注入上下文的 Token 数
    mode: "adp",                  // 当前 AI 模式
  }
}
```

#### 第三层：对话内引用（AI 回答 → 原始数据）

AI 回答中通过**内联引用标记**关联到具体来源：

```javascript
// 注入到 AI 的 system prompt 中的上下文格式

const contextWithRefs = `
【本地相关知识】
以下信息从你的记事本和记忆中检索得到，请在回答时引用对应的来源编号：

[1] 📝 笔记 | "周三和腾讯云团队讨论容器编排迁移方案"
    内容：周三下午和腾讯云团队讨论了K8s容器编排迁移方案，涉及Pod调度、服务发现...
    时间：2026-06-20 14:00 | 分类：会议

[2] 🧠 记忆 | "腾讯云客户偏好私有化部署"
    内容：腾讯云团队倾向于私有化部署方案，对公有云接入有安全顾虑...
    时间：2026-06-21 10:00 | 类型：短期记忆

[3] ✅ 待办 | "跟进腾讯云容器方案报价"
    内容：本周内跟进腾讯云容器编排迁移方案的报价单...
    时间：2026-06-22 09:00 | 优先级：高

请在回答时使用 [1][2][3] 这样的引用标记，让用户知道信息来源。
`
```

### 16.4 前端展示：三层可追溯 UI

#### 层级 1：对话消息上方的来源 Badge

```
┌──────────────────────────────────────────────────────────┐
│ 📚 已参考 3 条本地数据                                    │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐         │
│ │📝 笔记 89%  │ │🧠 记忆 82%  │ │✅ 待办 75%  │         │
│ └─────────────┘ └─────────────┘ └─────────────┘         │
│ 点击查看详情 · 相关度由高到低排序                         │
├──────────────────────────────────────────────────────────┤
│ 🤖 AI 助手                                               │
│                                                          │
│ 根据您的记录，上周三您与腾讯云团队讨论了容器编排迁移方案   │
│ [1]。讨论涉及 Pod 调度和服务发现等技术细节。              │
│                                                          │
│ 腾讯云团队倾向于私有化部署方案 [2]，因此您可能需要准备     │
│ 私有化部署的相关材料。                                    │
│                                                          │
│ 另外，您有一个待办任务是跟进报价单 [3]，建议本周内完成。   │
└──────────────────────────────────────────────────────────┘
```

#### 层级 2：点击来源 Badge 展开的详情面板

```
┌──────────────────────────────────────────────────────────┐
│ 📚 引用来源详情                              ✕          │
│──────────────────────────────────────────────────────────│
│                                                          │
│ 📝 [1] 笔记 · 相关度 89% · 向量+FTS混合匹配              │
│ ┌────────────────────────────────────────────────────┐  │
│ │ 标题：周三和腾讯云团队讨论容器编排迁移方案           │  │
│ │ 时间：2026-06-20 14:00                              │  │
│ │ 分类：会议                                          │  │
│ │ 内容：周三下午和腾讯云团队讨论了K8s容器编排迁移      │  │
│ │ 方案，涉及Pod调度、服务发现...                      │  │
│ │                                                     │  │
│ │ [📍 在记事本中查看] [📋 复制内容]                   │  │
│ └────────────────────────────────────────────────────┘  │
│                                                          │
│ 🧠 [2] 记忆 · 相关度 82% · 向量匹配                      │
│ ┌────────────────────────────────────────────────────┐  │
│ │ 内容：腾讯云团队倾向于私有化部署方案...              │  │
│ │ 时间：2026-06-21 10:00                              │  │
│ │ 类型：短期记忆                                      │  │
│ │                                                     │  │
│ │ [📍 在记忆管理中查看] [📋 复制内容]                 │  │
│ └────────────────────────────────────────────────────┘  │
│                                                          │
│ ✅ [3] 待办 · 相关度 75% · 向量匹配                      │
│ ┌────────────────────────────────────────────────────┐  │
│ │ 标题：跟进腾讯云容器方案报价                         │  │
│ │ 时间：2026-06-22 09:00                              │  │
│ │ 优先级：高                                          │  │
│ │                                                     │  │
│ │ [📍 在待办列表中查看] [✅ 标记完成]                 │  │
│ └────────────────────────────────────────────────────┘  │
│                                                          │
│ 🔍 检索信息：查询"上周跟腾讯云讨论的方案进展"            │
│    向量化 45ms · 检索 12ms · 总计 57ms · 注入 350 tokens │
└──────────────────────────────────────────────────────────┘
```

#### 层级 3：AI 回答中的内联引用跳转

```javascript
// AI 回答文本中的 [1][2][3] 标记渲染为可点击的引用链接

function renderAIResponseWithCitations(html, sources) {
  // 将 [1] [2] [3] 替换为可点击的引用标记
  return html.replace(/\[(\d+)\]/g, (match, num) => {
    const idx = parseInt(num) - 1;
    const source = sources[idx];
    if (!source) return match;

    const icon = {
      notebook: '📝', memory: '🧠', tasks: '✅', knowledge: '📚'
    }[source.source_type] || '📌';

    return `<sup class="citation-ref" 
      data-source-type="${source.source_type}"
      data-source-id="${source.source_id}"
      data-score="${source.score}"
      title="${source.title} (${Math.round(source.score * 100)}%)"
      onclick="App.showCitationDetail(${idx})">
      ${icon}[${num}]
    </sup>`;
  });
}
```

渲染效果：AI 回答中的 `[1]` 变成上标 `📝[1]`，鼠标 hover 显示标题和相关度，点击跳转到来源详情。

### 16.5 来源数据一致性校验

```javascript
// 向量数据与原始数据的一致性保障

class ConsistencyChecker {
  /**
   * 检查向量索引中的 note_id 是否在原始数据中存在
   * 原始数据被删除但向量未删除时 → 清理孤儿向量
   */
  async checkOrphanVectors() {
    const orphanIds = [];

    // 检查 notes_vec
    const allNoteVectors = await vectorIndex.collections.notes.getAll();
    for (const vec of allNoteVectors) {
      const note = notebook.getNoteById(vec.fields.note_id);
      if (!note) {
        // 原始笔记已删除，清理孤儿向量
        orphanIds.push({ collection: 'notes', id: vec.id, source_id: vec.fields.note_id });
        await vectorIndex.delete('notes', vec.fields.note_id);
      }
    }

    // 检查 content_hash 变更
    for (const vec of allNoteVectors) {
      const note = notebook.getNoteById(vec.fields.note_id);
      if (note) {
        const currentHash = this._hash(`${note.title} ${note.content}`);
        if (vec.fields.content_hash !== currentHash) {
          // 内容已变更，需要重新向量化
          await vectorIndex.upsertNote(note);
          console.log(`[Consistency] Re-vectorized note ${note.id} (content changed)`);
        }
      }
    }

    return { orphanCount: orphanIds.length, orphans: orphanIds };
  }

  /**
   * 检查原始数据中未被向量化的条目
   */
  async checkMissingVectors() {
    const missing = [];

    const allNotes = notebook.getAllNotes();
    for (const note of allNotes) {
      const exists = await vectorIndex.exists('notes', note.id);
      if (!exists) {
        missing.push({ collection: 'notes', id: note.id });
        // 自动补全
        await vectorIndex.upsertNote(note);
      }
    }

    return { missingCount: missing.length, missing };
  }
}
```

### 16.6 引用溯源 IPC 通道

| 通道 | 方向 | 参数 | 说明 |
|------|------|------|------|
| `vector:get-source` | 渲染→主 | `{ source_type, source_id }` | 根据 source_type + source_id 获取完整原始数据 |
| `vector:navigate-to` | 渲染→主 | `{ source_type, source_id }` | 跳转到原始数据所在页面并高亮（如跳转到记事本并选中该笔记） |
| `vector:check-consistency` | 渲染→主 | — | 一致性检查（孤儿向量 + 缺失向量） |
| `context:get-trace` | 渲染→主 | `{ trace_id }` | 根据追踪ID获取完整的检索→注入链路 |

```javascript
// 跳转到原始数据所在页面

ipcMain.handle('vector:navigate-to', async (event, { source_type, source_id }) => {
  switch (source_type) {
    case 'notebook':
      // 切换到记事本页面，选中并滚动到该笔记
      event.sender.send('navigate', { view: 'notebook', highlightNoteId: source_id });
      break;
    case 'memory':
      // 切换到记忆管理页面，高亮该记忆
      event.sender.send('navigate', { view: 'memory', highlightMemoryId: source_id });
      break;
    case 'tasks':
      // 切换到日历/待办页面，高亮该任务
      event.sender.send('navigate', { view: 'calendar', highlightTaskId: source_id });
      break;
    case 'knowledge':
      // 切换到知识图谱页面，聚焦该节点
      event.sender.send('navigate', { view: 'knowledge', focusAtomId: source_id });
      break;
  }
  return { success: true };
});
```

### 16.7 审计日志中的引用记录

每次 AI 对话注入上下文时，同时在审计日志中记录完整的引用链路：

```json
{
  "id": "audit_ctx_1719148800000",
  "module": "unified_context",
  "action": "inject",
  "timestamp": "2026-06-23T12:00:00Z",
  "trace_id": "ctx_1719148800000_xyz",
  "input": {
    "user_message": "上周跟腾讯云讨论的方案进展",
    "ai_mode": "adp",
    "query_embedding_time_ms": 45,
    "search_time_ms": 12
  },
  "output": {
    "sources_injected": 3,
    "token_count": 350,
    "sources": [
      {
        "source_type": "notebook",
        "source_id": "1719148800000-abc123",
        "title": "周三和腾讯云团队讨论容器编排迁移方案",
        "score": 0.89,
        "match_type": "hybrid"
      },
      {
        "source_type": "memory",
        "source_id": "mem_1719200000000_def",
        "title": "腾讯云客户偏好私有化部署",
        "score": 0.82,
        "match_type": "vector"
      },
      {
        "source_type": "tasks",
        "source_id": "task_1719220000000_ghi",
        "title": "跟进腾讯云容器方案报价",
        "score": 0.75,
        "match_type": "vector"
      }
    ]
  },
  "latencyMs": 57
}
```

用户可在审计面板按 `unified_context` 模块筛选，查看每次 AI 对话引用了哪些原始数据，形成完整的**"问→检索→引用→答"**可追溯链路。

---

## 十七、借鉴优秀智能体平台的设计经验

> 研究了 Claude Code、Hermes Agent、OpenClaw、WorkBuddy、CodeBuddy 等平台的设计模式，提炼出以下可借鉴的设计补充到本方案中。

### 17.1 借鉴 WorkBuddy：渐进式上下文加载（Progressive Disclosure）

**WorkBuddy 模式**：Skill 系统采用三级加载——Level 1 始终在上下文（name+description ~100词），Level 2 触发时加载（SKILL.md body <5k词），Level 3 按需加载（scripts/assets 无限制）。

**借鉴到向量检索**：当前设计是一次性检索+注入完整内容，改为三级渐进加载：

```javascript
// UnifiedContextLayer — 渐进式上下文加载

class ProgressiveContextLoader {
  /**
   * Level 1: 轻量索引（始终加载，~20 tokens/条）
   * 只返回 title + score + source_type，注入到 system prompt 的"可用知识列表"
   * AI 可以知道"有哪些相关知识可用"，但不占用大量 Token
   */
  async loadIndex(query, topK = 10) {
    const results = await vectorIndex.hybridSearch(query, { topK, fields: ['title'] });
    return results.map(r => ({
      ref_id: r.id,
      title: r.title,
      source_type: r.source_type,
      score: r.score,
    }));
    // 注入格式: "可参考的本地知识: [1]📝 腾讯云容器方案讨论(89%) [2]🧠 客户偏好(82%)..."
  }

  /**
   * Level 2: 摘要加载（AI 主动请求或自动注入 Top-3，~100 tokens/条）
   * 返回 title + content_preview(前200字)
   */
  async loadSummary(refIds) {
    const items = await vectorIndex.getByIds(refIds);
    return items.map(item => ({
      ...item,
      content_preview: item.content.substring(0, 200),
    }));
  }

  /**
   * Level 3: 完整加载（AI 通过工具调用按需获取，无 Token 限制）
   * AI 判断需要完整内容时，调用 search_local_knowledge 工具
   */
  async loadFull(refId) {
    const item = await vectorIndex.getById(refId);
    // 从原始数据源获取完整内容（非截断）
    return this._getOriginalData(item.source_type, item.source_id);
  }
}
```

**效果**：日常对话只注入 Level 1（~200 tokens），AI 需要深入时自动升级到 Level 2/3，Token 消耗降低 60%+。

### 17.2 借鉴 Claude Code：向量检索即工具（Agent-as-Tool）

**Claude Code 模式**：Agent 通过 tool_use 循环迭代调用工具（Read/Write/Bash/Grep/Glob/WebSearch），Agent 自主决定何时调用什么工具。

**借鉴到向量检索**：除了"预注入"模式，还将向量检索暴露为**Agent 可调用的工具**，让 AI 自主决定何时搜索：

```javascript
// 将向量搜索注册为 MCP 工具 / CC 工具 / ADP 工具

const vectorSearchTool = {
  name: 'search_local_knowledge',
  description: `搜索用户的本地知识库（笔记、记忆、待办、知识原子）。
    当你需要引用用户的历史记录、查找相关项目信息、回忆之前的讨论时调用。
    支持语义搜索——即使用词不同也能找到相关内容。`,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索查询（自然语言）' },
      sources: {
        type: 'array',
        items: { type: 'string', enum: ['notes', 'memories', 'tasks', 'knowledge'] },
        description: '要搜索的数据源（默认全部）',
      },
      limit: { type: 'integer', description: '返回条数（默认5）' },
    },
    required: ['query'],
  },

  async execute({ query, sources, limit = 5 }) {
    const results = await unifiedContextLayer.retrieve(query, {
      sources,
      topK: limit,
      mode: 'tool_call',
    });
    return {
      results: results.sources.map(s => ({
        title: s.title,
        content: s.content_preview,
        source_type: s.source_type,
        source_id: s.source_id,
        score: s.score,
        created_at: s.created_at,
      })),
      retrieval_info: results.retrieval_meta,
    };
  },
};

// CC 模式：注册为 CC 工具
const localDataTool = {
  name: 'search_memora',
  description: '搜索 Memora 本地数据（笔记/记忆/待办/知识），支持语义搜索',
  inputSchema: { /* 同上 */ },
};

// ADP 模式：通过 MCP Server 暴露
// src/mcp/vector-search-server.js
class VectorSearchMCPServer {
  tools() {
    return [vectorSearchTool, {
      name: 'get_local_data_detail',
      description: '根据 source_type 和 source_id 获取完整的本地数据',
      inputSchema: {
        type: 'object',
        properties: {
          source_type: { type: 'string' },
          source_id: { type: 'string' },
        },
        required: ['source_type', 'source_id'],
      },
      async execute({ source_type, source_id }) {
        return await progressiveLoader.loadFull({ source_type, source_id });
      },
    }];
  }
}
```

**效果**：AI 不再是被动的"收到什么用什么"，而是主动"我需要什么就搜什么"，大幅提升回答精准度。

### 17.3 借鉴 WorkBuddy：身份感知个性化（Identity-Aware）

**WorkBuddy 模式**：三层身份文件——`SOUL.md`（行为宪法）、`IDENTITY.md`（角色定义）、`USER.md`（用户画像），每次对话注入身份上下文。

**借鉴到向量检索**：将用户身份向量化，检索时做**身份感知的重排序**：

```javascript
// 用户身份向量 — 持久化在 Zvec 的 identity_vec Collection

class IdentityAwareReranker {
  constructor() {
    this.identityVector = null;  // 用户身份的向量表示
  }

  /**
   * 构建用户身份向量
   * 融合画像 + 角色 + 偏好 + 工作模式
   */
  async buildIdentityVector(profile) {
    const identityText = [
      `角色: ${profile.role || '未知'}`,
      `公司: ${profile.company || '未知'}`,
      `负责项目: ${(profile.projects || []).join(', ')}`,
      `高频联系人: ${(profile.frequent_persons || []).map(p => p.name).join(', ')}`,
      `工作偏好: ${JSON.stringify(profile.preferences || {})}`,
      `行业: ${(profile.industries || []).join(', ')}`,
    ].join('\n');

    this.identityVector = await embeddingService.embed(identityText);
    return this.identityVector;
  }

  /**
   * 身份感知重排序：在向量相似度基础上，叠加"与用户身份的相关度"
   */
  async rerankWithIdentity(results) {
    if (!this.identityVector) return results;

    return results.map(r => {
      // 计算"内容与用户身份的匹配度"
      // 例如：架构师的笔记在架构师提问时优先级更高
      const identityScore = r.identity_similarity || 0;
      const finalScore = r.score * 0.7 + identityScore * 0.3;
      return { ...r, finalScore, originalScore: r.score };
    }).sort((a, b) => b.finalScore - a.finalScore);
  }
}
```

**场景**：用户问"容器方案怎么选"→ 检索到 10 条结果 → 重排序后，与用户角色（架构师）相关的笔记排前面，通用笔记排后面。

### 17.4 借鉴 Hermes Agent：语义去重与自动合并

**Hermes 模式**：过程化记忆自动检测重复场景，遇到"和之前类似的任务"时复用历史经验。

**借鉴到向量检索**：用向量相似度自动检测重复/相似的笔记和记忆，提示用户合并：

```javascript
class SemanticDeduplicator {
  /**
   * 检测语义重复的笔记
   * 当新笔记保存时，检查是否与已有笔记语义高度相似
   */
  async checkDuplicate(newNote) {
    const newVector = await embeddingService.embed(
      `${newNote.title} ${newNote.content}`
    );

    // 在 notes_vec 中搜索相似度 > 0.85 的记录
    const similar = await vectorIndex.collections.notes.query(
      zvec.VectorQuery("embedding", vector=Array.from(newVector), topk=5)
    );

    const duplicates = similar.filter(r => r.score > 0.85);

    if (duplicates.length > 0) {
      return {
        hasDuplicate: true,
        duplicates: duplicates.map(d => ({
          note_id: d.fields.note_id,
          title: d.fields.title,
          score: d.score,
          suggestion: d.score > 0.95
            ? '几乎完全相同，建议跳过'
            : '内容高度相似，建议合并',
        })),
      };
    }
    return { hasDuplicate: false };
  }

  /**
   * 定期扫描全库，发现可合并的相似记忆
   */
  async findMergeableMemories() {
    const allMemories = memoryStore.getAllMemories();
    const mergeGroups = [];
    const processed = new Set();

    for (let i = 0; i < allMemories.length; i++) {
      if (processed.has(allMemories[i].id)) continue;

      const vector = await embeddingService.embed(allMemories[i].content);
      const similar = await vectorIndex.collections.memories.query(
        zvec.VectorQuery("embedding", vector=Array.from(vector), topk=10)
      );

      const group = similar
        .filter(r => r.score > 0.80 && r.fields.memory_id !== allMemories[i].id)
        .map(r => r.fields.memory_id);

      if (group.length > 0) {
        mergeGroups.push({
          primary: allMemories[i].id,
          candidates: group,
          avgScore: similar.filter(r => r.score > 0.80).reduce((s, r) => s + r.score, 0) / group.length,
        });
        group.forEach(id => processed.add(id));
        processed.add(allMemories[i].id);
      }
    }

    return mergeGroups;
  }
}
```

### 17.5 借鉴 Claude Code：权限控制上下文注入

**Claude Code 模式**：三种权限模式——`default`（每次确认）、`acceptEdits`（自动接受编辑）、`plan`（只规划不执行）。

**借鉴到向量检索**：用户控制哪些数据可以被自动注入到 AI 上下文：

```javascript
// 上下文注入权限配置

const CONTEXT_PERMISSIONS = {
  // 完全自动：每次对话自动检索并注入（默认）
  auto: {
    notes: true,
    memories: true,
    tasks: true,
    knowledge: true,
    profile: true,
  },
  // 确认模式：检索后展示给用户确认再注入
  confirm: {
    notes: true,
    memories: true,
    tasks: false,
    knowledge: false,
    profile: false,
  },
  // 手动模式：不自动注入，AI 通过工具按需检索
  manual: {
    notes: false,
    memories: false,
    tasks: false,
    knowledge: false,
    profile: false,
  },
  // 隐私模式：完全禁用向量检索
  off: {
    notes: false,
    memories: false,
    tasks: false,
    knowledge: false,
    profile: false,
  },
};

// 用户可在设置中配置
// "上下文注入模式: [自动] [确认] [手动] [关闭]"
// 还可按数据源细粒度控制: "笔记:自动 记忆:确认 待办:手动 画像:关闭"
```

### 17.6 借鉴 CodeBuddy：规则向量化与语义匹配

**CodeBuddy 模式**：规则系统（rules）+ 记忆系统（memory），规则通过文件管理但无语义匹配。

**借鉴到向量检索**：将项目规则、用户偏好、开发规范等向量化，对话时自动检索相关规则注入：

```javascript
// 新增 rules_vec Collection

// rules_vec Schema
schema = zvec.CollectionSchema(
    name="rules_vec",
    vectors=zvec.VectorSchema("embedding", zvec.DataType.VECTOR_FP32, 2048),
    fields=[
        zvec.FieldSchema("rule_id", zvec.DataType.STRING),
        zvec.FieldSchema("title", zvec.DataType.STRING),
        zvec.FieldSchema("content", zvec.DataType.STRING),     // 规则内容（FTS索引）
        zvec.FieldSchema("category", zvec.DataType.STRING),    // security/coding/ui/performance
        zvec.FieldSchema("scope", zvec.DataType.STRING),       // global/project/module
        zvec.FieldSchema("priority", zvec.DataType.STRING),    // critical/important/advisory
        zvec.FieldSchema("created_at", zvec.DataType.INT64),
    ],
    fts_fields=["title", "content"],
)

// 场景：用户问 "帮我写一个 SQL 查询"
// → 向量检索命中安全规则 "SQL查询必须参数化绑定，禁止字符串拼接"
// → 自动注入到 AI 上下文
// → AI 生成的 SQL 自动遵循安全规范
```

### 17.7 借鉴 WorkBuddy：跨会话上下文连续性

**WorkBuddy 模式**：三层记忆系统，Cloud Memory 向量检索历史对话实现跨会话上下文。

**借鉴到向量检索**：对话结束时自动总结并存储对话向量，下次对话时检索"上次讨论了什么"：

```javascript
class SessionContinuityService {
  /**
   * 对话结束时：自动总结并存储对话向量
   */
  async onSessionEnd(sessionId, messages) {
    // AI 生成对话摘要
    const summary = await this._generateSessionSummary(messages);

    // 向量化摘要并存储到 sessions_vec
    const vector = await embeddingService.embed(summary);
    await vectorIndex.collections.sessions.insert([{
      id: `session_${sessionId}`,
      vectors: { embedding: Array.from(vector) },
      fields: {
        session_id: sessionId,
        summary: summary,
        message_count: messages.length,
        topics: this._extractTopics(messages),
        created_at: Date.now(),
      }
    }]);
  }

  /**
   * 新对话开始时：检索相关历史对话
   */
  async onSessionStart(userMessage) {
    const results = await vectorIndex.collections.sessions.query(
      zvec.VectorQuery("embedding", vector=await embeddingService.embed(userMessage), topk=3)
    );

    if (results.length > 0 && results[0].score > 0.6) {
      return {
        hasHistory: true,
        previousSessions: results.map(r => ({
          summary: r.fields.summary,
          topics: r.fields.topics,
          score: r.score,
          time: r.fields.created_at,
        })),
        // 注入格式: "之前讨论过相关话题: [1] 上周三讨论了腾讯云容器方案..."
      };
    }
    return { hasHistory: false };
  }
}
```

### 17.8 借鉴 Hermes Agent：反馈驱动的检索优化

**Hermes 模式**：闭环学习——Agent 执行结果反馈到记忆系统，下次类似场景自动复用经验。

**借鉴到向量检索**：记录每次上下文注入后的用户反馈（AI 回答是否有用），优化未来检索策略：

```javascript
class RetrievalFeedbackLoop {
  /**
   * 记录检索→注入→用户反馈的完整链路
   */
  async recordFeedback(traceId, userAction) {
    // userAction: 'helpful' | 'not_helpful' | 'edited' | 'ignored'

    const trace = await this._getTrace(traceId);
    if (!trace) return;

    // 记录到反馈表
    await feedbackStore.add({
      trace_id: traceId,
      query: trace.query,
      sources: trace.sources,
      user_action: userAction,
      timestamp: new Date().toISOString(),
    });

    // 更新记忆的活跃度
    if (userAction === 'helpful') {
      for (const source of trace.sources) {
        await memoryActivation.onRetrievalHit([source.source_id], trace.query);
      }
    } else if (userAction === 'not_helpful') {
      // 降权：这些记忆在这类查询中不够有用
      for (const source of trace.sources) {
        await this._decrementScore(source.source_id, trace.query);
      }
    }
  }

  /**
   * 定期分析：哪些查询模式的检索效果最好/最差
   */
  async analyzeRetrievalQuality() {
    const feedbacks = await feedbackStore.getAll();
    const byQueryPattern = {};

    feedbacks.forEach(f => {
      const pattern = this._classifyQueryPattern(f.query);
      if (!byQueryPattern[pattern]) {
        byQueryPattern[pattern] = { total: 0, helpful: 0, not_helpful: 0 };
      }
      byQueryPattern[pattern].total++;
      if (f.user_action === 'helpful') byQueryPattern[pattern].helpful++;
      if (f.user_action === 'not_helpful') byQueryPattern[pattern].not_helpful++;
    });

    // 输出分析报告
    return Object.entries(byQueryPattern).map(([pattern, stats]) => ({
      pattern,
      successRate: stats.helpful / stats.total,
      totalQueries: stats.total,
      recommendation: stats.helpful / stats.total < 0.5
        ? '检索效果差，建议调整 topK 或 score 阈值'
        : '检索效果良好',
    }));
  }
}
```

### 17.9 借鉴 MCP 架构：向量检索作为 MCP Server 暴露

**MCP 模式**：系统作为 MCP Server 暴露工具/数据接口，Agent 作为 MCP Client 调用。

**借鉴**：将向量检索封装为 MCP Server，让外部 Agent（CC/Hermes/OpenClaw）都能查询 Memora 本地数据：

```javascript
// src/mcp/memora-vector-server.js
// Memora 向量检索 MCP Server

const memoraMCPServer = {
  name: 'memora-knowledge',
  version: '1.0.0',

  tools: [
    {
      name: 'search_notes',
      description: '语义搜索用户笔记（支持自然语言查询）',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          category: { type: 'string' },
          limit: { type: 'integer', default: 5 },
        },
        required: ['query'],
      },
    },
    {
      name: 'search_memories',
      description: '语义搜索用户记忆（短期/长期/瞬时）',
      inputSchema: { /* ... */ },
    },
    {
      name: 'search_tasks',
      description: '搜索用户待办任务',
      inputSchema: { /* ... */ },
    },
    {
      name: 'search_all',
      description: '跨数据源语义搜索（笔记+记忆+待办+知识）',
      inputSchema: { /* ... */ },
    },
    {
      name: 'get_detail',
      description: '获取指定数据的完整内容',
      inputSchema: {
        type: 'object',
        properties: {
          source_type: { type: 'string' },
          source_id: { type: 'string' },
        },
        required: ['source_type', 'source_id'],
      },
    },
  ],

  async execute(toolName, args) {
    switch (toolName) {
      case 'search_notes':
        return await hybridSearch.searchNotes(args.query, args.category, args.limit);
      case 'search_memories':
        return await hybridSearch.searchMemories(args.query, args.limit);
      case 'search_tasks':
        return await hybridSearch.searchTasks(args.query, args.limit);
      case 'search_all':
        return await unifiedContextLayer.retrieve(args.query, { topK: args.limit });
      case 'get_detail':
        return await progressiveLoader.loadFull(args);
    }
  },
};

// 注册到 MCP 连接器框架
// CC 模式自动可调用 search_notes / search_memories 等工具
// Hermes / OpenClaw 等外部 Agent 也可通过 MCP 查询
```

### 17.10 借鉴总结：新增 Collection 和模块清单

基于以上借鉴，在原有设计基础上新增：

| 新增项 | 来源 | 说明 |
|--------|------|------|
| `ProgressiveContextLoader` | WorkBuddy | 三级渐进加载（索引→摘要→全文） |
| `search_local_knowledge` 工具 | Claude Code | AI 可自主调用向量检索工具 |
| `IdentityAwareReranker` | WorkBuddy | 身份感知重排序 |
| `SemanticDeduplicator` | Hermes | 语义去重与自动合并建议 |
| 上下文注入权限控制 | Claude Code | auto/confirm/manual/off 四级 |
| `rules_vec` Collection | CodeBuddy | 规则向量化，对话时自动注入相关规范 |
| `sessions_vec` Collection | WorkBuddy | 跨会话上下文连续性 |
| `RetrievalFeedbackLoop` | Hermes | 检索反馈闭环，优化未来检索 |
| `memora-vector-server` MCP | MCP 架构 | 向量检索暴露为 MCP Server |

**新增 Zvec Collections**：

| Collection | 向量化内容 | 用途 |
|-----------|-----------|------|
| `rules_vec` | 项目规则/安全规范/编码规范 | 对话时自动注入相关规则 |
| `sessions_vec` | 对话摘要 | 跨会话上下文连续性 |
| `identity_vec` | 用户身份画像 | 身份感知重排序（单条向量） |

---

## 十八、v3.1 开发路线图（最终版）

### Phase 1：向量基础设施 + 异步队列（1.5 周）

| 任务 | 优先级 |
|------|--------|
| zvec npm 安装 + 6 个 Collection 初始化 | P0 |
| EmbeddingService（火山引擎+DeepSeek+本地BGE降级） | P0 |
| VectorizationQueue（异步队列+去重+批量+重试） | P0 |
| VectorIndexManager CRUD + hybridSearch | P0 |
| 全量索引构建 + 启动时一致性检查 | P0 |
| IPC 通道 + preload 暴露 | P0 |

### Phase 2：统一上下文层 + 渐进式加载（1 周）

| 任务 | 优先级 |
|------|--------|
| UnifiedContextLayer（意图检测+检索+组装+注入） | P0 |
| ProgressiveContextLoader（三级渐进加载） | P1 |
| ADP/LLM/CC/定时任务 四模式注入 | P0 |
| 前端上下文来源 Badge + 详情面板 | P1 |
| 上下文注入权限控制（auto/confirm/manual/off） | P1 |
| Token 预算控制 | P0 |

### Phase 3：搜索 + RAG + 工具化（1 周）

| 任务 | 优先级 |
|------|--------|
| 记事本/记忆语义搜索 | P0 |
| RAG 上下文检索替换 | P0 |
| `search_local_knowledge` 注册为 AI 工具 | P1 |
| MCP Server 暴露（memora-vector-server） | P1 |
| 降级策略（API→BGE→FTS） | P0 |

### Phase 4：记忆激活 + 审计 + 高级特性（1.5 周）

| 任务 | 优先级 |
|------|--------|
| MemoryActivationService（活跃度+晋升+遗忘） | P1 |
| 记忆主动推荐 | P2 |
| Prompt 优化器审计日志 + 行为信号 | P1 |
| IdentityAwareReranker（身份感知重排序） | P2 |
| SemanticDeduplicator（语义去重） | P2 |
| SessionContinuityService（跨会话连续性） | P2 |
| RetrievalFeedbackLoop（检索反馈闭环） | P2 |
| 记忆利用率仪表盘 | P2 |

**总工时：约 5 周**（含借鉴的高级特性）

---

## 十九、最终预期提升总结

| 维度 | 当前 | 整合后 | 提升 |
|------|------|--------|------|
| **搜索召回率** | ~30% | ~85% | +183% |
| **RAG 上下文相关度** | ~40% | ~80% | +100% |
| **AI 回答准确率** | ~60% | ~85% | +42% |
| **上下文注入自动化** | 手动选文件 | 全模式自动注入 | **质变** |
| **CC 模式 Token 效率** | 全量注入 | 精准 Top-K + 渐进式加载 | -60% |
| **记忆利用率** | ~15% | ~60% | **+300%** |
| **Prompt 优化可观测性** | 不可见 | 审计日志+行为分析 | **质变** |
| **AI 自我进化闭环** | 部分 | 完整（行为→优化→审计→反馈→检索优化） | **质变** |
| **离线搜索** | 不可用 | 本地 BGE 降级 | **质变** |
| **AI 自主检索能力** | 被动注入 | Agent 可主动调用 search_local_knowledge 工具 | **质变** |
| **跨会话上下文** | 无 | 向量检索历史对话摘要 | **质变** |
| **语义去重** | 无 | 自动检测相似度>85%的重复笔记/记忆 | **质变** |
| **身份感知个性化** | 无 | 检索结果按用户角色重排序 | **质变** |
| **外部 Agent 可访问** | 无 | MCP Server 暴露向量检索工具 | **质变** |
| **检索质量自优化** | 无 | 反馈闭环分析+参数调优 | **质变** |
