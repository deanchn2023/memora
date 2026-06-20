# M-Agent 子任务轮询与流式推送方案

## 问题分析

### 现状

当前 M-Agent 的执行流程：

```
用户输入 → cc:invoke → CC SDK query() → 流式消息 → result 事件 → done → 结束
```

CC SDK 的 `query()` 是一个**同步异步迭代器**：它阻塞式地等待 agent 完成所有 turn，然后返回 `result` 事件。

### 问题

当 agent 调用工具启动了一个**异步后台工作流**（如火山引擎 Deep Research），流程变成：

```
1. Agent 调用工具 → 启动 deep-research 工作流 → 获得 task_id (wqq9h2b8a)
2. Agent 输出文本："已经跑 deep-research 工作流了，任务 ID：wqq9h2b8a..."
3. Agent 的 turn 结束 → CC SDK 返回 result 事件 → done → 查询结束
4. deep-research 工作流在后台继续运行（2-10分钟）
5. ❌ 无人轮询任务状态 → 用户看不到进度 → 看不到最终结果
```

**根因**：CC SDK 的 `query()` 只负责 agent 自身的 turn 循环。当 agent 说"任务已启动"并结束时，SDK 认为"工作做完了"，但实际的后台任务还在运行。SDK 没有子任务感知能力。

### 影响场景

| 场景 | 表现 |
|------|------|
| 火山引擎 Deep Research | Agent 返回 task_id 后结束，2-10 分钟后研究完成但无人接收 |
| 任何异步 MCP 工具 | 工具返回 task_id 后 agent 结束，后台任务结果丢失 |
| 长时间 WebSearch 批量搜索 | Agent 可能分批搜索但中间结果不推送 |

---

## 方案设计

### 整体架构

```
┌──────────────┐    ┌──────────────┐    ┌──────────────────┐
│  Renderer    │    │   main.js     │    │  火山引擎 API     │
│  (app.js)    │    │  (Polling     │    │  Deep Research    │
│              │◄───│   Manager)    │◄───│  Backend          │
│  UI 展示进度  │    │               │    │                   │
│  + 最终结果   │    │  每10s轮询    │    │  task_id: xxx     │
│              │    │  推送cc:stream │    │  status: running  │
└──────────────┘    └──────────────┘    └──────────────────┘
```

### 方案 A：应用层轮询（推荐 - 快速实现）

在 `main.js` 中新增 **SubTask Polling Manager**，在 CC query 完成后自动检测并轮询子任务。

#### 1. 任务 ID 检测

**三级置信度提取**（已实现）：

```
Tier 1 — 前缀匹配（置信度 ≥ 0.88）
  ├─ wf_    → workflow run ID (0.95)
  ├─ resp_  → ARK Responses API ID (0.92)
  ├─ task_  → ARK Content Generation ID (0.90)
  └─ conv_  → ARK Conversations ID (0.88)

Tier 2 — 标签匹配（置信度 0.75-0.85）
  ├─ 任务 ID：xxx        (0.85)
  ├─ 工作流 ID：xxx      (0.82)
  ├─ task_id: xxx       (0.80)
  ├─ run_id: xxx        (0.78)
  └─ session_id: xxx    (0.75)

Tier 3 — 上下文匹配（置信度 ≤ 0.60）
  ├─ deep research xxx   (0.60)
  ├─ workflow xxx        (0.55)
  └─ 关键词附近 ID        (0.45)
```

**所有候选 ID 都会被轮询**（最多 5 个），先命中的推送结果，其余的发现 notFound 后自动停止。

CC query 返回 `result` 后，解析结果文本中是否包含任务 ID：

```javascript
// 正则匹配多种格式
const TASK_ID_PATTERNS = [
  /任务[\s]*ID[：:]\s*(\w{6,20})/i,
  /task[_\s]*id[：:]\s*(\w{6,20})/i,
  /工作流[：:]\s*(\w{6,20})/i,
  /(?:deep.?research|深度研究)[^\n]*?(\w{8,20})/i,
];

function extractTaskId(resultText) {
  for (const pattern of TASK_ID_PATTERNS) {
    const match = resultText.match(pattern);
    if (match) return match[1];
  }
  return null;
}
```

#### 2. 轮询管理器

