# 剪贴板监控动态优化设计方案

## 一、需求背景

### 1.1 当前问题

当前剪贴板监控采用**静态定时轮询**方式，存在以下问题：

| 问题 | 描述 | 影响 |
|------|------|------|
| **复制不全** | 单次复制内容较大时，可能只复制了一半就被检测到 | 任务识别错误、截断 |
| **资源浪费** | 无论用户是否活跃，系统都按固定频率检测 | CPU/内存消耗 |
| **时机不当** | 用户连续复制时，中间复制被误认为独立事件 | 重复处理、噪声数据 |
| **缺乏智能** | 无法感知用户操作状态和复制意图 | 体验差、效率低 |

### 1.2 优化目标

```
用户复制 → 暂存观察 → 内容稳定 → 智能分析 → 灵活响应
              ↓
        检测是否有后续复制
        用户是否在操作
        复制频率是否高
```

---

## 二、设计方案

### 2.1 核心设计理念

**三级缓冲机制**：
1. **捕获层**：快速捕获剪贴板变化，但不立即处理
2. **观察层**：暂存内容，观察是否有后续复制
3. **决策层**：根据用户状态和复制模式，决定何时处理

**自适应频率控制**：
- 用户活跃时：提高检测频率，快速响应
- 用户空闲时：降低检测频率，节省资源
- 复制高峰时：启用缓冲模式，避免截断

### 2.2 系统状态机

```
                    ┌─────────────────────────────────┐
                    │         IDLE (空闲)              │
                    │  - 最低检测频率 (5秒/次)          │
                    │  - 等待剪贴板变化                 │
                    └──────────┬──────────────────────┘
                               │ 检测到变化
                               ▼
                    ┌─────────────────────────────────┐
                    │        CAPTURED (已捕获)         │
                    │  - 启动暂存计时器                 │
                    │  - 记录首次捕获时间               │
                    │  - 等待后续变化或超时             │
                    └──────────┬──────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │ 超时            │ 再次变化        │ 快速连续变化
              │ (1.5秒无变化)   │ (500ms内)      │ (>3次/2秒)
              ▼                ▼                ▼
    ┌─────────────────┐ ┌──────────────┐ ┌──────────────────┐
    │ CONFIRMED (确认) │ │ CONTINUE     │ │ BURST (爆发模式)  │
    │ - 执行任务分析   │ │ (继续观察)   │ │ - 启动缓冲队列   │
    │ - 重置状态      │ │ - 重置计时   │ │ - 等待平息       │
    └─────────────────┘ └──────────────┘ └────────┬─────────┘
                                                  │ 平息超时
                                                  │ (2秒无变化)
                                                  ▼
                                        ┌──────────────────┐
                                        │ BATCH_PROCESS    │
                                        │ (批量处理)       │
                                        │ - 合并处理队列   │
                                        │ - 保留最新内容   │
                                        │ - 重置状态       │
                                        └──────────────────┘
```

---

## 三、详细设计

### 3.1 状态定义与转换

