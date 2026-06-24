/**
 * UnifiedContextLayer — 统一上下文层
 * 为每次 AI 对话/任务自动检索语义相关上下文并注入
 * 
 * v3.1 Phase 2
 * 
 * 工作流程：
 * 1. 快速意图检测（≤1ms）— 判断是否需要检索
 * 2. 向量检索（≤50ms）— 并行检索 notes/memories/tasks/knowledge
 * 3. 上下文组装（Token 预算控制）
 * 4. 返回 context + sources（供前端展示引用来源）
 */

class UnifiedContextLayer {
  constructor(vectorIndex, embeddingService) {
    this.vectorIndex = vectorIndex;
    this.embedding = embeddingService;
    this.traceCounter = 0;
  }

  /**
   * 检索与用户消息相关的本地上下文
   * @param {string} message - 用户消息
   * @param {object} options - 检索选项
   * @param {string} options.mode - 'adp' | 'llm' | 'cc' | 'scheduled' | 'clipboard'
   * @param {string[]} options.sources - 限定数据源
   * @param {number} options.topK - 每个数据源返回条数
   * @param {number} options.tokenBudget - Token 预算
   * @param {object} options.intent - LLM 意图分类结果（可选）
   * @returns {Promise<object>} { context, sources, retrieval_meta }
   */
  async retrieve(message, options = {}) {
    if (!this.vectorIndex || !this.vectorIndex.initialized) {
      return { context: '', sources: [], retrieval_meta: { skipped: 'not_initialized' } };
    }

    // Step 1: 快速意图检测
    if (!this._shouldRetrieve(message)) {
      return { context: '', sources: [], retrieval_meta: { skipped: 'intent_filter' } };
    }

    const traceId = `ctx_${Date.now()}_${++this.traceCounter}`;
    const startTime = Date.now();

    // Step 2: 确定检索参数
    const mode = options.mode || 'adp';
    const tokenBudget = TOKEN_BUDGETS[mode] || 1500;
    const topK = options.topK || 5;

    // 根据意图分类决定数据源
    let sources = options.sources;
    if (!sources && options.intent) {
      sources = [];
      if (options.intent.need_notebook) sources.push('notes');
      if (options.intent.need_memory) sources.push('memories');
      if (options.intent.need_tasks) sources.push('tasks');
      if (options.intent.need_knowledge) sources.push('knowledge');
    }
    if (!sources || sources.length === 0) {
      sources = ['notes', 'memories', 'tasks'];
    }

    // 构建检索选项
    const searchOptions = {
      sources,
      topK,
      limit: topK * sources.length,
    };

    // 时间范围过滤
    if (options.intent?.notebook_time_range) {
      searchOptions.timeRange = this._parseTimeRange(options.intent.notebook_time_range);
    }
    if (options.intent?.memory_time_range) {
      searchOptions.timeRange = searchOptions.timeRange || this._parseTimeRange(options.intent.memory_time_range);
    }

    // 记忆状态过滤（排除沉睡记忆）
    searchOptions.statusFilter = 'dormant';

    // Step 3: 向量检索
    const embedStart = Date.now();
    const results = await this.vectorIndex.hybridSearch(message, searchOptions);
    const searchTime = Date.now() - startTime;

    console.log(`[UnifiedContext] 🔍 retrieve | query="${message.substring(0, 50)}" | sources=${sources.join(',')} | results=${results.length} | ${searchTime}ms | provider=${this.embedding.getProvider?.() || 'unknown'}`);

    if (results.length === 0) {
      return {
        context: '',
        sources: [],
        retrieval_meta: { trace_id: traceId, query: message, search_time_ms: searchTime, results: 0 },
      };
    }

    // Step 4: 上下文组装（Token 预算控制）
    const { context, sources: formattedSources, tokenCount } = this._assembleContext(results, tokenBudget, traceId);

    return {
      context,
      sources: formattedSources,
      retrieval_meta: {
        trace_id: traceId,
        query: message,
        mode,
        search_time_ms: searchTime,
        results: results.length,
        token_count: tokenCount,
        sources_searched: sources,
      },
    };
  }

