/**
 * VectorIndexManager — 向量索引管理器
 * 基于 Zvec 嵌入式向量数据库，管理多个 Collection
 * 
 * v3.1 Phase 1
 * 
 * Zvec API 说明：
 * - 导出的名称都是 ZVec 前缀（ZVecCreateAndOpen, ZVecCollectionSchema 等）
 * - Collection 操作有 Sync 和异步两种版本
 * - 混合检索通过 multiQuery 实现（向量 + FTS + filter）
 */

const path = require('path');
const fs = require('fs');

// 延迟加载 zvec（避免启动时原生模块加载失败导致崩溃）
let zvec = null;
function getZvec() {
  if (zvec) return zvec;
  try {
    zvec = require('@zvec/zvec');
    return zvec;
  } catch (e) {
    console.error('[VectorIndex] Failed to load @zvec/zvec:', e.message);
    return null;
  }
}

class VectorIndexManager {
  constructor(embeddingService) {
    this.embedding = embeddingService;
    this.collections = {};
    this.dbPath = null;
    this.initialized = false;
    this.dimension = 1024; // 会根据 embeddingService 动态调整
  }

  /**
   * 初始化：创建/打开所有 Collection
   */
  async init(userDataPath) {
    const z = getZvec();
    if (!z) {
      console.warn('[VectorIndex] Zvec not available, vector search disabled');
      return false;
    }

    this.dbPath = path.join(userDataPath, 'vector_db');
    if (!fs.existsSync(this.dbPath)) {
      fs.mkdirSync(this.dbPath, { recursive: true });
    }

    // 初始化 Zvec 全局配置
    try {
      z.ZVecInitialize({
        logLevel: z.ZVecLogLevel.WARN,
        logType: z.ZVecLogType.CONSOLE,
      });
    } catch (e) {
      // 可能已初始化，忽略
    }

    this.dimension = this.embedding.getDimension();

    // 创建/打开各 Collection
    try {
      this.collections.notes = await this._openOrCreateCollection('notes_vec', this._getNotesSchema());
      this.collections.memories = await this._openOrCreateCollection('memories_vec', this._getMemoriesSchema());
      this.collections.knowledge = await this._openOrCreateCollection('knowledge_vec', this._getKnowledgeSchema());
      this.collections.tasks = await this._openOrCreateCollection('tasks_vec', this._getTasksSchema());
      this.initialized = true;
      console.log(`[VectorIndex] Initialized at ${this.dbPath}, dim=${this.dimension}`);
      return true;
    } catch (e) {
      console.error('[VectorIndex] Init collections failed:', e);
      return false;
    }
  }

  // ===== Schema 定义 =====

  _getNotesSchema() {
    const z = getZvec();
    return new z.ZVecCollectionSchema({
      name: 'notes_vec',
      vectors: {
        name: 'embedding',
        dataType: z.ZVecDataType.VECTOR_FP32,
        dimension: this.dimension,
        indexParams: {
          indexType: z.ZVecIndexType.HNSW,
          metricType: z.ZVecMetricType.COSINE,
          m: 16,
          efConstruction: 200,
        },
      },
      fields: [
        { name: 'note_id', dataType: z.ZVecDataType.STRING },
        { name: 'title', dataType: z.ZVecDataType.STRING, indexParams: { indexType: z.ZVecIndexType.FTS } },
        { name: 'content', dataType: z.ZVecDataType.STRING, indexParams: { indexType: z.ZVecIndexType.FTS } },
        { name: 'category', dataType: z.ZVecDataType.STRING, indexParams: { indexType: z.ZVecIndexType.INVERT } },
        { name: 'tags', dataType: z.ZVecDataType.STRING },
        { name: 'created_at', dataType: z.ZVecDataType.INT64, indexParams: { indexType: z.ZVecIndexType.INVERT } },
        { name: 'content_hash', dataType: z.ZVecDataType.STRING },
      ],
    });
  }

  _getMemoriesSchema() {
    const z = getZvec();
    return new z.ZVecCollectionSchema({
      name: 'memories_vec',
      vectors: {
        name: 'embedding',
        dataType: z.ZVecDataType.VECTOR_FP32,
        dimension: this.dimension,
        indexParams: {
          indexType: z.ZVecIndexType.HNSW,
          metricType: z.ZVecMetricType.COSINE,
          m: 16,
          efConstruction: 200,
        },
      },
      fields: [
        { name: 'memory_id', dataType: z.ZVecDataType.STRING },
        { name: 'content', dataType: z.ZVecDataType.STRING, indexParams: { indexType: z.ZVecIndexType.FTS } },
        { name: 'type', dataType: z.ZVecDataType.STRING, indexParams: { indexType: z.ZVecIndexType.INVERT } },
        { name: 'category', dataType: z.ZVecDataType.STRING, indexParams: { indexType: z.ZVecIndexType.INVERT } },
        { name: 'business_category', dataType: z.ZVecDataType.STRING },
        { name: 'importance', dataType: z.ZVecDataType.STRING },
        { name: 'created_at', dataType: z.ZVecDataType.INT64, indexParams: { indexType: z.ZVecIndexType.INVERT } },
        { name: 'status', dataType: z.ZVecDataType.STRING },
      ],
    });
  }