```javascript
// clipboard/StateDetector.js

/**
 * 剪贴板监控状态枚举
 */
const ClipboardState = {
  IDLE: 'idle',           // 空闲状态
  CAPTURED: 'captured',   // 已捕获变化
  CONFIRMED: 'confirmed',  // 内容已确认
  CONTINUE: 'continue',    // 继续观察
  BURST: 'burst',          // 爆发模式
  BATCH_PROCESS: 'batch',  // 批量处理
};

/**
 * 状态检测器
 */
class StateDetector {
  constructor(options = {}) {
    // 状态
    this.currentState = ClipboardState.IDLE;
    
    // 配置参数
    this.config = {
      idleInterval: options.idleInterval || 5000,           // 空闲检测间隔 (ms)
      activeInterval: options.activeInterval || 500,          // 活跃检测间隔 (ms)
      confirmTimeout: options.confirmTimeout || 1500,         // 确认超时 (ms)
      burstThreshold: options.burstThreshold || 3,            // 爆发阈值 (次)
      burstTimeWindow: options.burstTimeWindow || 2000,       // 爆发时间窗口 (ms)
      batchTimeout: options.batchTimeout || 2000,              // 批量处理超时 (ms)
      ...options
    };
    
    // 状态数据
    this.stateData = {
      capturedAt: null,
      capturedContent: null,
      capturedHash: null,
      continueCount: 0,
      burstEvents: [],
      pendingContent: null,
    };
    
    // 用户活动状态
    this.userActivity = {
      lastActivity: Date.now(),
      isActive: false,
      idleThreshold: 30000,  // 30秒无活动视为空闲
    };
  }
  
  /**
   * 检测剪贴板变化
   * @param {string} content - 当前剪贴板内容
   * @returns {Object} { shouldProcess, state, content }
   */
  checkClipboardChange(content) {
    const now = Date.now();
    const contentHash = this._hashContent(content);
    
    // 检查用户活动状态
    this._updateUserActivity(now);
    
    // 获取当前检测间隔
    const currentInterval = this._getCurrentInterval();
    
    // 内容未变化，跳过
    if (contentHash === this.stateData.capturedHash) {
      return { shouldProcess: false, state: this.currentState, interval: currentInterval };
    }
    
    // 内容发生变化
    const result = this._handleContentChange(content, contentHash, now);
    return result;
  }
  
  /**
   * 处理内容变化
   */
  _handleContentChange(content, contentHash, now) {
    const prevState = this.currentState;
    
    switch (this.currentState) {
      case ClipboardState.IDLE:
        // 空闲状态：捕获变化，转向已捕获状态
        return this._transitionToCaptured(content, contentHash, now);
        
      case ClipboardState.CAPTURED:
        // 已捕获状态：检查是否在观察期内
        const elapsed = now - this.stateData.capturedAt;
        if (elapsed < this.config.confirmTimeout) {
          // 仍在观察期，继续观察
          return this._transitionToContinue(content, contentHash, now);
        } else {
          // 观察期超时，确认内容
          return this._transitionToConfirmed(content, contentHash, now);
        }
        
      case ClipboardState.BURST:
        // 爆发模式：继续收集
        return this._handleBurstChange(content, contentHash, now);
        
      case ClipboardState.BATCH_PROCESS:
        // 批量处理中：添加到队列
        return { 
          shouldProcess: false, 
          state: ClipboardState.BATCH_PROCESS,
          queueLength: this._addToBatchQueue(content)
        };
        
      default:
        return this._transitionToCaptured(content, contentHash, now);
    }
  }
  
  /**
   * 转换到已捕获状态
   */
  _transitionToCaptured(content, contentHash, now) {
    this.currentState = ClipboardState.CAPTURED;
    this.stateData.capturedAt = now;
    this.stateData.capturedContent = content;
    this.stateData.capturedHash = contentHash;
    this.stateData.continueCount = 0;
    
    return {
      shouldProcess: false,
      state: ClipboardState.CAPTURED,
      content: content,
      message: '内容已捕获，等待确认...'
    };
  }
  
  /**
   * 转换到继续观察状态
   */
  _transitionToContinue(content, contentHash, now) {
    this.currentState = ClipboardState.CONTINUE;
    this.stateData.capturedContent = content;
    this.stateData.capturedHash = contentHash;
    this.stateData.continueCount++;
    
    // 检查是否进入爆发模式
    this.stateData.burstEvents.push(now);
    this._cleanBurstEvents();
    
    if (this.stateData.burstEvents.length >= this.config.burstThreshold) {
      return this._transitionToBurst(content, contentHash, now);
    }
    
    return {
      shouldProcess: false,
      state: ClipboardState.CONTINUE,
      content: content,
      continueCount: this.stateData.continueCount
    };
  }
  
  /**
   * 转换到确认状态
   */
  _transitionToConfirmed(content, contentHash, now) {
    this.currentState = ClipboardState.CONFIRMED;
    
    const result = {
      shouldProcess: true,
      state: ClipboardState.CONFIRMED,
      content: content,
      isNew: true,
      fromBurst: this.stateData.burstEvents.length > 0
    };
    
    // 重置状态
    this._resetToIdle();
    
    return result;
  }
  
  /**
   * 转换到爆发模式
   */
  _transitionToBurst(content, contentHash, now) {
    this.currentState = ClipboardState.BURST;
    this.stateData.pendingContent = content;
    this.stateData.burstEvents.push(now);
    
    // 启动批量处理定时器
    this._startBatchTimer();
    
    return {
      shouldProcess: false,
      state: ClipboardState.BURST,
      message: '检测到连续复制，进入爆发模式...',
      queueLength: this.stateData.burstEvents.length
    };
  }
  
  /**
   * 处理爆发模式中的变化
   */
  _handleBurstChange(content, contentHash, now) {
    this.stateData.pendingContent = content;
    this.stateData.burstEvents.push(now);
    
    // 重置批量处理定时器
    this._resetBatchTimer();
    
    return {
      shouldProcess: false,
      state: ClipboardState.BURST,
      queueLength: this.stateData.burstEvents.length
    };
  }
  
  /**
   * 批量处理完成
   */
  _transitionToBatchProcess() {
    this.currentState = ClipboardState.BATCH_PROCESS;
    
    const batchSize = this.stateData.burstEvents.length;
    const content = this.stateData.pendingContent;
    
    // 触发批量处理
    this._resetToIdle();
    
    return {
      shouldProcess: true,
      state: ClipboardState.BATCH_PROCESS,
      content: content,
      batchSize: batchSize,
      message: `批量处理 ${batchSize} 个复制事件`
    };
  }
  
  /**
   * 获取当前检测间隔
   */
  _getCurrentInterval() {
    if (this.userActivity.isActive) {
      return this.config.activeInterval;
    }
    return this.config.idleInterval;
  }
  
  /**
   * 更新用户活动状态
   */
  _updateUserActivity(now) {
    const idleTime = now - this.userActivity.lastActivity;
    this.userActivity.isActive = idleTime < this.userActivity.idleThreshold;
  }
  
  /**
   * 通知用户活动
   */
  notifyUserActivity() {
    this.userActivity.lastActivity = Date.now();
    this.userActivity.isActive = true;
  }
  
  /**
   * 内容哈希
   */
  _hashContent(content) {
    if (!content) return null;
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }
  
  /**
   * 清理过期爆发事件
   */
  _cleanBurstEvents() {
    const now = Date.now();
    const threshold = now - this.config.burstTimeWindow;
    this.stateData.burstEvents = this.stateData.burstEvents.filter(t => t > threshold);
  }
  
  /**
   * 启动批量处理定时器
   */
  _startBatchTimer() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    this.batchTimer = setTimeout(() => {
      if (this.currentState === ClipboardState.BURST) {
        this._transitionToBatchProcess();
      }
    }, this.config.batchTimeout);
  }
  
  /**
   * 重置批量处理定时器
   */
  _resetBatchTimer() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this._startBatchTimer();
    }
  }
  
  /**
   * 重置到空闲状态
   */
  _resetToIdle() {
    this.currentState = ClipboardState.IDLE;
    this.stateData.capturedAt = null;
    this.stateData.capturedContent = null;
    this.stateData.capturedHash = null;
    this.stateData.continueCount = 0;
    this.stateData.burstEvents = [];
    this.stateData.pendingContent = null;
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }
  
  /**
   * 获取当前状态
   */
  getState() {
    return {
      state: this.currentState,
      interval: this._getCurrentInterval(),
      userActive: this.userActivity.isActive,
      burstCount: this.stateData.burstEvents.length
    };
  }
}
```

