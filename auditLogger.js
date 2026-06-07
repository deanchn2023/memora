/**
 * AI 调用审计日志系统 (AIAuditLogger)
 * - 拦截所有 DeepSeek API 调用，记录输入/输出/时间/Token
 * - 按日存储 JSON 文件，自动清理过期日志
 * - 支持查询、分页、统计
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

class AIAuditLogger {
  constructor(userDataPath) {
    this.auditDir = path.join(userDataPath, 'audit');
    this.maxDays = 31; // 保留最近31天
    this._writeQueue = [];
    this._writing = false;
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(this.auditDir)) {
      fs.mkdirSync(this.auditDir, { recursive: true });
    }
  }

  /**
   * 记录一次 API 调用
   * @param {object} entry
   * @param {string} entry.module - 调用模块 (clipboard_analysis, agent, memory, knowledge, estimate, profile, search_keyword, optimize_prompt)
   * @param {string} entry.model - 模型名
   * @param {string} entry.baseUrl - API 基础 URL
   * @param {object} entry.input - 输入 { systemPrompt, userPrompt, systemLen, userLen }
   * @param {object} entry.output - 输出 { status, content, contentLen, finishReason }
   * @param {object} entry.tokens - Token 统计 { prompt_tokens, completion_tokens, total_tokens }
   * @param {number} entry.latencyMs - 调用耗时(ms)
   * @param {string} entry.error - 错误信息(如有)
   * @param {string} entry.traceId - 追踪ID
   */
  record(entry) {
    const now = new Date();
    const record = {
      id: crypto.randomUUID(),
      timestamp: now.toISOString(),
      module: entry.module || 'unknown',
      model: entry.model || '',
      baseUrl: (entry.baseUrl || '').replace(/\/chat\/completions$/, ''),
      input: {
        systemPromptLen: entry.input?.systemPromptLen || 0,
        userPromptLen: entry.input?.userPromptLen || 0,
        userPromptPreview: (entry.input?.userPrompt || '').substring(0, 200),
      },
      output: {
        status: entry.output?.status || null,
        contentLen: entry.output?.contentLen || 0,
        contentPreview: (entry.output?.content || '').substring(0, 300),
        finishReason: entry.output?.finishReason || null,
      },
      tokens: entry.tokens || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      latencyMs: entry.latencyMs || 0,
      error: entry.error || null,
      traceId: entry.traceId || null,
    };

    // 异步写入
    this._writeQueue.push(record);
    this._flush();
  }

  /**
   * 异步写入队列
   */
  _flush() {
    if (this._writing || this._writeQueue.length === 0) return;
    this._writing = true;

    const batch = this._writeQueue.splice(0);
    const dayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const filePath = path.join(this.auditDir, `audit_${dayKey}.json`);

    let existing = [];
    try {
      if (fs.existsSync(filePath)) {
        existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (_) {}

    existing.push(...batch);

    try {
      fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf8');
    } catch (e) {
      console.error('[Audit] 写入失败:', e.message);
    }

    this._writing = false;

    // 如果队列有新数据，继续 flush
    if (this._writeQueue.length > 0) {
      setImmediate(() => this._flush());
    }
  }

  /**
   * 查询审计日志
   * @param {object} options
   * @param {string} options.startDate - 起始日期 YYYY-MM-DD
   * @param {string} options.endDate - 结束日期 YYYY-MM-DD
   * @param {string} options.module - 按模块筛选
   * @param {number} options.page - 页码(从1开始)
   * @param {number} options.pageSize - 每页条数
   * @param {string} options.keyword - 搜索关键词
   */
  query(options = {}) {
    const {
      startDate,
      endDate,
      module,
      page = 1,
      pageSize = 20,
      keyword,
      id: queryId,
    } = options;

    // 确定日期范围
    const now = new Date();
    const end = endDate ? new Date(endDate) : now;
    const start = startDate ? new Date(startDate) : new Date(now.getTime() - 7 * 86400000);

    const allRecords = [];

    // 遍历日期范围内的文件
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayKey = d.toISOString().slice(0, 10);
      const filePath = path.join(this.auditDir, `audit_${dayKey}.json`);
      try {
        if (fs.existsSync(filePath)) {
          const records = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          allRecords.push(...records);
        }
      } catch (_) {}
    }

    // 筛选
    let filtered = allRecords;
    if (queryId) {
      filtered = filtered.filter(r => r.id === queryId);
    } else {
      if (module) {
        filtered = filtered.filter(r => r.module === module);
      }
      if (keyword) {
        const kw = keyword.toLowerCase();
        filtered = filtered.filter(r =>
          (r.id || '').toLowerCase().includes(kw) ||
          (r.input?.userPromptPreview || '').toLowerCase().includes(kw) ||
          (r.output?.contentPreview || '').toLowerCase().includes(kw) ||
          (r.error || '').toLowerCase().includes(kw) ||
          (r.module || '').toLowerCase().includes(kw)
        );
      }
    }

    // 按时间倒序
    filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // 统计
    const stats = this._calcStats(filtered);

    // 分页
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const p = Math.min(Math.max(1, page), totalPages);
    const records = filtered.slice((p - 1) * pageSize, p * pageSize);

    return { records, total, page: p, pageSize, totalPages, stats };
  }

  /**
   * 获取统计概览
   */
  _calcStats(records) {
    const byModule = {};
    let totalTokens = 0;
    let totalLatency = 0;
    let errorCount = 0;
    let successCount = 0;

    for (const r of records) {
      const mod = r.module || 'unknown';
      if (!byModule[mod]) {
        byModule[mod] = { count: 0, tokens: 0, errors: 0, totalLatency: 0 };
      }
      byModule[mod].count++;
      byModule[mod].tokens += r.tokens?.total_tokens || 0;
      byModule[mod].totalLatency += r.latencyMs || 0;
      if (r.error) {
        byModule[mod].errors++;
        errorCount++;
      } else {
        successCount++;
      }
      totalTokens += r.tokens?.total_tokens || 0;
      totalLatency += r.latencyMs || 0;
    }

    return {
      totalCalls: records.length,
      successCount,
      errorCount,
      totalTokens,
      avgLatencyMs: records.length > 0 ? Math.round(totalLatency / records.length) : 0,
      byModule,
    };
  }

  /**
   * 获取可用模块列表
   */
  getModules() {
    const modules = new Set();
    try {
      const files = fs.readdirSync(this.auditDir).filter(f => f.startsWith('audit_') && f.endsWith('.json'));
      for (const f of files) {
        try {
          const records = JSON.parse(fs.readFileSync(path.join(this.auditDir, f), 'utf8'));
          records.forEach(r => modules.add(r.module));
        } catch (_) {}
      }
    } catch (_) {}
    return [...modules].sort();
  }

  /**
   * 获取日统计（用于趋势图）
   */
  getDailyStats(days = 7) {
    const result = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const dayKey = d.toISOString().slice(0, 10);
      const filePath = path.join(this.auditDir, `audit_${dayKey}.json`);
      let count = 0, tokens = 0, errors = 0;
      try {
        if (fs.existsSync(filePath)) {
          const records = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          count = records.length;
          for (const r of records) {
            tokens += r.tokens?.total_tokens || 0;
            if (r.error) errors++;
          }
        }
      } catch (_) {}
      result.push({ date: dayKey, count, tokens, errors });
    }
    return result;
  }

  /**
   * 清理过期日志
   */
  cleanup() {
    try {
      const files = fs.readdirSync(this.auditDir).filter(f => f.startsWith('audit_') && f.endsWith('.json'));
      const cutoff = new Date(Date.now() - this.maxDays * 86400000);
      for (const f of files) {
        const dateStr = f.replace('audit_', '').replace('.json', '');
        const fileDate = new Date(dateStr);
        if (fileDate < cutoff) {
          fs.unlinkSync(path.join(this.auditDir, f));
          console.log(`[Audit] 清理过期日志: ${f}`);
        }
      }
    } catch (_) {}
  }
}

module.exports = AIAuditLogger;
