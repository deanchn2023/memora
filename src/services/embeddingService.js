/**
 * EmbeddingService — 向量化服务
 * 支持多供应商：火山引擎 doubao-embedding / DeepSeek API / BGE 本地 ONNX / 哈希降级
 *
 * 降级链路：用户配置 > API（火山/DeepSeek）> BGE 本地 > 哈希降级
 *
 * v3.1.2: 新增 BGE-small-zh-v1.5 INT8 本地嵌入
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

class EmbeddingService {
  constructor() {
    this.provider = null;         // 'volcano' | 'deepseek' | 'bge-local' | 'local'
    this.apiConfig = null;
    this.cache = new Map();       // content hash → vector
    this.cacheMaxSize = 5000;
    this.initialized = false;
    this.embeddingDim = 512;      // BGE-small-zh-v1.5 维度

    // BGE 模型相关
    this._bgePipeline = null;     // 懒加载的 pipeline 实例
    this._bgeLoading = false;     // 防止并发加载
    this._bgeLastUsed = 0;        // 最后使用时间
    this._bgeUnloadTimer = null;  // 自动卸载计时器
    this._bgeIdleTimeout = 300000; // 5 分钟空闲后卸载
  }

  /**
   * 初始化：读取配置，确定供应商
   * 降级策略：用户配置 > 火山引擎 API > BGE 本地 ONNX > 哈希降级
   */
  async init() {
    try {
      // 1. 尝试从设置中读取 Embedding API 配置
      const embeddingConfig = this._loadEmbeddingConfig();
      if (embeddingConfig && embeddingConfig.apiKey) {
        this.provider = embeddingConfig.provider || 'deepseek';
        this.apiConfig = embeddingConfig;
        this.embeddingDim = embeddingConfig.dimension || 1024;
        this.initialized = true;
        console.log(`[EmbeddingService] Initialized with provider: ${this.provider}, dim: ${this.embeddingDim}`);
        return;
      }

      // 2. 尝试 BGE 本地模型
      const bgeModelPath = this._getBgeModelPath();
      if (bgeModelPath) {
        this.provider = 'bge-local';
        this.apiConfig = null;
        this.embeddingDim = 512;
        this.initialized = true;
        this._bgeModelPath = bgeModelPath;
        console.log(`[EmbeddingService] Will use BGE local embedding (lazy load), dim: ${this.embeddingDim}, path: ${bgeModelPath}`);
        return;
      }

      // 3. 降级：本地哈希嵌入
      this.provider = 'local';
      this.apiConfig = null;
      this.embeddingDim = 1024;
      this.initialized = true;
      console.warn('[EmbeddingService] BGE model not found, falling back to hash embedding, dim: 1024');
    } catch (e) {
      console.error('[EmbeddingService] Init failed:', e);
      this.provider = 'local';
      this.apiConfig = null;
      this.embeddingDim = 1024;
      this.initialized = true;
    }
  }

  /**
   * 获取 BGE 模型路径（开发环境 + 打包环境）
   */
  _getBgeModelPath() {
    const modelDir = 'bge-small-zh-v1.5';
    const onnxFile = 'onnx/model_quantized.onnx';

    try {
      // 尝试多个可能的路径
      const { app } = require('electron');
      const candidates = [
        // 开发环境：项目根目录 resources/models/
        path.join(app.getAppPath(), 'resources', 'models', modelDir),
        // 打包环境：extraResources 解包到 resources/models/
        path.join(process.resourcesPath || '', 'models', modelDir),
        // 打包环境：asar.unpacked
        path.join(app.getAppPath(), 'resources', 'models', modelDir),
      ];

      for (const candidate of candidates) {
        const onnxPath = path.join(candidate, onnxFile);
        const tokenizerPath = path.join(candidate, 'tokenizer.json');
        if (fs.existsSync(onnxPath) && fs.existsSync(tokenizerPath)) {
          return candidate;
        }
      }
    } catch (e) {
      console.error('[EmbeddingService] Failed to find BGE model path:', e.message);
    }
    return null;
  }

  /**
   * 加载 Embedding 配置
   * 优先级：用户设置 > 火山引擎
   */
  _loadEmbeddingConfig() {
    try {
      const { app } = require('electron');
      const settingsPath = path.join(app.getPath('userData'), 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        if (settings.embedding_provider && settings.embedding_api_key) {
          return {
            provider: settings.embedding_provider,
            apiKey: settings.embedding_api_key,
            baseUrl: settings.embedding_base_url,
            model: settings.embedding_model,
            dimension: settings.embedding_dimension || 1024,
          };
        }
      }
    } catch {}
    return null;
  }

  /**
   * 向量化单条文本
   */
  async embed(text) {
    if (!text || !text.trim()) return null;
    if (!this.initialized || !this.provider) return null;

    // 缓存命中
    const hash = this._hash(text);
    if (this.cache.has(hash)) return this.cache.get(hash);

    try {
      let vector;
      switch (this.provider) {
        case 'volcano':
        case 'deepseek':
          vector = await this._embedOpenAI(text);
          break;
        case 'bge-local':
          vector = await this._embedBGE(text);
          break;
        case 'local':
          vector = this._embedLocal(text);
          break;
        default:
          vector = this._embedLocal(text);
      }

      if (vector && this.cache.size < this.cacheMaxSize) {
        this.cache.set(hash, vector);
      }

      return vector;
    } catch (e) {
      console.error('[EmbeddingService] Embed failed:', e.message);
      // BGE 失败时降级到哈希
      if (this.provider === 'bge-local') {
        console.warn('[EmbeddingService] BGE embed failed, falling back to hash for this call');
        return this._embedLocal(text);
      }
      return null;
    }
  }

  /**
   * 批量向量化
   */
  async embedBatch(texts) {
    if (!this.initialized || !this.provider) {
      return texts.map(() => null);
    }

    const valid = texts.map((t, i) => ({ text: t, index: i })).filter(x => x.text && x.text.trim());
    if (valid.length === 0) return texts.map(() => null);

    const batchSize = this.provider === 'bge-local' ? 8 : 16; // BGE 批量小一些减少内存峰值
    const results = new Array(texts.length).fill(null);

    for (let i = 0; i < valid.length; i += batchSize) {
      const batch = valid.slice(i, i + batchSize);
      try {
        const uncached = [];
        const uncachedIndices = [];
        batch.forEach((b) => {
          const hash = this._hash(b.text);
          if (this.cache.has(hash)) {
            results[b.index] = this.cache.get(hash);
          } else {
            uncached.push(b.text);
            uncachedIndices.push(b.index);
          }
        });

        if (uncached.length > 0) {
          const vectors = await this._embedBatchInternal(uncached);
          vectors.forEach((vec, j) => {
            const idx = uncachedIndices[j];
            results[idx] = vec;
            if (vec && this.cache.size < this.cacheMaxSize) {
              this.cache.set(this._hash(uncached[j]), vec);
            }
          });
        }
      } catch (e) {
        console.error('[EmbeddingService] Batch embed failed:', e.message);
      }
    }

    return results;
  }

  /**
   * 批量嵌入内部分发
   */
  async _embedBatchInternal(texts) {
    if (this.provider === 'local') {
      return texts.map(t => this._embedLocal(t));
    }
    if (this.provider === 'bge-local') {
      // BGE 逐条处理（transformers.js 的 batch 接口在 Node.js 上不稳定）
      const results = [];
      for (const text of texts) {
        try {
          const vec = await this._embedBGE(text);
          results.push(vec);
        } catch (e) {
          console.warn('[EmbeddingService] BGE batch item failed, using hash:', e.message);
          results.push(this._embedLocal(text));
        }
      }
      return results;
    }
    // API 批量
    return await this._embedBatchAPI(texts);
  }

  // ===== BGE 本地嵌入 =====

  /**
   * 懒加载 BGE pipeline
   */
  async _ensureBGELoaded() {
    if (this._bgePipeline) {
      this._bgeLastUsed = Date.now();
      this._resetUnloadTimer();
      return;
    }
    if (this._bgeLoading) {
      // 等待其他协程完成加载
      while (this._bgeLoading) {
        await new Promise(r => setTimeout(r, 50));
      }
      if (this._bgePipeline) {
        this._bgeLastUsed = Date.now();
        this._resetUnloadTimer();
        return;
      }
    }

    this._bgeLoading = true;
    try {
      const { pipeline, env } = await import('@xenova/transformers');

      // 配置 transformers.js：只使用本地文件，禁止联网
      env.allowRemoteModels = false;
      env.allowLocalModels = true;

      // 设置模型搜索路径（模型目录的父目录）
      const modelDir = this._bgeModelPath;
      const modelParent = path.dirname(modelDir);
      env.localModelPath = modelParent;

      console.log(`[EmbeddingService] Loading BGE model from: ${modelDir} (parent: ${modelParent})`);

      this._bgePipeline = await pipeline(
        'feature-extraction',
        'bge-small-zh-v1.5',
        {
          quantized: true,  // 自动查找 onnx/model_quantized.onnx
        }
      );

      this._bgeLastUsed = Date.now();
      this._resetUnloadTimer();
      console.log('[EmbeddingService] BGE model loaded successfully');
    } catch (e) {
      console.error('[EmbeddingService] Failed to load BGE model:', e.message);
      throw e;
    } finally {
      this._bgeLoading = false;
    }
  }

  /**
   * BGE 嵌入
   */
  async _embedBGE(text) {
    await this._ensureBGELoaded();
    if (!this._bgePipeline) {
      throw new Error('BGE pipeline not available');
    }

    // 截断超长文本（BGE 最大 512 tokens）
    const truncated = text.substring(0, 2000);

    const output = await this._bgePipeline(truncated, {
      pooling: 'cls',      // BGE 使用 CLS token 作为句向量
      normalize: true,     // L2 归一化
    });

    return Array.from(output.data);
  }

  /**
   * 重置自动卸载计时器
   */
  _resetUnloadTimer() {
    if (this._bgeUnloadTimer) clearTimeout(this._bgeUnloadTimer);
    this._bgeUnloadTimer = setTimeout(() => {
      if (this._bgePipeline && Date.now() - this._bgeLastUsed >= this._bgeIdleTimeout) {
        console.log('[EmbeddingService] BGE model idle timeout, unloading to free memory');
        this._bgePipeline = null;
        this._bgeUnloadTimer = null;
      } else {
        // 还没到时间，重新计时
        this._resetUnloadTimer();
      }
    }, this._bgeIdleTimeout);
  }

  // ===== API 嵌入 =====

  async _embedOpenAI(text) {
    const response = await fetch(`${this.apiConfig.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: this.apiConfig.model,
        input: text.substring(0, 8000),
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Embedding API ${response.status}: ${errText.substring(0, 200)}`);
    }

    const data = await response.json();
    return data.data?.[0]?.embedding || null;
  }

  async _embedBatchAPI(texts) {
    const response = await fetch(`${this.apiConfig.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: this.apiConfig.model,
        input: texts.map(t => t.substring(0, 8000)),
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Embedding API ${response.status}: ${errText.substring(0, 200)}`);
    }

    const data = await response.json();
    if (data.data && Array.isArray(data.data)) {
      return data.data.map(d => d.embedding || null);
    }
    return texts.map(() => null);
  }

  // ===== 哈希降级嵌入 =====

  _embedLocal(text) {
    if (!text || !text.trim()) return null;
    const dim = this.embeddingDim;
    const vec = new Float32Array(dim);

    const tokens = this._tokenize(text);

    for (const token of tokens) {
      const h1 = this._hashInt(token, 0) % dim;
      const h2 = this._hashInt(token, 1) % dim;
      vec[h1] += 1.0;
      vec[h2] += 0.5;
    }

    let norm = 0;
    for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < dim; i++) vec[i] /= norm;
    }

    return Array.from(vec);
  }

  _tokenize(text) {
    const tokens = [];
    const enWords = text.toLowerCase().match(/[a-z]{2,}/g) || [];
    tokens.push(...enWords);

    const cleaned = text.replace(/[^\u4e00-\u9fa5]/g, ' ');
    for (let i = 0; i < cleaned.length - 1; i++) {
      if (cleaned[i] >= '\u4e00' && cleaned[i] <= '\u9fa5' && cleaned[i+1] >= '\u4e00' && cleaned[i+1] <= '\u9fa5') {
        tokens.push(cleaned.substring(i, i + 2));
      }
    }

    for (const ch of cleaned) {
      if (ch >= '\u4e00' && ch <= '\u9fa5') tokens.push(ch);
    }

    return tokens;
  }

  _hashInt(str, seed = 0) {
    let hash = 2166136261 ^ seed;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  // ===== 公共方法 =====

  getDimension() {
    return this.embeddingDim;
  }

  isAvailable() {
    return this.initialized && this.provider !== null;
  }

  getProvider() {
    return this.provider;
  }

  _hash(text) {
    return crypto.createHash('md5').update(text).digest('hex');
  }
}

module.exports = EmbeddingService;
