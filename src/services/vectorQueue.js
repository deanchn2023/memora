/**
 * VectorizationQueue — 异步向量化队列
 * 用户操作零阻塞：数据写入 JSON/SQLite 立即返回，向量化在后台异步执行
 * 
 * v3.1 Phase 1
 * 
 * 特性：
 * - 去重：同一条数据的最新操作覆盖旧操作
 * - 批量：5秒聚合 + 批量 Embedding API 调用
 * - 重试：失败自动重试（最多3次，指数退避）
 */

class VectorizationQueue {
  constructor(vectorIndex, embeddingService) {
    this.vectorIndex = vectorIndex;
    this.embedding = embeddingService;
    this.queue = [];
    this.processing = false;
    this.maxRetries = 3;
    this.flushInterval = 5000; // 5秒聚合
    this._flushTimer = null;
    this._stats = {
      totalQueued: 0,
      totalProcessed: 0,
      totalFailed: 0,
    };
  }

  /**
   * 入队（不阻塞调用方）
   * @param {string} operation - 'upsert' | 'delete'
   * @param {string} collection - 'notes' | 'memories' | 'tasks' | 'knowledge'
   * @param {object} data - 原始数据（upsert 需要，delete 只需 id）
   */
  enqueue(operation, collection, data) {
    if (!this.vectorIndex || !this.vectorIndex.initialized) return;

    // 去重：同一条数据的最新操作覆盖旧操作
    const dataId = data?.id || data?.note_id || data?.memory_id || data?.task_id || data?.atom_id;
    if (dataId) {
      const existingIdx = this.queue.findIndex(
        item => item.collection === collection && item.dataId === dataId
      );
      if (existingIdx !== -1) {
        this.queue[existingIdx] = { operation, collection, data, dataId, retries: 0, status: 'pending' };
      } else {
        this.queue.push({ operation, collection, data, dataId, retries: 0, status: 'pending' });
      }
    } else {
      this.queue.push({ operation, collection, data, dataId: null, retries: 0, status: 'pending' });
    }

    this._stats.totalQueued++;

    // 延迟处理（聚合连续操作）
    if (this._flushTimer) clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => this._process(), this.flushInterval);
  }

  /**
   * 处理队列
   */
  async _process() {
    if (this.processing || this.queue.length === 0) return;
    if (!this.vectorIndex || !this.vectorIndex.initialized) return;

    this.processing = true;

    // 取出所有待处理项
    const batch = this.queue.splice(0);
    this._flushTimer = null;

    for (const item of batch) {
      try {
        if (item.operation === 'delete') {
          await this._executeDelete(item);
        } else {
          await this._executeUpsert(item);
        }
        item.status = 'done';
        this._stats.totalProcessed++;
      } catch (e) {
        console.error(`[VectorQueue] ${item.operation} ${item.collection} failed:`, e.message);
        item.retries++;
        if (item.retries < this.maxRetries) {
          item.status = 'pending';
          // 指数退避后重新入队
          const delay = Math.pow(2, item.retries) * 1000;
          setTimeout(() => {
            this.queue.push(item);
            if (this._flushTimer) clearTimeout(this._flushTimer);
            this._flushTimer = setTimeout(() => this._process(), 1000);
          }, delay);
        } else {
          item.status = 'failed';
          this._stats.totalFailed++;
          console.error(`[VectorQueue] Max retries exceeded for ${item.collection}/${item.dataId}`);
        }
      }
    }

    this.processing = false;

    // 如果队列还有数据，继续处理
    if (this.queue.length > 0) {
      setTimeout(() => this._process(), 1000);
    }
  }

  async _executeUpsert(item) {
    switch (item.collection) {
      case 'notes':
        await this.vectorIndex.upsertNote(item.data);
        break;
      case 'memories':
        await this.vectorIndex.upsertMemory(item.data);
        break;
      case 'tasks':
        await this.vectorIndex.upsertTask(item.data);
        break;
      case 'knowledge':
        await this.vectorIndex.upsertKnowledge(item.data);
        break;
    }
  }

  async _executeDelete(item) {
    const id = item.dataId || item.data?.id;
    if (!id) return;
    switch (item.collection) {
      case 'notes':
        await this.vectorIndex.deleteNote(id);
        break;
      case 'memories':
        await this.vectorIndex.deleteMemory(id);
        break;
      case 'tasks':
        await this.vectorIndex.deleteTask(id);
        break;
      case 'knowledge':
        await this.vectorIndex.deleteKnowledge(id);
        break;
    }
  }

  /**
   * 获取队列状态
   */
  getStats() {
    return {
      ...this._stats,
      pending: this.queue.filter(i => i.status === 'pending').length,
      processing: this.processing,
    };
  }

  /**
   * 立即 flush（不等聚合时间）
   */
  async flush() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    await this._process();
  }
}

module.exports = VectorizationQueue;
