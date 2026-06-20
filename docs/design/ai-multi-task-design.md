# Memora AI 助手多任务并发设计方案

## 一、现状分析

### 1.1 当前限制

| 限制项 | 当前实现 | 影响 |
|--------|----------|------|
| 全局流式标志 | `_adpStreaming` / `_ccStreaming` 是全局布尔值 | 同一时间只允许一个流式会话 |
| UI 锁定 | 发送消息时输入框禁用，停止按钮替换发送按钮 | 无法在等待期间发起新请求 |
| 群聊互斥 | 群聊进行中禁止发送新消息 | 专家团无法并行处理 |
| 新建对话中断 | 创建新对话会强制停止当前流式 | 丢失正在进行的对话 |
| ADP Controller 单例 | `activeChatADPController` 全局单例 | 无法支持多 ADP 会话并发 |

### 1.2 当前架构

```
渲染进程 (app.js)
  ├─ _adpStreaming: false      ← 全局标志
  ├─ _ccStreaming: false       ← 全局标志
  ├─ _activeSessionId: null    ← 单一会话
  └─ sendAIMessage()
       ↓ IPC (单次调用)
主进程 (main.js)
  ├─ activeChatADPController   ← ADP 单例
  ├─ ccSessionMap: {}          ← CC 已支持多会话
  └─ AgentProvider
       ├─ AdpProvider
       ├─ LlmProvider
       └─ ClaudeCodeProvider
```

---

## 二、设计方案

### 2.1 核心设计原则

1. **任务与会话解耦**: 一个会话可包含多个并行任务
2. **独立状态管理**: 每个任务有独立的流式状态
3. **UI 并行展示**: 支持同时显示多个流式消息
4. **资源隔离**: 每个任务独立的 ADP Controller / LLM Session

### 2.2 任务模型设计

```javascript
// 任务状态
const TaskStatus = {
  IDLE: 'idle',           // 空闲
  QUEUED: 'queued',       // 排队中
  RUNNING: 'running',     // 运行中（流式输出）
  PAUSED: 'paused',       // 暂停
  COMPLETED: 'completed', // 完成
  ERROR: 'error',         // 错误
  CANCELLED: 'cancelled'  // 已取消
};

// 任务数据结构
const task = {
  id: 'task_xxx',                    // 任务唯一 ID
  sessionId: 'session_xxx',          // 所属会话 ID
  mode: 'cc',                        // ai模式: 'agent' | 'llm' | 'cc'
  status: TaskStatus.RUNNING,
  
  // 输入
  input: {
    message: '用户消息',
    attachments: [],
    context: {},
    agentId: null,        // 专家 ID（群聊时）
  },
  
  // 输出
  output: {
    content: '',          // 累积的 AI 回复
    thinking: '',         // 思考过程
    steps: [],            // 工具调用步骤
    references: [],       // 引用资料
  },
  
  // 元数据
  meta: {
    createdAt: Date.now(),
    startedAt: Date.now(),
    completedAt: null,
    tokenUsage: { prompt: 0, completion: 0 },
    cost: 0,
    traceId: 'trace_xxx', // 用于反馈闭环
  },
  
  // 控制器引用（主进程）
  controller: {
    adp: null,            // ADP Controller 实例
    cc: null,             // CC Session 实例
  }
};
```

### 2.3 状态管理重构

#### 2.3.1 渲染进程 (app.js)

```javascript
class MemoraApp {
  // 旧: _adpStreaming: false
  // 新: 任务管理器
  _taskManager = new TaskManager();
  
  // 活跃任务 Map<taskId, Task>
  _activeTasks = new Map();
  
  // 任务 UI 绑定 Map<taskId, HTMLElement>
  _taskUIBindings = new Map();
  
  // 会话任务队列 Map<sessionId, Task[]>
  _sessionTaskQueues = new Map();
}

class TaskManager {
  constructor() {
    this.tasks = new Map();
    this.listeners = new Map();
  }
  
  createTask(sessionId, mode, input) {
    const task = new Task({ sessionId, mode, input });
    this.tasks.set(task.id, task);
    return task;
  }
  
  startTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = TaskStatus.RUNNING;
      this._emit(taskId, 'started', task);
    }
  }
  
  updateTask(taskId, updates) {
    const task = this.tasks.get(taskId);
    if (task) {
      Object.assign(task, updates);
      this._emit(taskId, 'updated', task);
    }
  }
  
  stopTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = TaskStatus.CANCELLED;
      this._emit(taskId, 'stopped', task);
    }
  }
  
  on(taskId, event, callback) {
    if (!this.listeners.has(taskId)) {
      this.listeners.set(taskId, new Map());
    }
    this.listeners.get(taskId).set(event, callback);
  }
}
```

