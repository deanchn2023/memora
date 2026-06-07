/**
 * 剪贴板内容暂存器 (ClipboardBuffer)
 * - 聚合短时间内的多次复制操作（聊天场景核心需求）
 * - 判断内容是否"稳定"（用户复制完毕）
 * - 合并后整体交给 AI，而非逐条分析
 */

class ClipboardBuffer {
  constructor(options = {}) {
    this.maxFragments = options.maxFragments || 20;
    this.maxTotalLength = options.maxTotalLength || 3000;
    this.stableTimeoutNormal = options.stableTimeoutNormal || 3000;
    this.stableTimeoutHighFreq = options.stableTimeoutHighFreq || 5000;
    this.stableTimeoutUltraFreq = options.stableTimeoutUltraFreq || 8000;

    this.fragments = [];
    this.lastUpdateTime = 0;
    this.stableTimer = null;
    this.isStable = true;
    this.onStable = null; // 回调：稳定后触发分析
  }

  /**
   * 追加一个片段到暂存器
   * @param {string} text - 剪贴板文本
   * @param {object} preClassifyResult - 预分类结果
   * @param {number} stableTimeout - 建议的稳定超时（由 FreqController 计算）
   * @returns {boolean} true=成功追加, false=被丢弃
   */
  addFragment(text, preClassifyResult, stableTimeout) {
    // 检查是否已达上限
    const currentLength = this.fragments.reduce((sum, f) => sum + f.text.length, 0);
    if (this.fragments.length >= this.maxFragments || currentLength + text.length > this.maxTotalLength) {
      // 达到上限，立即稳定
      console.log(`[Buffer] Limit reached (${this.fragments.length} fragments, ${currentLength} chars), forcing stable`);
      this._forceStable();
      return false;
    }

    this.fragments.push({
      text,
      timestamp: Date.now(),
      preClassifyResult
    });
    this.lastUpdateTime = Date.now();
    this.isStable = false;

    // 重置稳定计时器
    this._resetStableTimer(stableTimeout || this.stableTimeoutNormal);
    console.log(`[Buffer] Fragment added (${this.fragments.length}/${this.maxFragments}), stable timeout: ${stableTimeout}ms`);

    return true;
  }

  /**
   * 重置稳定计时器
   */
  _resetStableTimer(timeout) {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
    }
    this.stableTimer = setTimeout(() => {
      this._onStableTimeout();
    }, timeout);
  }

  /**
   * 稳定超时触发
   */
  _onStableTimeout() {
    this.stableTimer = null;
    this.isStable = true;
    console.log(`[Buffer] Stable after ${this.fragments.length} fragments`);

    if (this.onStable) {
      const mergedText = this.getMergedText();
      const fragmentCount = this.fragments.length;
      this.onStable(mergedText, fragmentCount);
    }

    // 清空暂存
    this.fragments = [];
  }

  /**
   * 强制稳定（达到上限时）
   */
  _forceStable() {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }

    if (this.fragments.length === 0) return;

    this.isStable = true;
    if (this.onStable) {
      const mergedText = this.getMergedText();
      const fragmentCount = this.fragments.length;
      this.onStable(mergedText, fragmentCount);
    }
    this.fragments = [];
  }

  /**
   * 合并所有片段为完整文本
   */
  getMergedText() {
    if (this.fragments.length === 0) return '';
    if (this.fragments.length === 1) return this.fragments[0].text;

    const parts = this.fragments.map((f, i) => f.text);
    return `[以下是从剪贴板分 ${this.fragments.length} 次复制的内容，按时间顺序拼接]\n\n${parts.join('\n\n---\n\n')}`;
  }

  /**
   * 当前片段数
   */
  get fragmentCount() {
    return this.fragments.length;
  }

  /**
   * 当前总长度
   */
  get totalLength() {
    return this.fragments.reduce((sum, f) => sum + f.text.length, 0);
  }

  /**
   * 是否有暂存中的内容
   */
  get hasContent() {
    return this.fragments.length > 0;
  }

  /**
   * 销毁
   */
  destroy() {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
    this.fragments = [];
    this.onStable = null;
  }
}

module.exports = ClipboardBuffer;