  _getKnowledgeSchema() {
    const z = getZvec();
    return new z.ZVecCollectionSchema({
      name: 'knowledge_vec',
      vectors: {
        name: 'embedding',
        dataType: z.ZVecDataType.VECTOR_FP32,
        dimension: this.dimension,
        indexParams: {
          indexType: z.ZVecIndexType.HNSW,
          metricType: z.ZVecMetricType.COSINE,
          m: 16,
          efConstruction: 200,
        },
      },
      fields: [
        { name: 'atom_id', dataType: z.ZVecDataType.STRING },
        { name: 'content', dataType: z.ZVecDataType.STRING, indexParams: { indexType: z.ZVecIndexType.FTS } },
        { name: 'domain', dataType: z.ZVecDataType.STRING, indexParams: { indexType: z.ZVecIndexType.INVERT } },
        { name: 'type', dataType: z.ZVecDataType.STRING },
        { name: 'importance', dataType: z.ZVecDataType.FLOAT },
        { name: 'created_at', dataType: z.ZVecDataType.INT64 },
      ],
    });
  }

  _getTasksSchema() {
    const z = getZvec();
    return new z.ZVecCollectionSchema({
      name: 'tasks_vec',
      vectors: {
        name: 'embedding',
        dataType: z.ZVecDataType.VECTOR_FP32,
        dimension: this.dimension,
        indexParams: {
          indexType: z.ZVecIndexType.HNSW,
          metricType: z.ZVecMetricType.COSINE,
          m: 16,
          efConstruction: 200,
        },
      },
      fields: [
        { name: 'task_id', dataType: z.ZVecDataType.STRING },
        { name: 'title', dataType: z.ZVecDataType.STRING, indexParams: { indexType: z.ZVecIndexType.FTS } },
        { name: 'description', dataType: z.ZVecDataType.STRING, indexParams: { indexType: z.ZVecIndexType.FTS } },
        { name: 'status', dataType: z.ZVecDataType.STRING, indexParams: { indexType: z.ZVecIndexType.INVERT } },
        { name: 'priority', dataType: z.ZVecDataType.STRING },
        { name: 'due_date', dataType: z.ZVecDataType.INT64 },
        { name: 'created_at', dataType: z.ZVecDataType.INT64 },
      ],
    });
  }

  /**
   * 打开或创建 Collection
   */
  async _openOrCreateCollection(name, schema) {
    const z = getZvec();
    const colPath = path.join(this.dbPath, name);
    try {
      // 尝试打开已存在的
      return z.ZVecOpen(colPath);
    } catch (e) {
      // 不存在则创建
      const col = z.ZVecCreateAndOpen(colPath, schema);
      console.log(`[VectorIndex] Created collection: ${name}`);
      return col;
    }
  }

  // ===== CRUD 操作 =====

  /**
   * 插入/更新笔记向量
   */
  async upsertNote(note) {
    if (!this.initialized) return;
    const col = this.collections.notes;
    if (!col) return;

    const text = `${note.title || ''} ${note.content || ''}`.trim();
    const vector = await this.embedding.embed(text);
    if (!vector) return;

    const crypto = require('crypto');
    const contentHash = crypto.createHash('md5').update(text).digest('hex');

    try {
      col.upsertSync({
        id: `note_${note.id}`,
        vectors: { embedding: vector },
        fields: {
          note_id: note.id,
          title: (note.title || '').substring(0, 500),
          content: (note.content || '').substring(0, 2000),
          category: note.category || 'general',
          tags: (note.tags || []).join(','),
          created_at: note.createdAt ? new Date(note.createdAt).getTime() : Date.now(),
          content_hash: contentHash,
        },
      });
    } catch (e) {
      console.error('[VectorIndex] upsertNote failed:', e.message);
    }
  }

  /**
   * 插入/更新记忆向量
   */
  async upsertMemory(memory) {
    if (!this.initialized) return;
    const col = this.collections.memories;
    if (!col) return;

    const text = memory.content || '';
    const vector = await this.embedding.embed(text);
    if (!vector) return;

    try {
      col.upsertSync({
        id: `mem_${memory.id}`,
        vectors: { embedding: vector },
        fields: {
          memory_id: memory.id,
          content: text.substring(0, 2000),
          type: memory.type || 'short',
          category: memory.category || 'knowledge',
          business_category: memory.business_category || 'other',
          importance: memory.importance || 'normal',
          created_at: memory.createdAt ? new Date(memory.createdAt).getTime() : Date.now(),
          status: memory.metadata?.status || 'active',
        },
      });
    } catch (e) {
      console.error('[VectorIndex] upsertMemory failed:', e.message);
    }
  }