### 3.2 频率控制器

```javascript
// clipboard/FreqController.js

/**
 * 自适应频率控制器
 */
class FreqController {
  constructor(options = {}) {
    this.config = {
      // 不同状态的检测间隔 (ms)
      intervals: {
        idle: options.idleInterval || 5000,           // 空闲：5秒
        active: options.activeInterval || 500,         // 活跃：0.5秒
        processing: options.processingInterval || 200,  // 处理中：0.2秒
        burst: options.burstInterval || 100,           // 爆发：0.1秒
      },
      // 状态持续时间阈值 (ms)
      stateThresholds: {
        idleToActive: 30000,    // 30秒无活动 → 空闲
        activeIdle: 5000,       // 5秒无活动 → 不活跃
      },
      // 稳定性检测
      stabilityCheck: options.stabilityCheck !== false,  // 默认开启
      stabilityThreshold: options.stabilityThreshold || 500, // 内容稳定阈值
      ...options
    };
    
    this.state = {
      current: 'idle',
      lastChangeTime: Date.now(),
      lastActivityTime: Date.now(),
      clipboardHistory: [],
      detectionCount: 0,
      processCount: 0,
      skipCount: 0,
    };
    
    // 监听用户活动
    this._setupActivityListeners();
  }
  
  /**
   * 获取当前应该使用的检测间隔
   */
  getCurrentInterval(clipboardState) {
    // 优先级：处理中 > 爆发 > 活跃 > 空闲
    if (this.state.current === 'processing') {
      return this.config.intervals.processing;
    }
    if (clipboardState === 'burst') {
      return this.config.intervals.burst;
    }
    if (this.state.current === 'active') {
      return this.config.intervals.active;
    }
    return this.config.intervals.idle;
  }
  
  /**
   * 更新状态
   */
  updateState(clipboardState, hasChange) {
    const now = Date.now();
    
    // 更新活动状态
    if (hasChange) {
      this.state.lastActivityTime = now;
      this.state.detectionCount++;
    }
    
    // 状态转换判断
    this._updateActivityState(now);
    
    return {
      interval: this.getCurrentInterval(clipboardState),
      state: this.state.current,
      efficiency: this._calculateEfficiency()
    };
  }
  
  /**
   * 更新活动状态
   */
  _updateActivityState(now) {
    const timeSinceActivity = now - this.state.lastActivityTime;
    
    if (this.state.current === 'idle') {
      // 空闲 → 活跃
      if (timeSinceActivity < this.config.stateThresholds.idleToActive) {
        this.state.current = 'active';
        this.state.lastChangeTime = now;
      }
    } else {
      // 活跃 → 空闲
      if (timeSinceActivity > this.config.stateThresholds.activeIdle) {
        this.state.current = 'idle';
        this.state.lastChangeTime = now;
      }
    }
  }
  
  /**
   * 记录处理完成
   */
  recordProcess(success = true) {
    this.state.processCount++;
    if (success) {
      // 处理成功，可以稍微降低频率
    } else {
      // 处理失败，下次加快
      this.state.current = 'active';
      this.state.lastActivityTime = Date.now();
    }
  }
  
  /**
   * 记录跳过
   */
  recordSkip() {
    this.state.skipCount++;
  }
  
  /**
   * 计算检测效率
   */
  _calculateEfficiency() {
    if (this.state.detectionCount === 0) return 1;
    return this.state.processCount / this.state.detectionCount;
  }
  
  /**
   * 设置用户活动监听
   */
  _setupActivityListeners() {
    // 鼠标活动
    document.addEventListener('mousemove', () => this._onActivity());
    document.addEventListener('mousedown', () => this._onActivity());
    document.addEventListener('keydown', () => this._onActivity());
    document.addEventListener('scroll', () => this._onActivity());
    document.addEventListener('touchstart', () => this._onActivity());
  }
  
  /**
   * 活动回调
   */
  _onActivity() {
    this.state.lastActivityTime = Date.now();
  }
  
  /**
   * 获取统计信息
   */
  getStats() {
    return {
      currentState: this.state.current,
      interval: this.getCurrentInterval('idle'),
      detectionCount: this.state.detectionCount,
      processCount: this.state.processCount,
      skipCount: this.state.skipCount,
      efficiency: this._calculateEfficiency(),
      lastActivity: this.state.lastActivityTime,
    };
  }
  
  /**
   * 重置统计
   */
  resetStats() {
    this.state.detectionCount = 0;
    this.state.processCount = 0;
    this.state.skipCount = 0;
  }
}
```

