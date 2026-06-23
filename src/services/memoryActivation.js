/**
 * MemoryActivationService — 记忆激活与利用率提升
 * 
 * v3.1 Phase 4
 * 
 * 功能：
 * 1. 活跃度评分（0-100）：检索命中 + 时间衰减 + 用户交互 + AI引用
 * 2. 记忆晋升：短期→长期（7天内被检索≥3次）
 * 3. 记忆遗忘：90天未命中 + 活跃度<10 → 标记沉睡
 * 4. 主动推荐：创建笔记/对话开始时推送相关记忆
 */

class MemoryActivationService {
  constructor(memoryStore, vectorIndex) {
    this.memoryStore = memoryStore;
    this.vectorIndex = vectorIndex;
  }

  /**
   * 记忆活跃度评分（0-100）
   */
  calculateScore(memory) {
    let score = 0;

    // 1. 检索命中加分（被向量检索命中的记忆 +10/次）
    score += (memory.metadata?.retrievalCount || 0) * 10;

    // 2. 时间衰减
    const ageDays = (Date.now() - new Date(memory.createdAt).getTime()) / 86400000;
    if (ageDays < 1) score += 30;
    else if (ageDays < 7) score += 20;
    else if (ageDays < 30) score += 10;
    else if (ageDays < 90) score += 5;

    // 3. 用户交互加分
    score += (memory.metadata?.clickCount || 0) * 15;

    // 4. AI 引用加分
    score += (memory.metadata?.injectionCount || 0) * 5;

    // 5. 重要性加权
    const importanceWeight = { high: 1.5, medium: 1.0, low: 0.5, normal: 1.0 };
    score *= importanceWeight[memory.importance] || 1.0;

    // 6. 类型加权
    const typeBonus = { long: 20, short: 10, instant: 0 };
    score += typeBonus[memory.type] || 0;

    return Math.min(Math.round(score), 100);
  }

  /**
   * 检索命中时更新活跃度
   */
  async onRetrievalHit(memoryIds, query) {
    if (!this.memoryStore) return;

    for (const id of memoryIds) {
      const memory = this.memoryStore.memories?.find(m => m.id === id);
      if (!memory) continue;

      const metadata = memory.metadata || {};
      metadata.retrievalCount = (metadata.retrievalCount || 0) + 1;
      metadata.lastRetrievedAt = new Date().toISOString();
      metadata.lastRetrievedQuery = (query || '').substring(0, 100);

      this.memoryStore.updateMemory(id, { metadata });
    }
  }

  /**
   * 记忆晋升检查：短期 → 长期
   * 条件：7天内被检索命中 ≥3 次
   */
  async checkPromotion() {
    if (!this.memoryStore) return { promoted: 0 };

    const shortMemories = this.memoryStore.getMemories({ type: 'short' });
    const now = Date.now();
    let promotedCount = 0;

    for (const memory of shortMemories) {
      const retrievalCount = memory.metadata?.retrievalCount || 0;
      const lastRetrieved = memory.metadata?.lastRetrievedAt;

      if (retrievalCount >= 3 && lastRetrieved) {
        const daysSinceLastRetrieve = (now - new Date(lastRetrieved).getTime()) / 86400000;
        if (daysSinceLastRetrieve <= 7) {
          this.memoryStore.updateMemory(memory.id, { type: 'long' });
          // 更新向量索引中的 type 字段
          if (this.vectorIndex?.initialized) {
            await this.vectorIndex.upsertMemory({ ...memory, type: 'long' });
          }
          console.log(`[MemoryActivation] Promoted ${memory.id} to long-term`);
          promotedCount++;
        }
      }
    }

    return { promoted: promotedCount };
  }

  /**
   * 记忆遗忘检查：沉睡降权
   * 条件：90天未检索 且 活跃度 < 10
   */
  async checkForgetting() {
    if (!this.memoryStore) return { dormant: 0 };

    const allMemories = this.memoryStore.getAllMemories?.() || this.memoryStore.memories || [];
    const now = Date.now();
    let dormantCount = 0;

    for (const memory of allMemories) {
      // 已沉睡的跳过
      if (memory.metadata?.status === 'dormant') continue;

      const lastRetrieved = memory.metadata?.lastRetrievedAt || memory.createdAt;
      const daysSinceLastRetrieve = (now - new Date(lastRetrieved).getTime()) / 86400000;

      if (daysSinceLastRetrieve > 90) {
        const score = this.calculateScore(memory);
        if (score < 10) {
          const metadata = { ...memory.metadata, status: 'dormant' };
          this.memoryStore.updateMemory(memory.id, { metadata });
          dormantCount++;
        }
      }
    }

    return { dormant: dormantCount };
  }

  /**
   * 获取记忆利用率统计
   */
  getUtilizationStats() {
    if (!this.memoryStore) return null;

    const allMemories = this.memoryStore.getAllMemories?.() || this.memoryStore.memories || [];
    const total = allMemories.length;
    if (total === 0) return { total: 0, utilizationRate: 0, dormantRate: 0, longTermRate: 0 };

    const retrieved = allMemories.filter(m => (m.metadata?.retrievalCount || 0) > 0);
    const dormant = allMemories.filter(m => m.metadata?.status === 'dormant');
    const longTerm = allMemories.filter(m => m.type === 'long');

    return {
      total,
      utilized: retrieved.length,
      utilizationRate: retrieved.length / total,
      dormantRate: dormant.length / total,
      longTermRate: longTerm.length / total,
      avgRetrievalCount: allMemories.reduce((sum, m) => sum + (m.metadata?.retrievalCount || 0), 0) / total,
      topRetrieved: allMemories
        .sort((a, b) => (b.metadata?.retrievalCount || 0) - (a.metadata?.retrievalCount || 0))
        .slice(0, 5)
        .map(m => ({
          content: (m.content || '').substring(0, 50),
          count: m.metadata?.retrievalCount || 0,
        })),
    };
  }
}

module.exports = MemoryActivationService;
