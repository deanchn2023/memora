/**
 * TaskManager - 多任务并发管理器
 * 
 * 核心职责：
 * 1. 创建/追踪/停止 AI 任务
 * 2. 并发限制（全局 + 按模式）
 * 3. 流式事件分发（带 taskId）
 * 4. UI 更新批量合并（requestAnimationFrame）
 * 
 * 设计原则：
 * - 与会话解耦：一个会话可包含多个并行任务
 * - 向后兼容：单任务模式是并行模式的特例（并发数=1）
 * - 资源隔离：每个任务独立的 AbortController
 */

// 任务状态枚举
const TaskStatus = {
  IDLE: 'idle',
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  ERROR: 'error',
  CANCELLED: 'cancelled',
};

// 资源限制配置
const ResourceLimits = {
  maxGlobalTasks: 5,
  maxSessionTasks: 3,
  maxADPTasks: 2,
  maxLLMTasks: 3,
  maxCCTasks: 2,
  queueTimeout: 300,        // 秒
  maxTaskDuration: 300,     // 秒
  maxStreamContentLen: 50000, // 流式内容最大字符数
};

// 模式 → 限制键映射
const MODE_LIMIT_KEY = {
  agent: 'maxADPTasks',
  adp: 'maxADPTasks',
  llm: 'maxLLMTasks',
  cc: 'maxCCTasks',
};

class TaskLimiter {
  constructor(limits) {
    this.limits = limits || ResourceLimits;
    this.globalCount = 0;
    this.sessionCounts = new Map(); // sessionId → count
    this.modeCounts = { agent: 0, adp: 0, llm: 0, cc: 0 };
  }

  /**
   * 原子性检查 + 占用
   * @returns {{ allowed: boolean, reason?: string }}
   */
  acquire(mode, sessionId) {
    const limitKey = MODE_LIMIT_KEY[mode] || 'maxLLMTasks';
    const modeCount = this.modeCounts[mode] || 0;
    const sessionCount = this.sessionCounts.get(sessionId) || 0;

    if (this.globalCount >= this.limits.maxGlobalTasks) {
      return { allowed: false, reason: `全局任务数已达上限 (${this.limits.maxGlobalTasks})` };
    }
    if (modeCount >= this.limits[limitKey]) {
      return { allowed: false, reason: `${mode} 任务数已达上限 (${this.limits[limitKey]})` };
    }
    if (sessionCount >= this.limits.maxSessionTasks) {
      return { allowed: false, reason: `当前会话任务数已达上限 (${this.limits.maxSessionTasks})` };
    }

    this.globalCount++;
    this.modeCounts[mode] = modeCount + 1;
    this.sessionCounts.set(sessionId, sessionCount + 1);
    return { allowed: true };
  }

  release(mode, sessionId) {
    this.globalCount = Math.max(0, this.globalCount - 1);
    this.modeCounts[mode] = Math.max(0, (this.modeCounts[mode] || 0) - 1);
    const sc = this.sessionCounts.get(sessionId);
    if (sc !== undefined) {
      if (sc <= 1) this.sessionCounts.delete(sessionId);
      else this.sessionCounts.set(sessionId, sc - 1);
    }
  }

  getActiveCount() {
    return this.globalCount;
  }

  getSessionCount(sessionId) {
    return this.sessionCounts.get(sessionId) || 0;
  }
}

class TaskManager {
  constructor() {
    this.tasks = new Map();          // taskId → task object
    this.limiter = new TaskLimiter();
    this._listeners = new Map();     // taskId → Map<event, Set<callback>>
    this._rafPending = new Map();    // taskId → boolean (是否有待处理的 RAF)
    this._rafQueues = new Map();     // taskId → 累积的更新数据
  }