### 3.3 缓冲处理器

```javascript
// clipboard/ClipboardBuffer.js

/**
 * 剪贴板缓冲处理器
 */
class ClipboardBuffer {
  constructor(options = {}) {
    this.config = {
      maxBufferSize: options.maxBufferSize || 10,           // 最大缓冲条数
      bufferTimeout: options.bufferTimeout || 3000,          // 缓冲超时 (ms)
      mergeSimilar: options.mergeSimilar !== false,           // 合并相似内容
      similarityThreshold: options.similarityThreshold || 0.8, // 相似度阈值
      ...options
    };
    
    this.buffer = [];
    this.lastProcessedHash = null;
    this.timer = null;
    this.callbacks = {
      onFlush: null,
      onUpdate: null,
    };
  }
  
  /**
   * 添加到缓冲区
   */
  add(content, metadata = {}) {
    const hash = this._hashContent(content);
    
    // 跳过完全相同的内容
    if (hash === this.lastProcessedHash) {
      return { added: false, reason: 'duplicate' };
    }
    
    // 合并相似内容
    if (this.config.mergeSimilar) {
      const similarIndex = this._findSimilar(content);
      if (similarIndex !== -1) {
        // 更新现有条目
        this.buffer[similarIndex] = {
          content,
          hash,
          timestamp: Date.now(),
          metadata,
          updateCount: (this.buffer[similarIndex].updateCount || 0) + 1
        };
        this._resetTimer();
        this.callbacks.onUpdate?.(this.buffer);
        return { added: true, merged: true, index: similarIndex };
      }
    }
    
    // 添加到缓冲区
    this.buffer.push({
      content,
      hash,
      timestamp: Date.now(),
      metadata,
      updateCount: 0
    });
    
    // 限制缓冲区大小
    while (this.buffer.length > this.config.maxBufferSize) {
      this.buffer.shift();
    }
    
    // 重置定时器
    this._resetTimer();
    
    this.callbacks.onUpdate?.(this.buffer);
    return { added: true, merged: false };
  }
  
  /**
   * 查找相似内容
   */
  _findSimilar(content) {
    for (let i = 0; i < this.buffer.length; i++) {
      const similarity = this._calculateSimilarity(content, this.buffer[i].content);
      if (similarity >= this.config.similarityThreshold) {
        return i;
      }
    }
    return -1;
  }
  
  /**
   * 计算相似度
   */
  _calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;
    
    const len1 = str1.length;
    const len2 = str2.length;
    const maxLen = Math.max(len1, len2);
    
    if (maxLen === 0) return 1;
    
    // 简单的编辑距离相似度
    const distance = this._levenshteinDistance(str1, str2);
    return 1 - (distance / maxLen);
  }
  
  /**
   * Levenshtein 距离
   */
  _levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,
            dp[i][j - 1] + 1,
            dp[i - 1][j - 1] + 1
          );
        }
      }
    }
    
    return dp[m][n];
  }
  
  /**
   * 内容哈希
   */
  _hashContent(content) {
    if (!content) return null;
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }
  
  /**
   * 刷新缓冲区
   */
  flush() {
    if (this.buffer.length === 0) {
      return null;
    }
    
    // 获取最新内容
    const latest = this.buffer[this.buffer.length - 1];
    this.lastProcessedHash = latest.hash;
    
    // 清空缓冲区
    const items = [...this.buffer];
    this.buffer = [];
    this._clearTimer();
    
    this.callbacks.onFlush?.(latest, items);
    
    return {
      content: latest.content,
      metadata: latest.metadata,
      batchSize: items.length,
      items: items
    };
  }
  
  /**
   * 启动定时器
   */
  _resetTimer() {
    this._clearTimer();
    this.timer = setTimeout(() => {
      this.flush();
    }, this.config.bufferTimeout);
  }
  
  /**
   * 清除定时器
   */
  _clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
  
  /**
   * 注册回调
   */
  on(event, callback) {
    if (event === 'flush') {
      this.callbacks.onFlush = callback;
    } else if (event === 'update') {
      this.callbacks.onUpdate = callback;
    }
  }
  
  /**
   * 获取缓冲区状态
   */
  getStatus() {
    return {
      length: this.buffer.length,
      maxSize: this.config.maxBufferSize,
      oldest: this.buffer[0]?.timestamp,
      newest: this.buffer[this.buffer.length - 1]?.timestamp,
      hasTimer: this.timer !== null,
    };
  }
  
  /**
   * 清空缓冲区
   */
  clear() {
    this.buffer = [];
    this._clearTimer();
  }
}
```