```javascript
// ─── SubTask Polling Manager ───

class SubTaskPoller {
  constructor() {
    this.activePollers = new Map(); // taskId → { timer, sessionId, messageEl }
  }

  /**
   * 启动子任务轮询
   * @param {string} taskId - 异步任务 ID
   * @param {string} sessionId - CC 会话 ID（用于后续 continue）
   * @param {object} apiConfig - API 配置（baseUrl, apiKey, 等）
   */
  start(taskId, sessionId, apiConfig) {
    if (this.activePollers.has(taskId)) return; // 已在轮询

    const pollState = {
      taskId,
      sessionId,
      apiConfig,
      timer: null,
      startTime: Date.now(),
      lastStatus: null,
      maxWaitMs: 10 * 60 * 1000, // 最长等待 10 分钟
      intervalMs: 10 * 1000,      // 每 10 秒轮询一次
    };

    // 立即轮询一次
    this._poll(taskId);

    // 启动定时轮询
    pollState.timer = setInterval(() => {
      this._poll(taskId);
    }, pollState.intervalMs);

    this.activePollers.set(taskId, pollState);

    // 通知前端：开始等待子任务
    this._send(taskId, { event: 'subtask_start', taskId, message: '开始监控子任务执行情况...' });
  }

  async _poll(taskId) {
    const state = this.activePollers.get(taskId);
    if (!state) return;

    // 超时检查
    if (Date.now() - state.startTime > state.maxWaitMs) {
      this._send(taskId, { event: 'subtask_timeout', taskId, message: '子任务执行超时（>10分钟）' });
      this.stop(taskId);
      return;
    }

    try {
      // 调用火山引擎 API 查询任务状态
      const status = await this._queryTaskStatus(taskId, state.apiConfig);

      // 状态变化时推送
      if (status.state !== state.lastStatus) {
        state.lastStatus = status.state;
        this._send(taskId, {
          event: 'subtask_progress',
          taskId,
          state: status.state,        // running / completed / failed
          stage: status.stage,        // 拆分检索角度 / 并行搜索 / 抓取来源 / 多轮核验 / 汇总报告
          progress: status.progress,   // 0-100
          message: status.message,
          elapsed: Math.floor((Date.now() - state.startTime) / 1000),
        });
      }

      // 任务完成
      if (status.state === 'completed') {
        const result = await this._getTaskResult(taskId, state.apiConfig);
        this._send(taskId, {
          event: 'subtask_done',
          taskId,
          result,
          elapsed: Math.floor((Date.now() - state.startTime) / 1000),
        });
        this.stop(taskId);

        // 可选：自动发起新一轮 CC query，让 agent 格式化结果
        // this._autoContinue(state.sessionId, result);
      } else if (status.state === 'failed') {
        this._send(taskId, {
          event: 'subtask_error',
          taskId,
          error: status.error || '子任务执行失败',
        });
        this.stop(taskId);
      }
    } catch (e) {
      console.error(`[SubTask] Poll error for ${taskId}:`, e);
      // 网络错误不停止轮询，下次重试
      this._send(taskId, {
        event: 'subtask_progress',
        taskId,
        state: 'running',
        message: `查询状态中... (网络重试)`,
        elapsed: Math.floor((Date.now() - state.startTime) / 1000),
      });
    }
  }

  async _queryTaskStatus(taskId, apiConfig) {
    // TODO: 根据火山引擎 API 文档实现
    // 预期 API 格式（需确认）：
    // GET https://ark.cn-beijing.volces.com/api/v3/deep-research/tasks/{taskId}
    // Headers: Authorization: Bearer {apiKey}
    const response = await fetch(`${apiConfig.baseUrl}/deep-research/tasks/${taskId}`, {
      headers: { 'Authorization': `Bearer ${apiConfig.apiKey}` },
    });
    return response.json();
  }

  async _getTaskResult(taskId, apiConfig) {
    // TODO: 根据火山引擎 API 文档实现
    const response = await fetch(`${apiConfig.baseUrl}/deep-research/tasks/${taskId}/result`, {
      headers: { 'Authorization': `Bearer ${apiConfig.apiKey}` },
    });
    return response.json();
  }

  _send(taskId, data) {
    if (mainWindow) {
      mainWindow.webContents.send('cc:stream', { ...data, _subtask: true });
    }
  }

  stop(taskId) {
    const state = this.activePollers.get(taskId);
    if (state?.timer) clearInterval(state.timer);
    this.activePollers.delete(taskId);
  }

  stopAll() {
    for (const taskId of this.activePollers.keys()) {
      this.stop(taskId);
    }
  }
}

const subTaskPoller = new SubTaskPoller();
```

#### 3. 集成到 CC invoke 流程

在 `main.js` 的 `result` 事件处理中，添加子任务检测：

