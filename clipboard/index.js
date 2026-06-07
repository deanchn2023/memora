/**
 * 剪贴板监控系统入口
 * 导出 startClipboardWatcher() 替代原 main.js 中的实现
 */

const ClipboardScheduler = require('./ClipboardScheduler');

let scheduler = null;

/**
 * 启动剪贴板监控
 * @param {object} options
 * @param {object} options.clipboard - Electron clipboard module
 * @param {object} options.powerMonitor - Electron powerMonitor
 * @param {function} options.preClassifyFn - 预分类函数
 * @param {function} options.analyzeFn - AI分析函数
 * @param {object} options.mainWindow - BrowserWindow 引用
 * @param {object} options.notebook - 记事本引用
 * @param {function} options.getSettingFn - 获取设置函数
 * @param {Set} options.processedHashes - 已处理哈希集合
 * @param {number} options.maxHashes - 最大哈希数
 * @returns {ClipboardScheduler} 调度器实例
 */
function startClipboardWatcher(options) {
  if (scheduler) {
    scheduler.stop();
  }

  scheduler = new ClipboardScheduler(options);
  scheduler.start();
  return scheduler;
}

/**
 * 获取当前调度器实例
 */
function getScheduler() {
  return scheduler;
}

/**
 * 停止剪贴板监控
 */
function stopClipboardWatcher() {
  if (scheduler) {
    scheduler.stop();
    scheduler = null;
  }
}

module.exports = {
  startClipboardWatcher,
  stopClipboardWatcher,
  getScheduler,
  ClipboardScheduler,
  ClipboardBuffer: require('./ClipboardBuffer'),
  FreqController: require('./FreqController'),
  StateDetector: require('./StateDetector'),
  AssociationHandler: require('./associationHandler')
};