#### 2.3.2 主进程 (main.js)

```javascript
// 旧: activeChatADPController (单例)
// 新: ADP Controller 池
class ADPControllerPool {
  constructor(maxSize = 10) {
    this.controllers = new Map(); // taskId → controller
    this.maxSize = maxSize;
  }
  
  acquire(taskId, config) {
    if (this.controllers.size >= this.maxSize) {
      // 淘汰最久未使用的
      this._evictOldest();
    }
    const controller = new ADPController(config);
    this.controllers.set(taskId, {
      controller,
      lastUsed: Date.now(),
      createdAt: Date.now()
    });
    return controller;
  }
  
  release(taskId) {
    const entry = this.controllers.get(taskId);
    if (entry) {
      entry.controller.abort();
      this.controllers.delete(taskId);
    }
  }
  
  get(taskId) {
    const entry = this.controllers.get(taskId);
    if (entry) {
      entry.lastUsed = Date.now();
      return entry.controller;
    }
    return null;
  }
}

// 全局实例
const adpPool = new ADPControllerPool(10);
const ccPool = new CCPool(10);
const llmPool = new LLMPool(10);
```

### 2.4 IPC 通道设计

#### 2.4.1 任务生命周期

```javascript
// 创建并启动任务
ipcMain.handle('task:start', async (event, { taskId, mode, input }) => {
  const controller = getPool(mode).acquire(taskId, getConfig(mode));
  const result = await controller.start(input);
  return { success: true, taskId };
});

// 停止任务
ipcMain.handle('task:stop', async (event, { taskId }) => {
  const pool = getPool(getTaskMode(taskId));
  pool.release(taskId);
  return { success: true };
});

// 获取任务状态
ipcMain.handle('task:status', async (event, { taskId }) => {
  return getTaskStatus(taskId);
});

// 列出活跃任务
ipcMain.handle('task:list', async (event, { sessionId }) => {
  return listActiveTasks(sessionId);
});
```

#### 2.4.2 流式事件推送

```javascript
// 旧: mainWindow.webContents.send('adp:sse-event', { event, data })
// 新: 带 taskId 的事件
mainWindow.webContents.send('task:stream', {
  taskId,
  type: 'delta',          // delta | thinking | step | done | error
  content: '...',
  meta: {}
});

// 渲染进程监听
window.electronAPI.onTaskStream((evt) => {
  const { taskId, type, content } = evt;
  const task = this._taskManager.getTask(taskId);
  
  switch(type) {
    case 'delta':
      task.output.content += content;
      this._updateTaskUI(task);
      break;
    case 'thinking':
      task.output.thinking += content;
      break;
    case 'step':
      task.output.steps.push(content);
      break;
    case 'done':
      task.status = TaskStatus.COMPLETED;
      this._completeTaskUI(task);
      break;
    case 'error':
      task.status = TaskStatus.ERROR;
      this._showTaskError(task, content);
      break;
  }
});
```

### 2.5 UI 设计方案

#### 2.5.1 并行消息卡片

```html
<!-- 消息容器：支持多个并行消息 -->
<div class="chat-messages" id="chatMessages">
  <!-- 用户消息 -->
  <div class="message user">
    <div class="message-content">用户问题</div>
  </div>
  
  <!-- AI 响应容器：可包含多个并行任务 -->
  <div class="ai-response-group">
    <!-- 任务 1: 正在流式输出 -->
    <div class="task-card running" data-task-id="task_1">
      <div class="task-header">
        <span class="task-mode-badge cc">M-Agent</span>
        <span class="task-status live"></span>
        <button class="task-stop-btn" data-action="stop">停止</button>
      </div>
      <div class="task-content">
        <div class="task-output">流式输出内容...</div>
        <div class="task-thinking">思考过程...</div>
      </div>
      <div class="task-meta">
        <span>Token: 1,234</span>
        <span>耗时: 5s</span>
      </div>
    </div>
    
    <!-- 任务 2: 排队中 -->
    <div class="task-card queued" data-task-id="task_2">
      <div class="task-header">
        <span class="task-mode-badge llm">LLM</span>
        <span class="task-status queued"></span>
        <span class="task-queue-position">排队中 #2</span>
      </div>
      <div class="task-content">
        <div class="task-queued-hint">等待前一个任务完成...</div>
      </div>
    </div>
    
    <!-- 任务 3: 已完成 -->
    <div class="task-card completed" data-task-id="task_3">
      <div class="task-header">
        <span class="task-mode-badge agent">Agent</span>
        <span class="task-status done"></span>
        <button class="task-retry-btn" data-action="retry">重试</button>
      </div>
      <div class="task-content">
        <div class="task-output">已完成的回复内容</div>
      </div>
    </div>
  </div>
</div>
```