```javascript
// 在 result 事件处理中（约 line 4187）
if (msg.type === 'result') {
  // ... 现有逻辑 ...

  if (msg.subtype === 'success' && !msg.is_error) {
    const resultText = msg.result || '';

    // 🔔 子任务检测：检查结果中是否包含异步任务 ID
    const subTaskId = extractTaskId(resultText);
    if (subTaskId) {
      console.log(`[CC] Detected sub-task: ${subTaskId}, starting polling...`);
      // 发送 done 事件（当前 query 结束）
      send({ event: 'done', sessionId: msg.session_id || newSessionId, usage: msg.usage, result: resultText, cost });

      // 启动子任务轮询
      const apiConfig = {
        baseUrl: config.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
        apiKey: config.authToken,
      };
      subTaskPoller.start(subTaskId, msg.session_id || newSessionId, apiConfig);
    } else {
      // 正常流程
      send({ event: 'done', sessionId: msg.session_id || newSessionId, usage: msg.usage, result: resultText, cost });
    }
    break;
  }
}
```

#### 4. 前端事件处理

在 `app.js` 的 `_handleCCStreamEvent` 中，添加子任务事件处理：

```javascript
// 子任务开始
if (event === 'subtask_start' && evt._subtask) {
  this._addCCProgressStep(messageContent, '🔬', `子任务监控已启动: ${evt.taskId}`, 'active');
  return;
}

// 子任务进度
if (event === 'subtask_progress' && evt._subtask) {
  const stage = evt.stage || '';
  const progress = evt.progress ? ` (${evt.progress}%)` : '';
  const elapsed = evt.elapsed ? ` ${evt.elapsed}s` : '';
  this._addCCProgressStep(messageContent, '⏳', `${stage}${progress}${elapsed}`, 'active');
  return;
}

// 子任务完成
if (event === 'subtask_done' && evt._subtask) {
  this._addCCProgressStep(messageContent, '✅', `子任务完成 (${evt.elapsed}s)`, 'done');
  // 渲染研究结果
  if (evt.result) {
    const resultHtml = this._formatSubTaskResult(evt.result);
    messageContent.insertAdjacentHTML('beforeend', resultHtml);
  }
  return;
}

// 子任务超时/错误
if (event === 'subtask_timeout' && evt._subtask) {
  this._addCCProgressStep(messageContent, '⏰', evt.message, 'error');
  return;
}
if (event === 'subtask_error' && evt._subtask) {
  this._addCCProgressStep(messageContent, '❌', evt.error, 'error');
  return;
}
```

#### 5. UI 展示效果

执行过程中用户看到：

```
🧠 M-Agent 已启动                    ✓
🔬 子任务监控已启动: wqq9h2b8a       ✓
⏳ 拆分检索角度 (20s)                ✓
⏳ 并行搜索中... 45% (35s)           →（动态更新）
⏳ 抓取来源 78% (60s)                →
⏳ 多轮核验 92% (85s)                →
✅ 子任务完成 (120s)                  ✓

━━━ 研究报告 ━━━
[完整研究报告内容/HTML]
```

---

### 方案 B：MCP Server 方案（长期 - Agent 原生）

构建一个 **DeepResearch MCP Server**，提供 4 个工具：

| Tool | 功能 | 特性 |
|------|------|------|
| `start_research` | 启动深度研究 | 返回 task_id |
| `wait_research` | 等待并接收流式输出 | 持续到任务结束，通过 `ctx.report_progress` 推送进度 |
| `query_research` | 查询当前状态 | 立即返回 |
| `cancel_research` | 取消研究任务 | 输入 task_id |

Agent 调用 `start_research` → 获得 `task_id` → 调用 `wait_research` → CC SDK 保持运行，流式接收进度 → 最终结果返回 → agent 格式化为 HTML。

**优势**：CC SDK 自然处理流式输出，不需要应用层轮询，完全 agent 原生。

**劣势**：需要构建和部署 MCP Server，开发量较大。