  /**
   * 生成唯一 taskId
   */
  generateId() {
    return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * 创建任务（不启动）
   */
  create(sessionId, mode, input = {}) {
    const taskId = this.generateId();
    const task = {
      id: taskId,
      sessionId,
      mode,
      status: TaskStatus.IDLE,
      input: {
        message: input.message || '',
        attachments: input.attachments || [],
        context: input.context || {},
        systemRole: input.systemRole || '',
      },
      output: {
        content: '',
        thinking: '',
        steps: [],
        references: [],
      },
      meta: {
        createdAt: Date.now(),
        startedAt: null,
        completedAt: null,
        tokenUsage: { prompt: 0, completion: 0 },
        cost: 0,
        traceId: null,
      },
      // 渲染进程侧的 DOM 引用
      ui: {
        messageEl: null,
        contentEl: null,
        timerEl: null,
        stepsEl: null,
      },
      // 定时器
      _timerInterval: null,
      _timerStart: 0,
    };
    this.tasks.set(taskId, task);
    return task;
  }

  /**
   * 启动任务（检查限制）
   */
  start(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return { success: false, error: '任务不存在' };

    const check = this.limiter.acquire(task.mode, task.sessionId);
    if (!check.allowed) {
      task.status = TaskStatus.ERROR;
      this._emit(taskId, 'error', { error: check.reason });
      return { success: false, error: check.reason };
    }

    task.status = TaskStatus.RUNNING;
    task.meta.startedAt = Date.now();
    this._emit(taskId, 'started', task);
    return { success: true };
  }

  /**
   * 获取任务
   */
  get(taskId) {
    return this.tasks.get(taskId);
  }

  /**
   * 获取会话的所有活跃任务
   */
  getBySession(sessionId) {
    const result = [];
    for (const task of this.tasks.values()) {
      if (task.sessionId === sessionId && 
          (task.status === TaskStatus.RUNNING || task.status === TaskStatus.QUEUED)) {
        result.push(task);
      }
    }
    return result;
  }

  /**
   * 获取所有活跃任务
   */
  getActive() {
    const result = [];
    for (const task of this.tasks.values()) {
      if (task.status === TaskStatus.RUNNING || task.status === TaskStatus.QUEUED) {
        result.push(task);
      }
    }
    return result;
  }

  /**
   * 停止任务
   */
  stop(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = TaskStatus.CANCELLED;
    task.meta.completedAt = Date.now();
    this._cleanupTimer(taskId);
    this.limiter.release(task.mode, task.sessionId);
    this._emit(taskId, 'stopped', task);
  }

  /**
   * 完成任务
   */
  complete(taskId, result = {}) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = TaskStatus.COMPLETED;
    task.meta.completedAt = Date.now();
    this._cleanupTimer(taskId);
    this.limiter.release(task.mode, task.sessionId);
    this._emit(taskId, 'completed', { task, result });
  }