#### 2.5.2 输入区域改造

```html
<!-- 输入区域：支持多任务模式 -->
<div class="chat-input-area">
  <div class="input-toolbar">
    <!-- 模式选择 -->
    <div class="mode-selector">
      <button class="mode-btn active" data-mode="auto">⚡ 自动</button>
      <button class="mode-btn" data-mode="parallel">🔀 并行</button>
      <button class="mode-btn" data-mode="queue">📋 排队</button>
    </div>
    
    <!-- 活跃任务指示 -->
    <div class="active-tasks-indicator">
      <span class="live-count">2 个任务运行中</span>
    </div>
  </div>
  
  <div class="input-container">
    <textarea id="chatInput" placeholder="输入消息..."></textarea>
    <button class="send-btn" id="sendBtn">发送</button>
  </div>
  
  <!-- 并行模式：选择要同时调用的 AI -->
  <div class="parallel-mode-panel" id="parallelPanel">
    <label><input type="checkbox" checked> 🧠 M-Agent</label>
    <label><input type="checkbox" checked> 🤖 Agent</label>
    <label><input type="checkbox"> 💬 LLM</label>
  </div>
</div>
```

### 2.6 模式配置

| 模式 | 说明 | 行为 |
|------|------|------|
| **自动 (Auto)** | 智能选择最优 AI | 单任务，根据上下文自动选择 |
| **并行 (Parallel)** | 同时调用多个 AI | 多任务并行，每个 AI 独立回答 |
| **排队 (Queue)** | 依次执行多个 AI | 任务队列，按顺序执行 |

---

## 三、并发控制策略

### 3.1 资源限制

```javascript
const ResourceLimits = {
  // 全局最大并发任务数
  maxGlobalTasks: 5,
  
  // 单会话最大并发任务数
  maxSessionTasks: 3,
  
  // 各模式并发限制
  maxADPTasks: 2,    // ADP 有 QPS 限制
  maxLLMTasks: 3,    // LLM 相对宽松
  maxCCTasks: 3,     // CC 受 API 限制
  
  // 队列超时（秒）
  queueTimeout: 300,
  
  // 单任务最大执行时间（秒）
  maxTaskDuration: 300,
};
```

### 3.2 限流实现

```javascript
class TaskLimiter {
  constructor(limits) {
    this.limits = limits;
    this.globalCount = 0;
    this.sessionCounts = new Map();
    this.modeCounts = { agent: 0, llm: 0, cc: 0 };
  }
  
  canStart(mode, sessionId) {
    if (this.globalCount >= this.limits.maxGlobalTasks) {
      return { allowed: false, reason: '全局任务数已达上限' };
    }
    if (this.modeCounts[mode] >= this.limits[`max${mode.toUpperCase()}Tasks`]) {
      return { allowed: false, reason: `${mode} 任务数已达上限` };
    }
    // ... 其他检查
    return { allowed: true };
  }
  
  acquire(mode, sessionId) {
    this.globalCount++;
    this.modeCounts[mode]++;
    this.sessionCounts.set(sessionId, (this.sessionCounts.get(sessionId) || 0) + 1);
  }
  
  release(mode, sessionId) {
    this.globalCount--;
    this.modeCounts[mode]--;
    this.sessionCounts.set(sessionId, this.sessionCounts.get(sessionId) - 1);
  }
}
```

---

## 四、实现路线图

### Phase 1: 基础架构 (1 周)

- [ ] 任务数据模型定义
- [ ] TaskManager 类实现
- [ ] 主进程 Controller Pool 实现
- [ ] 新 IPC 通道定义
- [ ] 流式事件重构（带 taskId）

### Phase 2: 核心功能 (1 周)

- [ ] 渲染进程多任务状态管理
- [ ] 并行消息 UI 组件
- [ ] 任务卡片组件
- [ ] 输入区域模式选择
- [ ] 任务队列 UI

### Phase 3: 体验优化 (1 周)

- [ ] 任务进度指示
- [ ] 任务取消/重试
- [ ] 任务历史记录
- [ ] 性能优化（大量任务时）
- [ ] 移动端适配

### Phase 4: 高级功能 (可选)

- [ ] 任务间上下文共享
- [ ] 任务编排（DAG）
- [ ] 任务优先级队列
- [ ] 任务依赖管理