### 3.4 剪贴板调度器（整合）

```javascript
// clipboard/ClipboardScheduler.js

/**
 * 剪贴板调度器
 * 整合状态检测、频率控制和缓冲处理
 */
class ClipboardScheduler {
  constructor(options = {}) {
    this.stateDetector = new StateDetector(options.stateDetector);
    this.freqController = new FreqController(options.freqController);
    this.buffer = new ClipboardBuffer(options.buffer);
    
    this.lastClipboard = '';
    this.timer = null;
    this.isRunning = false;
    this.callbacks = {
      onProcess: null,
      onStateChange: null,
      onError: null,
    };
    
    // 绑定缓冲回调
    this.buffer.on('flush', (latest, items) => {
      this._handleBufferFlush(latest, items);
    });
    
    // 监听用户活动
    this._setupActivityListeners();
  }
  
  /**
   * 启动监控
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    console.log('[ClipboardScheduler] 启动剪贴板监控');
    this._scheduleNext();
  }
  
  /**
   * 停止监控
   */
  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('[ClipboardScheduler] 停止剪贴板监控');
  }
  
  /**
   * 注册处理回调
   */
  onProcess(callback) {
    this.callbacks.onProcess = callback;
  }
  
  /**
   * 调度下次检测
   */
  _scheduleNext() {
    if (!this.isRunning) return;
    
    const { interval } = this.freqController.getStats();
    
    this.timer = setTimeout(async () => {
      await this._checkClipboard();
      this._scheduleNext();
    }, interval);
  }
  
  /**
   * 检测剪贴板
   */
  async _checkClipboard() {
    try {
      // 获取剪贴板内容
      const content = await this._getClipboardText();
      
      if (!content || content === this.lastClipboard) {
        this.freqController.recordSkip();
        return;
      }
      
      this.lastClipboard = content;
      
      // 状态检测
      const checkResult = this.stateDetector.checkClipboardChange(content);
      
      // 更新频率控制器
      const freqResult = this.freqController.updateState(
        checkResult.state,
        true
      );
      
      // 通知状态变化
      if (checkResult.state !== this.stateDetector.currentState) {
        this.callbacks.onStateChange?.(checkResult.state, checkResult);
      }
      
      // 根据状态决定是否处理
      if (checkResult.shouldProcess) {
        // 触发处理
        this._triggerProcess(checkResult.content, checkResult);
      } else if (checkResult.state === ClipboardState.BURST) {
        // 爆发模式：添加到缓冲
        this.buffer.add(content, { state: checkResult.state });
      }
      
    } catch (error) {
      console.error('[ClipboardScheduler] 检测失败:', error);
      this.callbacks.onError?.(error);
    }
  }
  
  /**
   * 触发内容处理
   */
  _triggerProcess(content, metadata) {
    this.freqController.recordProcess(true);
    this.callbacks.onProcess?.(content, metadata);
  }
  
  /**
   * 处理缓冲刷新
   */
  _handleBufferFlush(latest, items) {
    if (items.length > 1) {
      console.log(`[ClipboardScheduler] 批量处理 ${items.length} 个复制事件`);
    }
    this._triggerProcess(latest.content, {
      ...latest.metadata,
      batchSize: items.length,
      isBatch: true
    });
  }
  
  /**
   * 获取剪贴板内容
   */
  async _getClipboardText() {
    try {
      return await window.electronAPI?.getClipboardText();
    } catch (error) {
      console.error('[ClipboardScheduler] 获取剪贴板失败:', error);
      return '';
    }
  }
  
  /**
   * 设置用户活动监听
   */
  _setupActivityListeners() {
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach(event => {
      document.addEventListener(event, () => {
        this.stateDetector.notifyUserActivity();
      }, { passive: true });
    });
  }
  
  /**
   * 获取监控状态
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      state: this.stateDetector.getState(),
      freq: this.freqController.getStats(),
      buffer: this.buffer.getStatus(),
    };
  }
}
```

