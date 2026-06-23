/**
 * EmbeddingService — 向量化服务
 * 支持多供应商：火山引擎 doubao-embedding / DeepSeek / 本地 BGE（降级）
 * 
 * v3.1 Phase 1
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

class EmbeddingService {
  constructor() {
    this.provider = null;         // 'volcano' | 'deepseek' | 'local'
    this.apiConfig = null;
    this.cache = new Map();       // content hash → vector
    this.cacheMaxSize = 5000;
    this.initialized = false;
    this.embeddingDim = 2048;     // 默认维度（doubao-embedding-text）
  }

  /**
   * 初始化：读取配置，确定供应商
   */
  async init() {
    try {
      // 读取设置（复用 main.js 的 getSetting 逻辑）
      this.provider = 'deepseek'; // 默认用 DeepSeek（已有 API Key）

      // 尝试从环境变量或设置中读取 Embedding 配置
      const embeddingConfig = this._loadEmbeddingConfig();
      if (embeddingConfig) {
        this.provider = embeddingConfig.provider || 'deepseek';
        this.apiConfig = embeddingConfig;
        this.embeddingDim = embeddingConfig.dimension || 1024;
      } else {
        // 降级：使用 DeepSeek 的 API 配置
        const apiKey = process.env.DEEPSEEK_API_KEY || this._getDeepSeekApiKey();
        if (apiKey) {
          this.provider = 'deepseek';
          this.apiConfig = {
            provider: 'deepseek',
            apiKey: apiKey,
            baseUrl: 'https://api.deepseek.com/v1',
            model: 'deepseek-embedding',
            dimension: 1024,
          };
          this.embeddingDim = 1024;
        } else {
          console.warn('[EmbeddingService] No API key found, embedding service disabled');
          this.provider = null;
          return;
        }
      }

      this.initialized = true;
      console.log(`[EmbeddingService] Initialized with provider: ${this.provider}, dim: ${this.embeddingDim}`);
    } catch (e) {
      console.error('[EmbeddingService] Init failed:', e);
      this.provider = null;
    }
  }

  /**
   * 加载 Embedding 配置
   * 优先级：用户设置 > 火山引擎 > DeepSeek
   */
  _loadEmbeddingConfig() {
    // 尝试从设置文件读取
    try {
      const { app } = require('electron');
      const settingsPath = path.join(app.getPath('userData'), 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        if (settings.embedding_provider) {
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

    // 尝试火山引擎配置（复用 CC 模式的 volcano provider）
    try {
      const { app } = require('electron');
      const settingsPath = path.join(app.getPath('userData'), 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        const volcanoToken = settings.cc_volcano_token;
        const volcanoBaseUrl = settings.cc_volcano_base_url;
        if (volcanoToken && volcanoBaseUrl) {
          return {
            provider: 'volcano',
            apiKey: volcanoToken,
            baseUrl: volcanoBaseUrl.replace(/\/$/, '') + '/v1',
            model: 'doubao-embedding-text',
            dimension: 2048,
          };
        }
      }
    } catch {}

    return null;
  }

  _getDeepSeekApiKey() {
    // 从 .env 或环境变量读取
    try {
      const { app } = require('electron');
      const envPath = path.join(app.getPath('userData'), '.env');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/DEEPSEEK_API_KEY\s*=\s*(.+)/);
        if (match) return match[1].trim();
      }
    } catch {}
    return process.env.DEEPSEEK_API_KEY || null;
  }

  /**
   * 向量化单条文本
   * @param {string} text - 待向量化的文本
   * @returns {Promise<number[]|null>} 向量数组，失败返回 null
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
          vector = await this._embedOpenAI(text);
          break;
        case 'deepseek':
          vector = await this._embedOpenAI(text);
          break;
        default:
          console.warn(`[EmbeddingService] Unknown provider: ${this.provider}`);
          return null;
      }

      if (vector && this.cache.size < this.cacheMaxSize) {
        this.cache.set(hash, vector);
      }

      return vector;
    } catch (e) {
      console.error('[EmbeddingService] Embed failed:', e.message);
      return null;
    }
  }

  /**
   * 批量向量化（减少 API 调用次数）
   * @param {string[]} texts - 文本数组
   * @returns {Promise<(number[]|null)[]>} 向量数组（与输入一一对应，失败的为 null）
   */
  async embedBatch(texts) {
    if (!this.initialized || !this.provider) {
      return texts.map(() => null);
    }

    const valid = texts.map((t, i) => ({ text: t, index: i })).filter(x => x.text && x.text.trim());
    if (valid.length === 0) return texts.map(() => null);

    const batchSize = 16;
    const results = new Array(texts.length).fill(null);

    for (let i = 0; i < valid.length; i += batchSize) {
      const batch = valid.slice(i, i + batchSize);
      try {
        // 检查缓存
        const uncached = [];
        const uncachedIndices = [];
        batch.forEach((b, j) => {
          const hash = this._hash(b.text);
          if (this.cache.has(hash)) {
            results[b.index] = this.cache.get(hash);
          } else {
            uncached.push(b.text);
            uncachedIndices.push(b.index);
          }
        });

        if (uncached.length > 0) {
          const vectors = await this._embedBatchAPI(uncached);
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
        // 失败的条目保持 null
      }
    }

    return results;
  }

  /**
   * OpenAI 兼容 API 单条向量化（火山引擎/DeepSeek 共用）
   */
  async _embedOpenAI(text) {
    const response = await fetch(`${this.apiConfig.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: this.apiConfig.model,
        input: text.substring(0, 8000), // 截断超长文本
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Embedding API ${response.status}: ${errText.substring(0, 200)}`);
    }

    const data = await response.json();
    return data.data?.[0]?.embedding || null;
  }

  /**
   * OpenAI 兼容 API 批量向量化
   */
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

  /**
   * 获取当前维度
   */
  getDimension() {
    return this.embeddingDim;
  }

  /**
   * 是否可用
   */
  isAvailable() {
    return this.initialized && this.provider !== null;
  }

  /**
   * 内容哈希（用于缓存 key）
   */
  _hash(text) {
    return crypto.createHash('md5').update(text).digest('hex');
  }
}

module.exports = EmbeddingService;