  /**
   * 任务出错
   */
  error(taskId, errorMessage) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = TaskStatus.ERROR;
    task.meta.completedAt = Date.now();
    task.meta.error = errorMessage;
    this._cleanupTimer(taskId);
    this.limiter.release(task.mode, task.sessionId);
    this._emit(taskId, 'error', { error: errorMessage, task });
  }

  /**
   * 流式增量更新 — 使用 requestAnimationFrame 批量合并
   * 高频调用时自动合并多次 delta 为一次 UI 更新
   */
  appendDelta(taskId, delta) {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== TaskStatus.RUNNING) return;

    // 防止内存膨胀：截断超长内容
    if (task.output.content.length + delta.length > ResourceLimits.maxStreamContentLen) {
      const remaining = ResourceLimits.maxStreamContentLen - task.output.content.length;
      if (remaining > 0) {
        task.output.content += delta.slice(0, remaining);
      }
      // 标记截断
      if (!task.meta.truncated) {
        task.meta.truncated = true;
        task.output.content += '\n\n[内容已截断：超过最大长度限制]';
      }
    } else {
      task.output.content += delta;
    }

    // 使用 RAF 批量更新 UI
    this._scheduleRafUpdate(taskId, 'delta');
  }

  appendThinking(taskId, delta) {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== TaskStatus.RUNNING) return;
    
    if (task.output.thinking.length + delta.length > ResourceLimits.maxStreamContentLen) {
      return; // 思考内容直接截断，不加提示
    }
    task.output.thinking += delta;
    this._scheduleRafUpdate(taskId, 'thinking');
  }

  addStep(taskId, step) {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== TaskStatus.RUNNING) return;
    task.output.steps.push(step);
    this._emit(taskId, 'step', step);
  }

  updateTokenUsage(taskId, usage) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (usage.prompt) task.meta.tokenUsage.prompt += usage.prompt;
    if (usage.completion) task.meta.tokenUsage.completion += usage.completion;
  }

  /**
   * 启动任务计时器
   */
  startTimer(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    
    task._timerStart = Date.now();
    this._cleanupTimer(taskId);
    
    task._timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - task._timerStart) / 1000);
      if (task.ui.timerEl) {
        task.ui.timerEl.textContent = elapsed + 's';
      }
    }, 1000);
  }

  _cleanupTimer(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task._timerInterval) {
      clearInterval(task._timerInterval);
      task._timerInterval = null;
    }
  }

  /**
   * requestAnimationFrame 批量更新
   * 将同一任务的高频 delta 合并为一次 UI 回调
   */
  _scheduleRafUpdate(taskId, type) {
    if (this._rafPending.get(taskId)) return;
    
    this._rafPending.set(taskId, true);
    if (!this._rafQueues.has(taskId)) {
      this._rafQueues.set(taskId, new Set());
    }
    this._rafQueues.get(taskId).add(type);

    requestAnimationFrame(() => {
      this._rafPending.set(taskId, false);
      const types = this._rafQueues.get(taskId);
      this._rafQueues.set(taskId, new Set());
      
      const task = this.tasks.get(taskId);
      if (!task) return;
      
      this._emit(taskId, 'update', { task, types: Array.from(types) });
    });
  }

  /**
   * 事件监听
   */
  on(taskId, event, callback) {
    if (!this._listeners.has(taskId)) {
      this._listeners.set(taskId, new Map());
    }
    const taskListeners = this._listeners.get(taskId);
    if (!taskListeners.has(event)) {
      taskListeners.set(event, new Set());
    }
    taskListeners.get(event).add(callback);
  }

  /**
   * 移除事件监听
   */
  off(taskId, event, callback) {
    const taskListeners = this._listeners.get(taskId);
    if (!taskListeners) return;
    if (event) {
      if (callback) {
        taskListeners.get(event)?.delete(callback);
      } else {
        taskListeners.delete(event);
      }
    } else {
      this._listeners.delete(taskId);
    }
  }

  _emit(taskId, event, data) {
    const taskListeners = this._listeners.get(taskId);
    if (!taskListeners) return;
    const callbacks = taskListeners.get(event);
    if (callbacks) {
      for (const cb of callbacks) {
        try { cb(data); } catch (e) { console.error('[TaskManager] Listener error:', e); }
      }
    }
  }

  /**
   * 销毁任务（清理所有资源）
   */
  destroy(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return;

    // 如果还在运行，先停止
    if (task.status === TaskStatus.RUNNING || task.status === TaskStatus.QUEUED) {
      this.stop(taskId);
    }

    this._cleanupTimer(taskId);
    this._listeners.delete(taskId);
    this._rafPending.delete(taskId);
    this._rafQueues.delete(taskId);
    this.tasks.delete(taskId);
  }

  /**
   * 停止会话所有活跃任务
   */
  stopSessionTasks(sessionId) {
    for (const task of this.tasks.values()) {
      if (task.sessionId === sessionId && 
          (task.status === TaskStatus.RUNNING || task.status === TaskStatus.QUEUED)) {
        this.stop(task.id);
      }
    }
  }

  /**
   * 获取活跃任务统计
   */
  getStats() {
    let running = 0, queued = 0, completed = 0, error = 0;
    for (const task of this.tasks.values()) {
      switch (task.status) {
        case TaskStatus.RUNNING: running++; break;
        case TaskStatus.QUEUED: queued++; break;
        case TaskStatus.COMPLETED: completed++; break;
        case TaskStatus.ERROR: error++; break;
      }
    }
    return { running, queued, completed, error, total: this.tasks.size };
  }

  /**
   * 清理已完成/出错的任务（保留最近 N 条）
   */
  cleanup(maxKeep = 20) {
    const finished = [];
    for (const [id, task] of this.tasks) {
      if (task.status === TaskStatus.COMPLETED || 
          task.status === TaskStatus.ERROR || 
          task.status === TaskStatus.CANCELLED) {
        finished.push({ id, completedAt: task.meta.completedAt || 0 });
      }
    }
    if (finished.length <= maxKeep) return;
    
    // 按完成时间排序，删除最早的
    finished.sort((a, b) => a.completedAt - b.completedAt);
    const toRemove = finished.slice(0, finished.length - maxKeep);
    for (const { id } of toRemove) {
      this.destroy(id);
    }
  }
}

// 导出单例
window.TaskManager = new TaskManager();
window.TaskStatus = TaskStatus;
window.ResourceLimits = ResourceLimits;