### 3.5 统一导出

```javascript
// clipboard/index.js

module.exports = {
  ClipboardState,
  StateDetector: require('./StateDetector'),
  FreqController: require('./FreqController'),
  ClipboardBuffer: require('./ClipboardBuffer'),
  ClipboardScheduler: require('./ClipboardScheduler'),
};
```

---

## 四、配置项

### 4.1 默认配置

```javascript
// 默认配置参数
const defaultConfig = {
  // 状态检测器
  stateDetector: {
    idleInterval: 5000,           // 空闲检测间隔
    activeInterval: 500,         // 活跃检测间隔
    confirmTimeout: 1500,        // 确认超时
    burstThreshold: 3,           // 爆发阈值
    burstTimeWindow: 2000,       // 爆发时间窗口
    batchTimeout: 2000,          // 批量处理超时
  },
  
  // 频率控制器
  freqController: {
    idleInterval: 5000,          // 空闲间隔
    activeInterval: 500,         // 活跃间隔
    processingInterval: 200,     // 处理中间隔
    burstInterval: 100,         // 爆发间隔
    idleToActive: 30000,        // 空闲阈值
  },
  
  // 缓冲处理器
  buffer: {
    maxBufferSize: 10,
    bufferTimeout: 3000,
    mergeSimilar: true,
    similarityThreshold: 0.8,
  },
};
```