  /**
   * 快速意图检测：判断是否需要检索
   */
  _shouldRetrieve(message) {
    if (!message || message.length < 5) return false;

    // 跳过检索的场景
    const skipPatterns = [
      /^(你好|hi|hello|hey|在吗|在不在)/i,
      /^(谢谢|感谢|thanks|ok|好的|收到)/i,
      /^(哈哈|呵呵|嗯|哦|啊)/i,
    ];
    if (skipPatterns.some(p => p.test(message.trim()))) return false;

    // 需要检索的信号
    const retrieveSignals = [
      /[?？]/,
      /怎么|如何|什么|为什么|哪里|哪个|谁/i,
      /上次|最近|之前|之前说的|那个/i,
      /进展|状态|进度|结果|反馈/i,
      /找|搜索|查|查看|看看/i,
      /帮我|帮个忙/i,
    ];

    return retrieveSignals.some(p => p.test(message));
  }

  /**
   * 组装上下文（Token 预算控制）
   */
  _assembleContext(results, tokenBudget, traceId) {
    // 按来源分配预算权重
    const weights = { notebook: 0.35, memory: 0.30, tasks: 0.15, knowledge: 0.15 };
    const budgetByType = {};
    for (const [type, weight] of Object.entries(weights)) {
      budgetByType[type] = Math.floor(tokenBudget * weight);
    }

    // 按来源分组
    const grouped = {};
    results.forEach(r => {
      if (!grouped[r.source_type]) grouped[r.source_type] = [];
      grouped[r.source_type].push(r);
    });

    // 组装上下文文本
    const parts = [];
    const sources = [];
    let tokenCount = 0;
    let refNum = 1;

    const typeLabels = {
      notebook: '相关笔记',
      memory: '相关记忆',
      tasks: '相关待办',
      knowledge: '相关知识',
    };

    for (const [type, items] of Object.entries(grouped)) {
      if (items.length === 0) continue;
      const label = typeLabels[type] || type;
      const typeBudget = budgetByType[type] || 200;
      let typeTokens = 0;

      const sectionParts = [`【${label}】`];
      for (const item of items) {
        const itemText = `[${refNum}] ${item.title}\n    ${item.content_preview}`;
        const itemTokens = Math.ceil(itemText.length / 3); // 粗估 token

        if (typeTokens + itemTokens > typeBudget) break;

        sectionParts.push(itemText);
        typeTokens += itemTokens;
        tokenCount += itemTokens;

        sources.push({
          ref_num: refNum,
          trace_id: traceId,
          source_type: item.source_type,
          source_id: item.source_id,
          vector_id: item.vector_id,
          collection: item.collection,
          title: item.title,
          content_preview: item.content_preview,
          score: item.score,
          match_type: item.match_type,
          created_at: item.created_at,
          category: item.category,
          tags: item.tags,
        });
        refNum++;
      }
      if (sectionParts.length > 1) {
        parts.push(sectionParts.join('\n'));
      }
    }

    let context = '';
    if (parts.length > 0) {
      context = `以下信息从你的本地知识库中检索得到，请在回答时引用对应的来源编号 [1][2]...\n\n${parts.join('\n\n')}`;
    }

    return { context, sources, tokenCount };
  }

  /**
   * 解析时间范围字符串为毫秒时间戳
   */
  _parseTimeRange(rangeStr) {
    if (!rangeStr) return null;
    const now = Date.now();
    const match = rangeStr.match(/(\d+)(d|w|m)/);
    if (!match) return null;
    const [, num, unit] = match;
    const multipliers = { d: 86400000, w: 604800000, m: 2592000000 };
    return now - parseInt(num) * (multipliers[unit] || 86400000);
  }
}

// Token 预算配置
const TOKEN_BUDGETS = {
  adp: 2000,
  llm: 1500,
  cc: 1000,
  scheduled: 1500,
  clipboard: 500,
};

module.exports = UnifiedContextLayer;
