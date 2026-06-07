/**
 * 状态检测器 (StateDetector)
 * - 屏幕锁定/解锁检测（powerMonitor）
 * - 系统空闲状态检测
 */

class StateDetector {
  constructor(powerMonitor) {
    this.powerMonitor = powerMonitor;
    this.isScreenLocked = false;
    this.isPaused = false;
    this.onLock = null;  // 屏幕锁定回调
    this.onUnlock = null; // 屏幕解锁回调

    this._setupListeners();
  }

  _setupListeners() {
    if (!this.powerMonitor) return;

    this.powerMonitor.on('lock-screen', () => {
      this.isScreenLocked = true;
      this.isPaused = true;
      console.log('[StateDetect] Screen locked, pausing clipboard monitoring');
      if (this.onLock) this.onLock();
    });

    this.powerMonitor.on('unlock-screen', () => {
      this.isScreenLocked = false;
      this.isPaused = false;
      console.log('[StateDetect] Screen unlocked, resuming clipboard monitoring');
      if (this.onUnlock) this.onUnlock();
    });
  }

  /**
   * 获取系统空闲时间（秒）
   */
  getIdleTime() {
    if (!this.powerMonitor) return 0;
    const state = this.powerMonitor.getSystemIdleState(60);
    // state: 'active', 'idle', 'locked', 'unknown'
    return state === 'idle' || state === 'locked';
  }

  destroy() {
    this.onLock = null;
    this.onUnlock = null;
  }
}

module.exports = StateDetector;