### 4.2 用户可配置项

| 配置项 | 默认值 | 说明 | 范围 |
|--------|--------|------|------|
| `watchEnabled` | `true` | 是否启用监控 | - |
| `idleInterval` | `5000` | 空闲检测间隔 (ms) | 2000-10000 |
| `activeInterval` | `500` | 活跃检测间隔 (ms) | 100-2000 |
| `confirmTimeout` | `1500` | 内容确认超时 (ms) | 500-3000 |
| `burstEnabled` | `true` | 是否启用爆发模式 | - |
| `burstThreshold` | `3` | 触发爆发的连续复制次数 | 2-5 |
| `mergeSimilar` | `true` | 是否合并相似内容 | - |

---

## 五、流程图

### 5.1 单次复制流程

```
用户复制 "评估 ADP 4.0 工作量"
    ↓
[IDLE] 检测到变化
    ↓
[CAPTURED] 启动 1.5s 计时器
    ↓
┌─────────────────────────────────────┐
│ 1.5s 内有新变化？                    │
├──────────────┬──────────────────────┤
│ 否           │ 是                    │
▼              ▼                       │
[CONFIRMED]   [CONTINUE] 重置计时器    │
    │          │                       │
    │          ↓                       │
    │    [继续变化?]                   │
    │    ├─ < 3次 → CONTINUE          │
    │    └─ ≥ 3次 → [BURST]           │
    │                 │                │
    │                 ↓                │
    │         启动 2s 批量计时器       │
    │                 │                │
    │                 ↓                │
    │         [2s 无新变化？]          │
    │           ├─ 否 → 继续收集       │
    │           └─ 是 → [BATCH]       │
    │                         │        │
    └─────────────────────────┼────────┘
                              ↓
                    执行任务分析
```