参考实现：[MCP 异步 DeepResearch 工具](https://devpress.csdn.net/v1/article/detail/148701756)

---

### 方案 C：Agent Prompt 优化（最轻量）

修改 agent 的 system prompt / skill，指示 agent **不要在启动异步任务后立即返回**，而是：

1. 调用工具启动 deep-research
2. 获得 task_id 后，**继续使用 WebSearch/WebFetch 工具轮询任务状态**
3. 向用户报告进度
4. 任务完成后格式化结果

```
当你启动异步研究任务并获得 task_id 后：
1. 不要立即返回结果给用户
2. 使用 WebFetch 工具定期查询任务状态（每 15 秒）
3. 每次查询后向用户报告当前进度
4. 任务完成后，将结果整理为用户要求的格式
5. 如果任务超过 5 分钟未完成，告知用户预计剩余时间
```

**优势**：零代码改动，只改 prompt。
**劣势**：消耗更多 token（agent 每次 turn 都需要调用工具），且 agent 可能不遵守。

---

## 推荐实施路径

```
阶段 1（立即）→ 方案 A：应用层轮询
  - 快速实现，不依赖 agent 行为
  - 需要确认火山引擎 Deep Research API endpoint
  
阶段 2（中期）→ 方案 C：Agent Prompt 优化
  - 作为补充，让 agent 主动等待
  
阶段 3（长期）→ 方案 B：MCP Server
  - 完全 agent 原生，最优雅
  - 与未来 MCP 架构演进一致
```

---

## 待确认事项

### 🔴 关键阻塞：火山引擎 Deep Research API

当前**已确认**火山引擎 ARK API 的异步任务接口（基于官方文档调研 2026-06-19）：

### ARK API 异步任务模式

ARK API 有三种异步任务模式，通过 ID 前缀区分：

| ID 前缀 | API 模式 | 查询端点 | 状态值 |
|---------|---------|---------|--------|
| `resp_` | Responses API | `GET {base}/responses/{id}` | queued, in_progress, completed, failed, incomplete, cancelled |
| `task_` | Content Generation | `GET {base}/contents/generations/tasks/{id}` | queued, processing, completed, failed |
| `conv_` | Async Chat Completions | `GET {base}/async/chat/completions/{id}` | running, succeeded, failed |
| `wf_` | Workflow Run ID (内部) | 尝试以上所有端点 | 不确定 |

### Base URL 推导

| 供应商 | Provider BaseUrl | API Base URL (推导后) |
|--------|-----------------|----------------------|
| 火山引擎 Coding Plan | `https://ark.cn-beijing.volces.com/api/coding` | `https://ark.cn-beijing.volces.com/api/coding/v3` |
| 火山引擎标准 ARK | `https://ark.cn-beijing.volces.com/api/v3` | `https://ark.cn-beijing.volces.com/api/v3` (无变化) |
| 腾讯云 Coding Plan | `https://api.lkeap.cloud.tencent.com/coding/anthropic` | 直接使用 (Anthropic 兼容端点) |

**关键**：Coding Plan 的 baseUrl 是 `/api/coding`，需追加 `/v3` 后缀才是 API 调用路径。
代码中 `_deriveArkApiBase()` 方法自动处理这个推导。

### 认证方式

所有 ARK API 均使用 `Bearer Token` 认证：
```
Authorization: Bearer <API_KEY>
```

### 可能的 API 来源

1. 火山引擎方舟（ARK）平台 API 文档
2. CC SDK 内部是否封装了 deep-research 调用（检查 SDK 源码）
3. Agent 的 system prompt / skill 中是否有 deep-research 的调用说明

### 排查方法

```bash
# 1. 查看 CC SDK 是否有 deep-research 相关代码
grep -r "deep.research\|deep_research\|DeepResearch" node_modules/@anthropic-ai/claude-code/

# 2. 查看 CC 工作目录的 skill 配置
ls ~/Library/Application\ Support/Memora/cc-workspace/.claude/skills/

# 3. 查看 agent 的 system prompt
cat ~/Library/Application\ Support/Memora/cc-workspace/CLAUDE.md

# 4. 下次执行时查看 CC 的完整日志
# 在 main.js 的 msg.type === 'assistant' 处打印完整 block
```

---

## 技术要点

### 1. 轮询频率与退避

```
初始间隔：10s
如果连续 3 次状态未变：间隔增加到 15s
如果连续 6 次状态未变：间隔增加到 30s
最大间隔：30s
最长等待：10 分钟（超时自动停止）
```

### 2. 与 CC Session 的关系

- 子任务轮询独立于 CC SDK 的 `query()`
- 轮询通过 `cc:stream` 通道推送（复用现有 IPC）
- 前端通过 `evt._subtask` 标记区分子任务事件
- 子任务完成后，可选择**自动发起新一轮 CC query**（让 agent 格式化结果）

### 3. 多子任务支持

Agent 可能同时启动多个子任务：
- `activePollers` Map 支持并发轮询多个 taskId
- 每个 taskId 独立计时和状态跟踪
- 前端按 taskId 分组展示进度

### 4. 错误处理

| 错误类型 | 处理方式 |
|----------|---------|
| 网络超时 | 重试 3 次，不停止轮询 |
| API 返回 401/403 | 停止轮询，提示用户检查 API Key |
| API 返回 404 | 停止轮询，提示任务不存在 |
| 任务超时（>10min） | 停止轮询，提示超时 |
| 用户主动停止 | 清除所有轮询定时器 |