---

## 五、风险与注意事项

### 5.1 API 限制

| 模式 | 限制 | 应对 |
|------|------|------|
| ADP | QPS 限制（约 10/s） | 队列控制 + 重试机制 |
| LLM | Token 限制 + 超时 | 分块处理 + 超时中断 |
| CC | 会话数限制 | Pool 复用 + LRU 淘汰 |

### 5.2 内存管理

- 大量流式输出可能导致内存膨胀
- 建议：流式内容限制最大长度（如 50KB）
- 完成后压缩存储，仅保留摘要

### 5.3 UI 性能

- 多个并行流式更新可能导致 UI 卡顿
- 建议：使用 requestAnimationFrame 批量更新
- 虚拟滚动（任务数 > 10 时）

---

## 六、示例：并行调用三个 AI

```
用户: "帮我分析这段代码的性能问题"

┌─────────────────────────────────────────────────────────────┐
│  任务组 1: 代码性能分析                                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─ 🧠 M-Agent (CC) ──────────────────────────────────┐    │
│  │ 🔄 分析中...                                          │    │
│  │ "从算法复杂度角度，这段代码存在 O(n²) 复杂度..."     │    │
│  │ Token: 1,234 | 耗时: 3s                            │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─ 🤖 Agent (ADP) ──────────────────────────────────┐    │
│  │ 🔄 分析中...                                          │    │
│  │ "调用工具检测内存分配..."                             │    │
│  │ [工具调用: memory_profiler]                          │    │
│  │ Token: 856 | 耗时: 4s                              │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─ 💬 LLM (DeepSeek) ────────────────────────────────┐    │
│  │ 🔄 分析中...                                          │    │
│  │ "从缓存角度，建议添加 LRU 缓存策略..."               │    │
│  │ Token: 1,523 | 耗时: 2s                            │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 七、总结

本方案通过引入 **任务管理器 + Controller Pool** 架构，实现：

1. **完全解耦**: 任务与会话分离，支持多任务并发
2. **资源可控**: 通过 TaskLimiter 限制并发数，避免 API 限流
3. **UI 友好**: 并行消息卡片设计，清晰展示多个 AI 的独立输出
4. **向后兼容**: 现有单任务模式作为特例保留

预计开发周期：3-4 周

---

## 八、实现记录 (v3.1 已完成)

### 8.1 实际实现与设计文档的差异

| 设计文档方案 | 实际实现 | 原因 |
|-------------|---------|------|
| Controller Pool + LRU 淘汰 | `taskControllers` Map + reject 新任务 | LRU 淘汰会中断运行中任务，reject 更安全 |
| TaskManager.on() 无 off() | 增加 off() 和 destroy() | 防止内存泄漏 |
| 三种模式（auto/parallel/queue） | 先实现 parallel 模式 | 渐进式开发，queue 模式后续迭代 |
| 事件通道 task:stream 独立 | 复用现有 send-adp-message / cc:invoke，附加 taskId 路由 | 避免重复 500+ 行 ADP 处理逻辑 |
| 建议 RAF 批量更新 | RAF 作为核心实现（非可选） | 高频 delta 必须批量更新避免卡顿 |

### 8.2 已实现文件

| 文件 | 改动 |
|------|------|
| `src/scripts/task-manager.js` | **新增** TaskManager + TaskLimiter + RAF 批量更新 |
| `main.js` | 修改 send-adp-message/cc:invoke 支持 taskId；新增 task:stop/task:list |
| `preload.js` | 新增 taskStop/taskList/onTaskStream IPC 桥接 |
| `src/scripts/app.js` | 新增并行模式切换、任务卡片 UI、事件分发、RAF 渲染 |
| `src/index.html` | 新增 task-manager.js 引用、并行模式切换按钮 |
| `src/styles/components.css` | 新增任务卡片、并行按钮、步骤列表样式 |

### 8.3 性能优化措施

1. **requestAnimationFrame 批量合并**: 高频流式 delta 合并为一次 DOM 更新
2. **流式内容长度限制**: 最大 50KB，超出截断并提示
3. **已完成任务延迟清理**: 5 秒后从 Map 中移除，保留 UI 显示
4. **事件监听器 off() 清理**: 防止内存泄漏
5. **计时器复用**: 每个任务独立计时器，完成后立即清理

### 8.4 待实现（Phase 2+）

- [ ] Queue 排队模式
- [ ] 任务重试
- [ ] 任务历史记录持久化
- [ ] LLM 模式 task:stream 路由
- [ ] 任务间上下文共享
- [ ] 虚拟滚动（大量任务时）