  /**
   * 插入/更新待办向量
   */
  async upsertTask(task) {
    if (!this.initialized) return;
    const col = this.collections.tasks;
    if (!col) return;

    const text = `${task.title || ''} ${task.description || ''}`.trim();
    if (!text) return;
    const vector = await this.embedding.embed(text);
    if (!vector) return;

    try {
      col.upsertSync({
        id: `task_${task.id}`,
        vectors: { embedding: vector },
        fields: {
          task_id: task.id,
          title: (task.title || '').substring(0, 500),
          description: (task.description || '').substring(0, 2000),
          status: task.status || 'pending',
          priority: task.priority || 'medium',
          due_date: task.dueDate ? new Date(task.dueDate).getTime() : 0,
          created_at: task.createdAt ? new Date(task.createdAt).getTime() : Date.now(),
        },
      });
    } catch (e) {
      console.error('[VectorIndex] upsertTask failed:', e.message);
    }
  }

  /**
   * 插入/更新知识原子向量
   */
  async upsertKnowledge(atom) {
    if (!this.initialized) return;
    const col = this.collections.knowledge;
    if (!col) return;

    const text = atom.content || '';
    const vector = await this.embedding.embed(text);
    if (!vector) return;

    try {
      col.upsertSync({
        id: `atom_${atom.id}`,
        vectors: { embedding: vector },
        fields: {
          atom_id: atom.id,
          content: text.substring(0, 2000),
          domain: atom.domain || '通用',
          type: atom.type || 'atom',
          importance: atom.importance || 0.5,
          created_at: atom.createdAt ? new Date(atom.createdAt).getTime() : Date.now(),
        },
      });
    } catch (e) {
      console.error('[VectorIndex] upsertKnowledge failed:', e.message);
    }
  }

  /**
   * 删除笔记向量
   */
  async deleteNote(noteId) {
    if (!this.initialized) return;
    try { this.collections.notes?.deleteSync(`note_${noteId}`); } catch {}
  }

  /**
   * 删除记忆向量
   */
  async deleteMemory(memoryId) {
    if (!this.initialized) return;
    try { this.collections.memories?.deleteSync(`mem_${memoryId}`); } catch {}
  }

  /**
   * 删除待办向量
   */
  async deleteTask(taskId) {
    if (!this.initialized) return;
    try { this.collections.tasks?.deleteSync(`task_${taskId}`); } catch {}
  }

  /**
   * 删除知识原子向量
   */
  async deleteKnowledge(atomId) {
    if (!this.initialized) return;
    try { this.collections.knowledge?.deleteSync(`atom_${atomId}`); } catch {}
  }

  // ===== 混合检索 =====

