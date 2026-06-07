/**
 * 频率控制器 (FreqController)
 * - 动态调整轮询间隔
 * - 高频检测 → 延长稳定超时 + 加速轮询
 * - 连续复制场景：5s/10s 窗口检测，匹配真实用户行为
 */

class FreqController {
  constructor(options = {}) {
    this.normalInterval = options.normalInterval || 1000;    // 正常轮询间隔
    this.activeInterval = options.activeInterval || 400;     // 活跃复制时轮询间隔（加速，3s内多次复制不漏检）
    this.idleInterval = options.idleInterval || 15000;       // 空闲轮询间隔
    this.idleThreshold = options.idleThreshold || 60000;     // 空闲判定阈值
    this.activeThreshold = options.activeThreshold || 10000; // 活跃判定阈值（10s内有复制）

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
    const recent3s = this.lastCopyTimestamps.filter(t => now - t < 3000).length;
    const recent5s = this.lastCopyTimestamps.filter(t => now - t < 5000).length;
    const recent10s = this.lastCopyTimestamps.filter(t => now - t < 10000).length;

    if (recent3s >= 3) return 10000;  // 超高频（3s内3次）：10秒稳定，等用户复制完
    if (recent5s >= 3) return 8000;   // 高频（5s内3次）：8秒稳定
    if (recent5s >= 2) return 7000;   // 中频（5s内2次）：7秒稳定
    if (recent10s >= 2) return 5000;  // 低频连续（10s内2次）：5秒稳定
    return 5000;                       // 正常：5秒稳定
  }

  /**
   * 判断当前是否处于活跃复制状态
   */
  isActive() {
    const now = Date.now();
    return this.lastCopyTimestamps.some(t => now - t < this.activeThreshold);
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
    // 活跃复制时加速轮询，减少漏检
    if (this.isActive()) {
      return this.activeInterval; // 活跃：1秒
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