### 5.2 自适应频率流程

```
用户操作 → 更新 lastActivityTime
    ↓
┌─────────────────────────────────────┐
│ 当前状态检测                        │
├──────────────┬──────────────────────┤
│ idleInterval │ activeInterval       │
│ (5s)         │ (0.5s)               │
├──────────────┴──────────────────────┤
│ 30s 无活动 → idle                  │
│ 30s 内有活动 → active              │
├─────────────────────────────────────┤
│ [active] 用户正在操作               │
│ - 快速响应剪贴板变化                │
│ - 提高检测频率                      │
├─────────────────────────────────────┤
│ [idle] 用户离开                    │
│ - 降低检测频率                      │
│ - 节省资源                          │
└─────────────────────────────────────┘
```

---

## 六、监控面板

### 6.1 状态展示

```javascript
// 在设置页面添加监控状态展示

function renderClipboardMonitorStatus() {
  const status = clipboardScheduler.getStatus();
  
  return `
    <div class="monitor-status">
      <div class="status-header">
        <span class="status-label">剪贴板监控状态</span>
        <span class="status-badge ${status.isRunning ? 'running' : 'stopped'}">
          ${status.isRunning ? '运行中' : '已停止'}
        </span>
      </div>
      
      <div class="status-grid">
        <div class="status-item">
          <span class="item-label">当前状态</span>
          <span class="item-value">${getStateLabel(status.state.state)}</span>
        </div>
        
        <div class="status-item">
          <span class="item-label">检测间隔</span>
          <span class="item-value">${status.state.interval}ms</span>
        </div>
        
        <div class="status-item">
          <span class="item-label">用户状态</span>
          <span class="item-value">${status.state.userActive ? '活跃' : '空闲'}</span>
        </div>
        
        <div class="status-item">
          <span class="item-label">爆发计数</span>
          <span class="item-value">${status.state.burstCount}</span>
        </div>
        
        <div class="status-item">
          <span class="item-label">检测效率</span>
          <span class="item-value">${(status.freq.efficiency * 100).toFixed(1)}%</span>
        </div>
        
        <div class="status-item">
          <span class="item-label">缓冲队列</span>
          <span class="item-value">${status.buffer.length}/${status.buffer.maxSize}</span>
        </div>
      </div>
      
      <div class="status-chart">
        <canvas id="clipboard-activity-chart"></canvas>
      </div>
    </div>
  `;
}

function getStateLabel(state) {
  const labels = {
    idle: '空闲',
    captured: '已捕获',
    confirmed: '已确认',
    continue: '观察中',
    burst: '爆发模式',
    batch: '批量处理',
  };
  return labels[state] || state;
}
```

---

## 七、文件清单

| 文件 | 说明 |
|------|------|
| `clipboard/StateDetector.js` | 状态检测器 |
| `clipboard/FreqController.js` | 频率控制器 |
| `clipboard/ClipboardBuffer.js` | 剪贴板缓冲处理器 |
| `clipboard/ClipboardScheduler.js` | 剪贴板调度器（整合） |
| `clipboard/index.js` | 统一导出 |
| `clipboard/StateDetector.test.js` | 单元测试 |

---

## 八、开发计划

### Phase 1：核心模块（2天）
- [ ] 实现 `StateDetector` 状态检测器
- [ ] 实现 `FreqController` 频率控制器
- [ ] 实现 `ClipboardBuffer` 缓冲处理器

### Phase 2：整合与配置（1天）
- [ ] 实现 `ClipboardScheduler` 调度器
- [ ] 添加用户配置界面
- [ ] 添加监控状态面板

### Phase 3：测试与优化（2天）
- [ ] 单元测试覆盖
- [ ] 性能测试
- [ ] 用户体验优化

---

**文档版本**: v1.0  
**创建日期**: 2026-06-28