  /**
   * 混合检索：向量 + FTS + 标量过滤
   * @param {string} query - 搜索查询
   * @param {object} options - 检索选项
   * @param {string[]} options.sources - 数据源 ['notes','memories','tasks','knowledge']
   * @param {number} options.topK - 每个数据源返回条数
   * @param {number} options.limit - 最终返回总条数
   * @param {string} options.category - 分类过滤
   * @param {number} options.timeRange - 时间范围（毫秒时间戳，只返回此时间之后的）
   * @returns {Promise<Array>} 检索结果
   */
  async hybridSearch(query, options = {}) {
    if (!this.initialized) return [];

    const queryVector = await this.embedding.embed(query);
    const sources = options.sources || ['notes', 'memories', 'knowledge'];
    const topK = options.topK || 5;
    const limit = options.limit || 20;
    const allResults = [];

    for (const sourceName of sources) {
      const col = this.collections[sourceName];
      if (!col) continue;

      // 构建过滤器
      let filter = '';
      const filters = [];
      if (options.category) {
        filters.push(`category = "${options.category}"`);
      }
      if (options.timeRange) {
        filters.push(`created_at >= ${options.timeRange}`);
      }
      if (options.statusFilter) {
        filters.push(`status != "${options.statusFilter}"`);
      }
      filter = filters.join(' AND ');

      try {
        let docs;
        if (queryVector) {
          // 混合检索：向量 + FTS
          const ftsField = sourceName === 'notes' ? 'title' : 'content';
          const multiQueryParams = {
            queries: [
              {
                fieldName: 'embedding',
                vector: queryVector,
                numCandidates: topK * 3,
              },
              {
                fieldName: ftsField,
                fts: { matchString: query.substring(0, 500) },
                numCandidates: topK * 3,
              },
            ],
            topk: topK,
            rerank: { type: 'rrf', rankConstant: 60 },
            outputFields: ['note_id', 'memory_id', 'task_id', 'atom_id', 'title', 'content', 'category', 'created_at', 'type', 'status', 'tags'],
          };
          if (filter) multiQueryParams.filter = filter;
          docs = await col.multiQuery(multiQueryParams);
        } else if (query.trim()) {
          // 降级：纯 FTS
          const ftsField = sourceName === 'notes' ? 'title' : 'content';
          const queryParams = {
            fieldName: ftsField,
            fts: { matchString: query.substring(0, 500) },
            topk: topK,
            outputFields: ['note_id', 'memory_id', 'task_id', 'atom_id', 'title', 'content', 'category', 'created_at', 'type', 'status', 'tags'],
          };
          if (filter) queryParams.filter = filter;
          docs = await col.query(queryParams);
        } else {
          continue;
        }

        docs.forEach(doc => {
          const fields = doc.fields || {};
          const sourceId = fields.note_id || fields.memory_id || fields.task_id || fields.atom_id;
          if (!sourceId) return;
          allResults.push({
            source_type: this._getSourceType(sourceName),
            source_id: sourceId,
            collection: sourceName,
            vector_id: doc.id,
            title: fields.title || (fields.content || '').substring(0, 50),
            content_preview: (fields.content || '').substring(0, 200),
            score: doc.score,
            match_type: queryVector ? 'hybrid' : 'fts',
            created_at: fields.created_at,
            category: fields.category,
            tags: fields.tags,
            memory_type: fields.type,
            status: fields.status,
          });
        });
      } catch (e) {
        console.error(`[VectorIndex] Search ${sourceName} failed:`, e.message);
      }
    }

    // 合并排序并截取
    return allResults.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  _getSourceType(collectionName) {
    const map = {
      notes: 'notebook',
      memories: 'memory',
      tasks: 'tasks',
      knowledge: 'knowledge',
    };
    return map[collectionName] || collectionName;
  }

  // ===== 状态与维护 =====

  /**
   * 获取索引状态
   */
  getStatus() {
    if (!this.initialized) return { initialized: false, collections: {} };
    const stats = {};
    for (const [name, col] of Object.entries(this.collections)) {
      try {
        stats[name] = {
          docCount: col.stats?.docCount || 0,
        };
      } catch {
        stats[name] = { docCount: 0 };
      }
    }
    return { initialized: true, collections: stats, dimension: this.dimension };
  }

  /**
   * 全量重建（清空 + 重新索引）
   */
  async rebuildAll(notes = [], memories = [], tasks = [], atoms = []) {
    if (!this.initialized) return { success: false, error: 'Not initialized' };

    console.log('[VectorIndex] Rebuilding all collections...');

    // 清空各 Collection
    for (const [name, col] of Object.entries(this.collections)) {
      try {
        // 删除并重新创建
        const colPath = col.path;
        col.destroySync();
        const z = getZvec();
        let schema;
        switch (name) {
          case 'notes': schema = this._getNotesSchema(); break;
          case 'memories': schema = this._getMemoriesSchema(); break;
          case 'knowledge': schema = this._getKnowledgeSchema(); break;
          case 'tasks': schema = this._getTasksSchema(); break;
        }
        this.collections[name] = z.ZVecCreateAndOpen(colPath, schema);
      } catch (e) {
        console.error(`[VectorIndex] Rebuild ${name} failed:`, e.message);
      }
    }

    // 批量插入
    let noteCount = 0, memoryCount = 0, taskCount = 0, atomCount = 0;

    // 笔记
    if (notes.length > 0) {
      const texts = notes.map(n => `${n.title || ''} ${n.content || ''}`.trim());
      const vectors = await this.embedding.embedBatch(texts);
      for (let i = 0; i < notes.length; i++) {
        if (vectors[i]) {
          await this.upsertNote(notes[i]);
          noteCount++;
        }
      }
    }

    // 记忆
    for (const mem of memories) {
      await this.upsertMemory(mem);
      memoryCount++;
    }

    // 待办
    for (const task of tasks) {
      await this.upsertTask(task);
      taskCount++;
    }

    // 知识原子
    for (const atom of atoms) {
      await this.upsertKnowledge(atom);
      atomCount++;
    }

    console.log(`[VectorIndex] Rebuilt: ${noteCount} notes, ${memoryCount} memories, ${taskCount} tasks, ${atomCount} atoms`);
    return { success: true, count: { notes: noteCount, memories: memoryCount, tasks: taskCount, atoms: atomCount } };
  }

  /**
   * 关闭所有 Collection
   */
  close() {
    for (const col of Object.values(this.collections)) {
      try { col.closeSync(); } catch {}
    }
    this.initialized = false;
  }
}

module.exports = VectorIndexManager;
