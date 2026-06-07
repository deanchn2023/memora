/**
 * 频率控制器 (FreqController)
 * - 动态调整轮询间隔
 * - 高频检测 → 延长稳定超时（而非加快轮询）
 */

class FreqController {
  constructor(options = {}) {
    this.normalInterval = options.normalInterval || 2000;    // 正常轮询间隔
    this.idleInterval = options.idleInterval || 15000;       // 空闲轮询间隔
    this.idleThreshold = options.idleThreshold || 60000;     // 空闲判定阈值

    this.lastCopyTimestamps = []; // 最近 N 次复制时间
    this.maxHistory = 50;
  }

  /**
   * 记录一次复制事件，返回建议的稳定超时
   */
  recordCopy() {
    const now = Date.now();
    this.lastCopyTimestamps.push(now);
    if (this.lastCopyTimestamps.length > this.maxHistory) {
      this.lastCopyTimestamps.shift();
    }

    // 统计最近时间窗口内的复制次数
    const recent2s = this.lastCopyTimestamps.filter(t => now - t < 2000).length;
    const recent5s = this.lastCopyTimestamps.filter(t => now - t < 5000).length;

    if (recent2s >= 3) return 8000;  // 超高频：8秒
    if (recent5s >= 2) return 5000;  // 高频：5秒
    return 3000;                      // 正常：3秒
  }

  /**
   * 计算当前轮询间隔
   */
  computeInterval() {
    const now = Date.now();
    const lastCopy = this.lastCopyTimestamps.length > 0
      ? this.lastCopyTimestamps[this.lastCopyTimestamps.length - 1]
      : 0;
    const timeSinceLastCopy = now - lastCopy;

    if (timeSinceLastCopy > this.idleThreshold) {
      return this.idleInterval; // 空闲：15秒
    }
    return this.normalInterval; // 正常：2秒
  }

  /**
   * 清理超过1小时的历史
   */
  cleanup() {
    const oneHourAgo = Date.now() - 3600000;
    this.lastCopyTimestamps = this.lastCopyTimestamps.filter(t => t > oneHourAgo);
  }
}

module.exports = FreqController;
