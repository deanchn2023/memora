/**
 * 剪贴板调度引擎 (ClipboardScheduler)
 * - 整合暂存器、频率控制器、状态检测器
 * - 替代原 startClipboardWatcher() 的简单 setInterval
 */

const ClipboardBuffer = require('./ClipboardBuffer');
const FreqController = require('./FreqController');
const StateDetector = require('./StateDetector');
const AssociationHandler = require('./associationHandler');
const { getClipboardHash } = require('./hashUtils');

class ClipboardScheduler {
  constructor(options = {}) {
    this.clipboard = options.clipboard; // Electron clipboard module
    this.powerMonitor = options.powerMonitor; // Electron powerMonitor
    this.preClassifyFn = options.preClassifyFn; // 预分类函数
    this.analyzeFn = options.analyzeFn; // 分析函数
    this.mainWindow = options.mainWindow; // BrowserWindow 引用
    this.notebook = options.notebook; // 记事本引用
    this.getSettingFn = options.getSettingFn; // 获取设置函数
    this.processedHashes = options.processedHashes || new Set(); // 已处理哈希
    this.maxHashes = options.maxHashes || 500;

    // 暂存器
    this.buffer = new ClipboardBuffer({
      maxFragments: 20,
      maxTotalLength: 3000,
      stableTimeoutNormal: 3000,
      stableTimeoutHighFreq: 5000,
      stableTimeoutUltraFreq: 8000
    });
    this.buffer.onStable = (mergedText, fragmentCount) => {
      this._onBufferStable(mergedText, fragmentCount);
    };

    // 频率控制器
    this.freqController = new FreqController({
      normalInterval: 2000,
      idleInterval: 15000,
      idleThreshold: 60000
    });

    // 状态检测器
    this.stateDetector = new StateDetector(this.powerMonitor);
    this.stateDetector.onLock = () => { this._pause(); };
    this.stateDetector.onUnlock = () => { this._resume(); };

    // 关联处理器
    this.associationHandler = new AssociationHandler(this.notebook);

    // 调度状态
    this.isRunning = false;
    this.pollTimer = null;
    this.lastClipboardText = '';
    this.isAnalyzing = false;

    // 清理计时器（每小时清理频率历史）
    this.cleanupTimer = null;
  }

  /**
   * 启动调度
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('[Scheduler] Starting clipboard scheduler...');
    this._scheduleNextPoll();

    // 每小时清理频率历史
    this.cleanupTimer = setInterval(() => {
      this.freqController.cleanup();
    }, 3600000);
  }

  /**
   * 停止调度
   */
  stop() {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.buffer.destroy();
    this.stateDetector.destroy();
    console.log('[Scheduler] Stopped');
  }

  /**
   * 调度下一次轮询
   */
  _scheduleNextPoll() {
    if (!this.isRunning) return;

    const interval = this._isEnabled('clipboard_freq_enabled')
      ? this.freqController.computeInterval()
      : 10000; // 回退到原 10s

    this.pollTimer = setTimeout(() => {
      this._poll();
      this._scheduleNextPoll();
    }, interval);
  }

  /**
   * 执行一次轮询
   */
  _poll() {
    if (!this.isRunning) return;
    if (this.stateDetector.isPaused) return;

    try {
      const currentText = this.clipboard.readText();
      if (!currentText || currentText === this.lastClipboardText) return;

      // 去重检查
      const hash = getClipboardHash(currentText);
      if (this.processedHashes.has(hash)) {
        this.lastClipboardText = currentText;
        return;
      }

      console.log(`[Scheduler] Clipboard change detected: "${currentText.substring(0, 50)}..."`);
      this.lastClipboardText = currentText;

      // 检查是否启用暂存
      if (this._isEnabled('clipboard_buffer_enabled')) {
        this._handleWithBuffer(currentText);
      } else {
        // 简单模式：直接分析
        if (this.analyzeFn) {
          this.analyzeFn(currentText);
        }
      }
    } catch (e) {
      console.error('[Scheduler] Poll error:', e);
    }
  }

  /**
   * 通过暂存器处理（聚合模式）
   */
  _handleWithBuffer(text) {
    // 轻量 preClassify 入场过滤
    if (this.preClassifyFn) {
      const preResult = this.preClassifyFn(text);
      if (!preResult.shouldAnalyze) {
        console.log('[Scheduler] Pre-classify rejected:', preResult.reason);
        return;
      }

      // 记录复制事件，获取建议的稳定超时
      const stableTimeout = this.freqController.recordCopy();

      // 通知前端暂存状态
      this._sendBufferStatus();

      // 追加到暂存器
      this.buffer.addFragment(text, preResult, stableTimeout);
    }
  }

  /**
   * 暂存器稳定回调
   */
  _onBufferStable(mergedText, fragmentCount) {
    console.log(`[Scheduler] Buffer stable: ${fragmentCount} fragments, ${mergedText.length} chars`);

    // 检查合并后文本是否已处理
    const hash = getClipboardHash(mergedText);
    if (this.processedHashes.has(hash)) {
      console.log('[Scheduler] Merged text already processed, skipping');
      return;
    }

    // 标记每个片段为已处理（防止重复）
    for (const frag of this.buffer.fragments || []) {
      const fragHash = getClipboardHash(frag.text);
      this._markProcessed(fragHash);
    }

    // 调用分析函数
    if (this.analyzeFn) {
      this.analyzeFn(mergedText);
    }
  }

  /**
   * 标记哈希为已处理
   */
  _markProcessed(hash) {
    this.processedHashes.add(hash);
    if (this.processedHashes.size > this.maxHashes) {
      const first = this.processedHashes.values().next().value;
      this.processedHashes.delete(first);
    }
  }

  /**
   * 发送暂存状态到前端
   */
  _sendBufferStatus() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('clipboard-buffer-status', {
        fragmentCount: this.buffer.fragmentCount,
        totalLength: this.buffer.totalLength,
        isStable: this.buffer.isStable
      });
    }
  }

  /**
   * 暂停（屏幕锁定等）
   */
  _pause() {
    // 如果暂存器有内容，立即稳定
    if (this.buffer.hasContent) {
      this.buffer._forceStable();
    }
  }

  /**
   * 恢复（屏幕解锁等）
   */
  _resume() {
    // 检查剪贴板是否有新内容
    try {
      const currentText = this.clipboard.readText();
      if (currentText && currentText !== this.lastClipboardText) {
        this.lastClipboardText = currentText;
        if (this._isEnabled('clipboard_buffer_enabled')) {
          this._handleWithBuffer(currentText);
        } else if (this.analyzeFn) {
          this.analyzeFn(currentText);
        }
      }
    } catch (e) {
      console.error('[Scheduler] Resume check error:', e);
    }
  }

  /**
   * 获取关联处理器（用于 analyzeClipboardText 调用）
   */
  getAssociationHandler() {
    return this.associationHandler;
  }

  /**
   * 更新 notebook 引用
   */
  setNotebook(notebook) {
    this.notebook = notebook;
    this.associationHandler.notebook = notebook;
  }

  /**
   * 更新 mainWindow 引用
   */
  setMainWindow(win) {
    this.mainWindow = win;
  }

  /**
   * 检查配置是否启用
   */
  _isEnabled(key) {
    if (this.getSettingFn) {
      const val = this.getSettingFn(key);
      return val !== false && val !== 'false'; // 默认启用
    }
    return true; // 无设置时默认启用
  }
}

module.exports = ClipboardScheduler;
