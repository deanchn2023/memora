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
    this.clipboard = options.clipboard;
    this.powerMonitor = options.powerMonitor;
    this.preClassifyFn = options.preClassifyFn;
    this.analyzeFn = options.analyzeFn;
    this.mainWindow = options.mainWindow;
    this.notebook = options.notebook;
    this.getSettingFn = options.getSettingFn;
    this.processedHashes = options.processedHashes || new Set();
    this.maxHashes = options.maxHashes || 500;

    // 暂存器
    this.buffer = new ClipboardBuffer({
      maxFragments: 20,
      maxTotalLength: 3000,
      stableTimeoutNormal: 5000,
      stableTimeoutHighFreq: 7000,
      stableTimeoutUltraFreq: 10000
    });
    this.buffer.onStable = (mergedText, fragmentCount, fragmentHashes) => {
      this._onBufferStable(mergedText, fragmentCount, fragmentHashes);
    };
    // Buffer 日志转发到 DevTools
    this.buffer.setLogTarget((msg) => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        try {
          this.mainWindow.webContents.send('clipboard-log', msg);
        } catch (_) {}
      }
    });

    // 频率控制器
    this.freqController = new FreqController({
      normalInterval: 1000,
      activeInterval: 400,
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
    this._pollCount = 0; // 轮询计数

    // 待重试的分析队列
    this.pendingAnalysis = [];
    this.maxPending = 5;

    // 清理计时器
    this.cleanupTimer = null;
    this._heartbeatTimer = null;

    // 上次轮询间隔（日志节流用）
    this._lastPollInterval = 0;
    // "无变化"日志节流：每5秒最多输出一次
    this._lastNoChangeLogTime = 0;
  }

  /**
   * 双通道日志：终端 + DevTools Console
   */
  _log(msg) {
    console.log(msg);
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send('clipboard-log', msg);
      } catch (_) {}
    }
  }

  /**
   * 启动调度
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    this._log('[Scheduler] 🚀 启动剪贴板调度器');
    this._log(`[Scheduler] 配置: 动态频率=${this._isEnabled('clipboard_freq_enabled')} 缓冲区=${this._isEnabled('clipboard_buffer_enabled')} 已处理哈希=${this.processedHashes.size}条`);
    
    // 首次轮询：读取当前剪贴板内容
    try {
      const currentText = this.clipboard.readText();
      if (currentText) {
        this.lastClipboardText = currentText;
        this._log(`[Scheduler] 📋 当前剪贴板内容: "${currentText.substring(0, 60).replace(/\n/g, '↵')}${currentText.length > 60 ? '...' : ''}" (${currentText.length}字)`);
      } else {
        this._log(`[Scheduler] 📋 当前剪贴板为空`);
      }
    } catch (e) {
      this._log(`[Scheduler] ❌ 读取剪贴板失败: ${e.message}`);
    }
    
    this._scheduleNextPoll();

    // 每小时清理频率历史
    this.cleanupTimer = setInterval(() => {
      this.freqController.cleanup();
    }, 3600000);
    
    // 🔧 每60秒输出心跳日志，确认调度器在运行
    this._heartbeatTimer = setInterval(() => {
      if (this.isRunning) {
        this._log(`[Scheduler] 💓 心跳 | 运行中 | isAnalyzing=${this.isAnalyzing} | 缓冲区=${this.buffer.fragmentCount}条 | 已处理=${this.processedHashes.size} | 排队=${this.pendingAnalysis.length}`);
      }
    }, 60000);
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
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    this.buffer.destroy();
    this.stateDetector.destroy();
    this.pendingAnalysis = [];
    this._log('[Scheduler] 已停止');
  }

  /**
   * 调度下一次轮询（日志只在间隔变化时输出）
   */
  _scheduleNextPoll() {
    if (!this.isRunning) return;

    const interval = this._isEnabled('clipboard_freq_enabled')
      ? this.freqController.computeInterval()
      : 10000;

    // 只在间隔变化时输出日志，避免刷屏
    if (interval !== this._lastPollInterval) {
      const mode = interval <= 500 ? '🟢活跃' : interval <= 1500 ? '🟡正常' : '⚪空闲';
      this._log(`[Scheduler] ⏱️ 轮询间隔变化: ${this._lastPollInterval}ms → ${interval}ms ${mode}`);
      this._lastPollInterval = interval;
    }

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

    this._pollCount++;
    try {
      const currentText = this.clipboard.readText();
      
      // 无内容
      if (!currentText) {
        // 首次轮询或有变化时输出
        if (this._pollCount <= 3) {
          this._log(`[Scheduler] 🔘 第${this._pollCount}次轮询: 剪贴板为空`);
        }
        return;
      }
      
      // 无变化（节流日志：5秒最多输出一次）
      if (currentText === this.lastClipboardText) {
        const now = Date.now();
        if (now - this._lastNoChangeLogTime > 5000) {
          this._log(`[Scheduler] 🔘 无变化 | 剪贴板: "${currentText.substring(0, 40).replace(/\n/g, '↵')}..."`);
          this._lastNoChangeLogTime = now;
        }
        return;
      }

      // 去重检查（已处理过的内容）
      const hash = getClipboardHash(currentText);
      if (this.processedHashes.has(hash)) {
        this._log(`[Scheduler] 🔁 已处理过，跳过: "${currentText.substring(0, 40).replace(/\n/g, '↵')}..."`);
        this.lastClipboardText = currentText;
        return;
      }

      this._log(`[Scheduler] 📋 ✨ 检测到剪贴板变化: "${currentText.substring(0, 80).replace(/\n/g, '↵')}${currentText.length > 80 ? '...' : ''}" (${currentText.length}字)`);
      this.lastClipboardText = currentText;

      // 检查是否启用暂存
      if (this._isEnabled('clipboard_buffer_enabled')) {
        this._handleWithBuffer(currentText);
      } else {
        this._log(`[Scheduler] ⚡ 无缓冲模式，直接分析`);
        this._doAnalyze(currentText);
      }
    } catch (e) {
      this._log(`[Scheduler] ❌ 轮询错误: ${e.message}`);
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
        this._log(`[Scheduler] 🚫 预分类拒绝: ${preResult.reason} | "${text.substring(0, 30).replace(/\n/g, '↵')}..."`);
        this._markProcessed(getClipboardHash(text));
        return;
      }
      this._log(`[Scheduler] ✅ 预分类通过: ${preResult.reason}`);
    }

    // 记录复制事件，获取建议的稳定超时
    const stableTimeout = this.freqController.recordCopy();
    const freqStats = this._getFreqStats();

    // 通知前端暂存状态
    this._sendBufferStatus();

    // 追加到暂存器
    const prevCount = this.buffer.fragmentCount;
    this.buffer.addFragment(text, null, stableTimeout);
    this._log(`[Scheduler] 📦 暂存第${prevCount + 1}条 → 缓冲区现有${this.buffer.fragmentCount}条, 共${this.buffer.totalLength}字 | 等待${stableTimeout}ms后合并 | 频率: ${freqStats}`);
  }

  /**
   * 获取频率统计摘要
   */
  _getFreqStats() {
    const now = Date.now();
    const ts = this.freqController.lastCopyTimestamps;
    const recent3s = ts.filter(t => now - t < 3000).length;
    const recent5s = ts.filter(t => now - t < 5000).length;
    const recent10s = ts.filter(t => now - t < 10000).length;
    return `3s:${recent3s}次 5s:${recent5s}次 10s:${recent10s}次`;
  }

  /**
   * 暂存器稳定回调
   * 🔧 修复：先调用AI分析，分析成功后再标记哈希（之前是先标记导致分析被跳过）
   */
  _onBufferStable(mergedText, fragmentCount, fragmentHashes) {
    this._log(`[Scheduler] ✨ 缓冲区稳定! ${fragmentCount}条内容已合并, 共${mergedText.length}字`);
    if (fragmentCount > 1) {
      this._log(`[Scheduler] 📝 合并预览: "${mergedText.substring(0, 120).replace(/\n/g, '↵')}..."`);
    } else {
      this._log(`[Scheduler] 📝 单条内容: "${mergedText.substring(0, 80).replace(/\n/g, '↵')}..."`);
    }

    // 检查合并后文本是否已处理
    const hash = getClipboardHash(mergedText);
    if (this.processedHashes.has(hash)) {
      this._log('[Scheduler] 🔁 合并文本已处理过，跳过');
      // 🔧 修复：跳过时也要重置 isAnalyzing
      return;
    }

    // 🔧 关键修复：先不标记哈希！等 AI 分析完成后再标记
    // 保存 fragmentHashes，在 onAnalysisComplete 后统一标记
    this._pendingFragmentHashes = fragmentHashes || [];

    // 调用分析函数
    this._log(`[Scheduler] 🤖 提交AI分析...`);
    this._doAnalyze(mergedText);
  }

  /**
   * 执行分析（带重试机制）
   * 🔧 修复：正确 await analyzeFn，捕获异步错误
   */
  async _doAnalyze(text) {
    if (this.isAnalyzing) {
      if (this.pendingAnalysis.length < this.maxPending) {
        this.pendingAnalysis.push(text);
        this._log(`[Scheduler] ⏳ AI正在分析中，加入等待队列 (排队: ${this.pendingAnalysis.length})`);
      } else {
        this._log('[Scheduler] ❌ AI忙碌且队列已满，丢弃内容');
      }
      return;
    }

    // 🔧 关键修复：设置 isAnalyzing 标志
    this.isAnalyzing = true;

    if (this.analyzeFn) {
      this._log(`[Scheduler] 🚀 开始AI分析 (${text.length}字)...`);
      try {
        const result = this.analyzeFn(text);
        // 如果 analyzeFn 返回 Promise（async 函数），await 它
        if (result && typeof result.then === 'function') {
          await result;
          this._log(`[Scheduler] ✅ analyzeFn Promise resolved`);
        }
      } catch (err) {
        this._log(`[Scheduler] ❌ analyzeFn 异常: ${err.message}\n${err.stack}`);
        // 即使出错也要重置 isAnalyzing
        this.isAnalyzing = false;
        this._pendingFragmentHashes = null;
        // 处理待重试队列
        if (this.pendingAnalysis.length > 0) {
          const next = this.pendingAnalysis.shift();
          this._log(`[Scheduler] 🔄 异常后处理排队内容 (剩余排队: ${this.pendingAnalysis.length})`);
          setImmediate(() => this._doAnalyze(next));
        }
      }
    } else {
      this.isAnalyzing = false;
    }
  }

  /**
   * 通知分析完成（由 analyzeFn 的 finally 块调用）
   * 🔧 修复：分析完成后才标记片段哈希为已处理
   */
  onAnalysisComplete() {
    this.isAnalyzing = false;
    this._log(`[Scheduler] ✅ AI分析完成`);

    // 🔧 关键修复：AI分析完成后，才标记片段哈希为已处理
    if (this._pendingFragmentHashes && this._pendingFragmentHashes.length > 0) {
      for (const fragHash of this._pendingFragmentHashes) {
        this._markProcessed(fragHash);
      }
      this._log(`[Scheduler] 🔖 已标记${this._pendingFragmentHashes.length}个片段为已处理`);
      this._pendingFragmentHashes = null;
    }

    // 处理待重试队列
    if (this.pendingAnalysis.length > 0) {
      const next = this.pendingAnalysis.shift();
      this._log(`[Scheduler] 🔄 处理排队内容 (剩余排队: ${this.pendingAnalysis.length})`);
      setImmediate(() => {
        this._doAnalyze(next);
      });
    }
  }

  /**
   * 清除已处理哈希（测试用）
   */
  clearProcessedHashes() {
    this.processedHashes.clear();
    this._log('[Scheduler] 🗑️ 已清除所有处理哈希，可重新检测之前的内容');
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
    if (this.buffer.hasContent) {
      this.buffer._forceStable();
    }
  }

  /**
   * 恢复（屏幕解锁等）
   */
  _resume() {
    try {
      const currentText = this.clipboard.readText();
      if (currentText && currentText !== this.lastClipboardText) {
        this.lastClipboardText = currentText;
        if (this._isEnabled('clipboard_buffer_enabled')) {
          this._handleWithBuffer(currentText);
        } else {
          this._doAnalyze(currentText);
        }
      }
    } catch (e) {
      this._log(`[Scheduler] 恢复检查错误: ${e.message}`);
    }
  }

  getAssociationHandler() {
    return this.associationHandler;
  }

  setNotebook(notebook) {
    this.notebook = notebook;
    this.associationHandler.notebook = notebook;
  }

  setMainWindow(win) {
    this.mainWindow = win;
  }

  _isEnabled(key) {
    if (this.getSettingFn) {
      const val = this.getSettingFn(key);
      return val !== false && val !== 'false';
    }
    return true;
  }
}

module.exports = ClipboardScheduler;
