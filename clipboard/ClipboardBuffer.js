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
    this.stableTimeoutNormal = options.stableTimeoutNormal || 5000;
    this.stableTimeoutHighFreq = options.stableTimeoutHighFreq || 7000;
    this.stableTimeoutUltraFreq = options.stableTimeoutUltraFreq || 10000;

    this.fragments = [];
    this.lastUpdateTime = 0;
    this.stableTimer = null;
    this.isStable = true;
    this.onStable = null;
    this._logTarget = null;
  }

  setLogTarget(logFn) {
    this._logTarget = logFn;
  }

  _log(msg) {
    console.log(msg);
    if (this._logTarget) this._logTarget(msg);
  }

  addFragment(text, preClassifyResult, stableTimeout) {
    const currentLength = this.fragments.reduce((sum, f) => sum + f.text.length, 0);
    if (this.fragments.length >= this.maxFragments || currentLength + text.length > this.maxTotalLength) {
      this._log(`[Buffer] 🚫 达到上限 (${this.fragments.length}条, ${currentLength}字), 强制合并`);
      this._forceStable();
      return false;
    }

    this.fragments.push({
      text,
      timestamp: Date.now(),
      hash: null
    });
    this.lastUpdateTime = Date.now();
    this.isStable = false;

    this._resetStableTimer(stableTimeout || this.stableTimeoutNormal);
    this._log(`[Buffer] ➕ 第${this.fragments.length}条入缓冲区 | "${text.substring(0, 50).replace(/\n/g, '↵')}${text.length > 50 ? '...' : ''}" | 等${stableTimeout}ms后合并`);

    return true;
  }

  _resetStableTimer(timeout) {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this._log(`[Buffer] 🔄 又检测到新复制，重置稳定计时器 → ${timeout}ms`);
    }
    this.stableTimer = setTimeout(() => {
      this._onStableTimeout();
    }, timeout);
  }

  _onStableTimeout() {
    this.stableTimer = null;
    this.isStable = true;
    this._log(`[Buffer] ⏰ 稳定超时触发! ${this.fragments.length}条内容将合并`);
    this.fragments.forEach((f, i) => {
      this._log(`[Buffer]   #${i + 1}: "${f.text.substring(0, 40).replace(/\n/g, '↵')}${f.text.length > 40 ? '...' : ''}" (${f.text.length}字)`);
    });

    if (this.onStable) {
      const mergedText = this.getMergedText();
      const fragmentCount = this.fragments.length;
      const { getClipboardHash } = require('./hashUtils');
      const fragmentHashes = this.fragments.map(f => getClipboardHash(f.text));
      this.onStable(mergedText, fragmentCount, fragmentHashes);
    }

    this.fragments = [];
  }

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
      const { getClipboardHash } = require('./hashUtils');
      const fragmentHashes = this.fragments.map(f => getClipboardHash(f.text));
      this.onStable(mergedText, fragmentCount, fragmentHashes);
    }
    this.fragments = [];
  }

  getMergedText() {
    if (this.fragments.length === 0) return '';
    if (this.fragments.length === 1) return this.fragments[0].text;

    const parts = this.fragments.map((f, i) => f.text);
    return `[以下是从剪贴板分 ${this.fragments.length} 次复制的内容，按时间顺序拼接]\n\n${parts.join('\n\n---\n\n')}`;
  }

  get fragmentCount() {
    return this.fragments.length;
  }

  get totalLength() {
    return this.fragments.reduce((sum, f) => sum + f.text.length, 0);
  }

  get hasContent() {
    return this.fragments.length > 0;
  }

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
