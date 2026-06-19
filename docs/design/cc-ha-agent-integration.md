# Claude Code / Hermes Agent 对接方案

> 本文档 supersede `claude-mode-integration.md`。旧文档是"直连 Anthropic Messages API"的轻量方案；本文档针对"对接开源 Agent 应用并与应用打包"的完整需求，对比 Claude Code (CC) 与 Hermes Agent (HA) 两个开源方案，给出选型建议与落地设计。

---

## 一、背景与目标

### 1.1 当前架构

Memora v2.6.0 已支持两种 AI 模式，二者均通过 `preload.js` 暴露的 `electronAPI` + 主进程 IPC + SSE 事件流实现：

| 模式 | 入口 | IPC | 流式事件 | 后端 |
|------|------|-----|----------|------|
| **Agent** | `sendADPMessage` | `send-adp-message` | `adp:sse-event` | 腾讯云 LKE ADP V2（云端 SSE，`adp agent sdk/server.js` 做 Fastify 代理） |
| **LLM** | `agent.invoke` | `agent:invoke` | `agent:stream` | 本地配置的 DeepSeek/OpenAI 兼容 API（main.js 内直接 fetch） |

模式切换由 `_aiAssistantMode`（`agent`/`llm`）+ IPC `get-global-ai-mode`/`set-global-ai-mode` 全局控制，UI 在 `src/index.html` 的 `.ai-mode-toggle`。

### 1.2 目标

在 Agent / LLM 之外新增第三模式，对接本地已安装的**开源 Agent 应用**，并满足：

1. 复用现有"IPC + SSE 事件流 + 模式切换"骨架，不破坏 ADP/LLM 既有逻辑；
2. 该模式未来能与所选 Agent 应用**打包在一起**发行；
3. 选型需考量开源项目的**持续维护确定性**（用户核心关切）。

---

## 二、候选方案对比

### 2.1 项目基本面对比

| 维度 | Claude Code (CC) | Hermes Agent (HA) |
|------|------------------|-------------------|
| **维护方** | Anthropic（官方，AI 头部厂商） | Nous Research（硅谷研究机构） |
| **开源范围** | CLI 闭源；**Agent SDK 开源**（`@anthropic-ai/claude-agent-sdk` / `claude-agent-sdk`） | **全开源**（MIT） |
| **技术栈** | Node.js / TypeScript | Python 3.11（+ 少量 TS/JS 用于 Web/TUI） |
| **最新版本** | 随 Anthropic 持续发布 | v0.16.0（2026-06-05） |
| **社区热度** | 官方背书，生态最大 | 197k stars / 34.7k forks，增长快 |
| **模型支持** | Claude（支持 Bedrock / Vertex / Azure / Foundry 多云） | 10+ 提供商（Nous Portal / OpenRouter / OpenAI / GLM / Kimi / MiniMax…），**零锁定** |
| **核心能力** | 编程、文件操作、Bash、多步推理、MCP、子 Agent、Hooks | 通用对话、技能自演化（过程化记忆）、多平台消息网关、闭环学习 |
| **会话管理** | SDK 原生 `session_id` resume，JSONL 持久化 | FTS5（SQLite 全文检索）本地存储 |
| **对外接口** | SDK `query()` async iterator（直接 import） | CLI + MCP Server（`mcp_serve.py`）+ RPC + 消息网关，**无传统 REST SDK** |

### 2.2 对接 Memora（Electron）的契合度对比

| 维度 | Claude Code | Hermes Agent |
|------|-------------|--------------|
| **技术栈契合** | ✅ Node.js/TS，与 Electron 主进程**同栈**，可直接 `import` SDK | ⚠️ Python，需跨语言桥接（子进程 / MCP stdio） |
| **打包成本** | ✅ 近乎零：`npm install` 即可，SDK 自带平台原生二进制 | ❌ 高：需捆绑 Python 3.11 runtime（python-build-standalone ~50MB+）或要求用户预装 |
| **流式对接** | ✅ `for await (const msg of query(...))` 原生 async iterator，天然映射到现有 `agent:stream` 模式 | ⚠️ 需 spawn `hermes` CLI 解析 stdout，或走 MCP stdio 协议解析 JSON-RPC |
| **会话映射** | ✅ `session_id` 直接对应现有 `_chatSessions.conversationId`（ADP 同款模式） | ⚠️ 需自行维护会话标识与 HA 会话的映射 |
| **模型自由度** | ⚠️ 锁定 Claude 系列（多云可选） | ✅ 任意模型，零锁定 |
| **能力侧重** | 编程/文件操作极强，通用知识对话也优秀 | 通用 Agent + 技能自演化，更偏"成长型助手" |

### 2.3 持续维护确定性分析（用户核心关切）

**Claude Code SDK**
- 由 Anthropic 官方维护，是其商业核心产品线的官方 SDK，**资金与技术背书最强**；
- SDK 随 Claude 模型迭代同步更新，API 稳定性有 SemVer 保障；
- 被泄露的 CLI 源码（51.2 万行）与正式开源的 SDK 共用内核，维护投入巨大；
- **结论：长期维护确定性极高**，几乎不存在弃维风险。

**Hermes Agent**
- Nous Research 是活跃的 AI 研究机构（Hermes 系列开源模型闻名），MIT 协议；
- v0.16.0（2026-06）仍在活跃迭代，腾讯云轻量服务器已上线官方模板，社区贡献活跃；
- 但机构体量与 Anthropic 量级差距大，**研究机构项目的长期路线图确定性弱于商业公司**；
- 全 MIT 开源，即便官方放缓，社区 fork 接力的可行性高于闭源 CLI；
- **结论：中短期维护确定性高，长期（2 年+）存在一定不确定性，但开源协议降低了断层风险。**

### 2.4 选型推荐

> **推荐 Claude Code SDK 为主方案**，Hermes Agent 作为备选/未来可切换项。

**核心理由**：
1. **打包成本是硬约束**：CC 与 Electron 同栈，`npm install` 即内嵌，发行包体积增量小、跨平台签名简单；HA 需捆绑 Python runtime，体积与维护成本显著上升。
2. **对接复杂度低**：CC SDK 的 `query()` async iterator 直接映射现有 `agent:stream` 事件流模式，改动最小；HA 需 MCP/子进程桥接。
3. **维护确定性最高**：Anthropic 官方背书。
4. **会话模型同构**：CC 的 `session_id` 与现有 ADP `conversationId` 模式一致，复用现有一套会话持久化逻辑。

**权衡与缓解**（CC 模型锁定问题）：
- CC 支持 Bedrock/Vertex/Azure/Foundry 多云，并非单一端点锁定；
- 通过下文「适配器抽象层」设计，将 Agent 后端抽象为 `AgentProvider` 接口，未来若需切到 HA 或其他 Agent，仅需新增一个 Provider 实现，UI/IPC 层零改动。

---

## 三、架构设计

### 3.1 总体架构

```
┌─────────────────────────────────────────────────────────┐
│  渲染进程 (src/scripts/app.js)                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │ ai-mode-toggle: [Agent] [LLM] [🧠 CC]  ← 新增    │   │
│  │ sendAIMessage() 按 _aiAssistantMode 分支          │   │
│  └──────────────────────────────────────────────────┘   │
└───────────────┬─────────────────────────────────────────┘
                │ IPC (preload.js 暴露 electronAPI)
┌───────────────▼─────────────────────────────────────────┐
│  主进程 (main.js)                                        │
│  ┌──────────────────────────────────────────────────┐   │
│  │ AgentProvider 抽象层 (新增)                        │   │
│  │  ├─ AdpProvider   (现有 Agent 模式)               │   │
│  │  ├─ LlmProvider   (现有 LLM 模式)                 │   │
│  │  ├─ ClaudeCodeProvider (新增, 主推荐)             │   │
│  │  └─ HermesProvider     (新增, 备选, 后续)         │   │
│  └──────────────────────────────────────────────────┘   │
│  IPC: cc:invoke / cc:stop / cc:new-session              │
│  事件: cc:stream (delta / tool_use / tool_result / done)│
└───────────────┬─────────────────────────────────────────┘
                │ @anthropic-ai/claude-agent-sdk
                ▼
         Claude Code Agent (内嵌二进制)
```

### 3.2 AgentProvider 抽象接口

新增 `src/scripts/agentProvider.js`（主进程侧），统一三种后端调用契约，避免 `sendAIMessage` 内继续堆 if-else：

```javascript
// src/scripts/agentProvider.js (主进程 require)
class AgentProvider {
  /**
   * @param {object} params { message, attachments, sessionId, systemRole, onEvent }
   * @returns {Promise<{ success, sessionId?, streaming }>}
   */
  async invoke({ message, attachments, sessionId, systemRole, onEvent }) {
    throw new Error('Not implemented');
  }
  async stop() {}
  async newSession() { return null; }
}
```

各模式实现该接口；`sendAIMessage` 仅根据 `_aiAssistantMode` 选择 Provider，业务逻辑统一。

### 3.3 ClaudeCodeProvider 实现要点

基于 CC SDK 真实 API（`query()` async iterator + `ClaudeAgentOptions`）：

```javascript
// main.js 内（或独立模块）
const { query, ClaudeAgentOptions } = require('@anthropic-ai/claude-agent-sdk');

class ClaudeCodeProvider extends AgentProvider {
  constructor() {
    super();
    this._abort = null;       // AbortController
    this._currentStream = null;
  }

  async invoke({ message, attachments, sessionId, systemRole, onEvent }) {
    const apiKey = getSetting('cc_api_key'); // 或环境变量 ANTHROPIC_API_KEY
    if (!apiKey && !process.env.ANTHROPIC_API_KEY) {
      return { success: false, error: 'Claude Code API Key 未配置' };
    }

    // 附件：CC 原生支持文件工具，文档/图片可落盘后让 Agent 读取，
    // 或直接拼入 prompt（文本类）。此处采用拼入 prompt 的轻量方案。
    let prompt = message;
    if (attachments?.length) {
      const fileText = attachments
        .filter(a => a.textContent)
        .map(a => `[文件: ${a.name}]\n${a.textContent}`)
        .join('\n\n');
      if (fileText) prompt = `${fileText}\n\n${message}`;
    }

    const options = new ClaudeAgentOptions({
      allowedTools: getSetting('cc_allowed_tools')?.split(',') || ['Read', 'Glob', 'Grep'],
      permissionMode: getSetting('cc_permission_mode') || 'default',
      // 恢复会话：复用 ADP conversationId 同款模式
      ...(sessionId ? { resume: sessionId } : {}),
    });

    this._abort = new AbortController();
    let newSessionId = sessionId;

    // 异步消费流，逐消息推送 onEvent（映射到 cc:stream）
    (async () => {
      try {
        this._currentStream = query({
          prompt,
          options,
          abortController: this._abort,
        });

        for await (const msg of this._currentStream) {
          // SystemMessage(init) 携带 session_id
          if (msg.type === 'system' && msg.subtype === 'init') {
            newSessionId = msg.data?.session_id;
            onEvent({ event: 'session', sessionId: newSessionId });
            continue;
          }
          // 助手文本增量
          if (msg.type === 'assistant') {
            for (const block of msg.message?.content || []) {
              if (block.type === 'text') {
                onEvent({ event: 'delta', content: block.text });
              } else if (block.type === 'tool_use') {
                onEvent({ event: 'tool_use', name: block.name, input: block.input });
              }
            }
            continue;
          }
          // 工具执行结果
          if (msg.type === 'result') {
            onEvent({ event: 'tool_result', content: msg.result });
            continue;
          }
          // 最终结果
          if (msg.type === 'result' && msg.subtype === 'success') {
            onEvent({ event: 'done', sessionId: newSessionId, usage: msg.usage });
          }
        }
        onEvent({ event: 'done', sessionId: newSessionId });
      } catch (e) {
        if (e.name !== 'AbortError') {
          onEvent({ event: 'error', error: e.message });
        }
      }
    })();

    return { success: true, streaming: true, sessionId: newSessionId };
  }

  async stop() {
    this._abort?.abort();
  }
}
```

> 注：SDK 流式消息的精确字段名以 `@anthropic-ai/claude-agent-sdk` 实际类型定义为准，上方为基于官方文档的结构化处理，落地时需对照 SDK d.ts 校准 `msg.type` / `msg.subtype` 枚举。

### 3.4 流式事件统一映射

将 CC 的消息流映射到与现有 `agent:stream` 同构的事件，前端复用渲染逻辑：

| CC SDK 消息 | `cc:stream` 事件 | 复用前端处理 |
|-------------|------------------|--------------|
| `system` (init, session_id) | `{ event: 'session', sessionId }` | 保存到 `_chatSessions.conversationId`（同 ADP） |
| `assistant` content text | `{ event: 'delta', content }` | 追加到气泡（同 `agent:stream` delta） |
| `assistant` content tool_use | `{ event: 'tool_use', name, input }` | 渲染工具调用步骤（同 ADP progress steps） |
| `result` | `{ event: 'tool_result', content }` | 工具结果展示 |
| 流结束 | `{ event: 'done', sessionId, usage }` | 结束流式 UI、记录审计 |

---

## 四、配置与 UI

### 4.1 模式切换 UI

`src/index.html` 新增第三个按钮（贴合现有 `.ai-mode-toggle` 结构）：

```html
<div class="ai-mode-toggle" id="aiModeToggle">
  <button class="ai-mode-btn active" data-mode="agent" id="aiModeAgent">🤖 Agent</button>
  <button class="ai-mode-btn" data-mode="llm" id="aiModeLLM">💬 LLM</button>
  <button class="ai-mode-btn" data-mode="cc" id="aiModeCC">🧠 CC</button>  <!-- 新增 -->
</div>
```

### 4.2 配置项

| 配置项 | 说明 | 示例 |
|--------|------|------|
| `cc_api_key` | Anthropic API Key（也可走环境变量 `ANTHROPIC_API_KEY`） | `sk-ant-xxx` |
| `cc_model` | 模型（SDK 默认随订阅，可选覆盖） | `claude-sonnet-4-5` |
| `cc_allowed_tools` | 允许的工具，逗号分隔 | `Read,Glob,Grep,WebSearch` |
| `cc_permission_mode` | 权限模式 | `default` / `acceptEdits` / `bypassPermissions` |
| `cc_workdir` | Agent 工作目录（默认用户数据目录） | `/Users/.../memora-data` |

设置页新增 CC 配置区块（复用现有 LLM 配置面板的样式与保存逻辑）。

---

## 五、代码改动清单

### 5.1 `package.json`

```diff
+ "dependencies": {
+   "@anthropic-ai/claude-agent-sdk": "^0.1.0"
+ }
```

### 5.2 `preload.js`

```diff
+ // Claude Code 模式
+ ccInvoke: (data) => ipcRenderer.invoke('cc:invoke', data),
+ ccStop: () => ipcRenderer.invoke('cc:stop'),
+ ccNewSession: () => ipcRenderer.invoke('cc:new-session'),
+ onCCStream: (callback) => {
+   ipcRenderer.on('cc:stream', (event, data) => callback(data));
+ },
+ removeCCListeners: () => {
+   ipcRenderer.removeAllListeners('cc:stream');
+ },
```

### 5.3 `main.js`

```diff
+ const { ClaudeCodeProvider } = require('./src/scripts/agentProvider');
+ const ccProvider = new ClaudeCodeProvider();

+ ipcMain.handle('cc:invoke', async (event, { message, attachments, sessionId, systemRole }) => {
+   return ccProvider.invoke({
+     message, attachments, sessionId, systemRole,
+     onEvent: (data) => mainWindow.webContents.send('cc:stream', data),
+   });
+ });

+ ipcMain.handle('cc:stop', async () => { await ccProvider.stop(); });
+ ipcMain.handle('cc:new-session', async () => { return ccProvider.newSession(); });

// get-global-ai-mode / set-global-ai-mode 已支持任意 mode 字符串，无需改动
```

### 5.4 `src/scripts/app.js`

```diff
  // sendAIMessage 内，模式分支
- const isAgentMode = this._aiAssistantMode !== 'llm';
- if (forceMode === 'adp' || isAgentMode) { /* ADP */ }
- else if (window.electronAPI?.agent?.invoke) { /* LLM */ }

+ if (forceMode === 'adp' || this._aiAssistantMode === 'agent') {
+   /* ADP 流式（现有逻辑不动） */
+ } else if (this._aiAssistantMode === 'cc') {
+   // Claude Code 模式
+   const ccResult = await window.electronAPI.ccInvoke({
+     message, attachments: attachmentData, sessionId: activeSession?.ccSessionId,
+     systemRole: localContextSystemRole,
+   });
+   if (ccResult.success && ccResult.streaming) {
+     await new Promise((resolve) => {
+       this._ccStreamResolve = resolve;
+       window.electronAPI.onCCStream((evt) => this._handleCCStreamEvent(evt, assistantMessage));
+     });
+   }
+ } else if (window.electronAPI?.agent?.invoke) {
+   /* LLM 流式（现有逻辑不动） */
+ }

+ // 新增 CC SSE 事件处理（结构参照 _handleADPSSEEvent）
+ _handleCCStreamEvent(evt, messageEl) {
+   const content = messageEl.querySelector('.message-content');
+   switch (evt.event) {
+     case 'session':
+       // 持久化 ccSessionId（同 ADP conversationId 模式）
+       if (this._activeSessionId) {
+         const s = this._chatSessions.find(x => x.id === this._activeSessionId);
+         if (s) { s.ccSessionId = evt.sessionId; this._saveChatSessions(); }
+       }
+       break;
+     case 'delta':
+       this._appendCCDelta(content, evt.content); // 追加文本，复用 markdown 渲染
+       break;
+     case 'tool_use':
+       this._appendCCToolStep(content, evt.name, evt.input); // 渲染工具步骤
+       break;
+     case 'tool_result':
+       this._appendCCToolResult(content, evt.content);
+       break;
+     case 'done':
+       this._finalizeCCStream(content, evt.usage);
+       this._ccStreamResolve?.();
+       break;
+     case 'error':
+       content.innerHTML += `<div class="cc-error">⚠️ ${this.escapeHtml(evt.error)}</div>`;
+       this._ccStreamResolve?.();
+       break;
+   }
+ }
```

### 5.5 `src/index.html` + `src/styles/main.css`

新增 CC 按钮（见 4.1）与配置区块；样式复用 `.ai-mode-btn`，CC 专属的 `.cc-tool-step`、`.cc-error` 等少量新增。

---

## 六、打包方案

### 6.1 Claude Code（推荐，主方案）

CC SDK 会自动安装平台对应的原生二进制作为 optionalDependencies，打包需确保二进制进入最终包：

```json
// package.json build 配置
"build": {
  "asarUnpack": [
    "node_modules/@anthropic-ai/claude-agent-sdk/**",
    "node_modules/@anthropic-ai/claude-agent-sdk-binary-*/**"
  ],
  "extraResources": [],
  "mac": { "target": ["dmg"] },
  "win": { "target": ["nsis"] }
}
```

要点：
- `asarUnpack` 让原生二进制不被压入 asar（运行时需直接执行）；
- 跨平台构建时各平台二进制按 `os`/`arch` 自动选择，无需手动管理；
- **无需捆绑额外 runtime**（Node.js 由 Electron 提供），体积增量约 30–60MB（SDK 二进制）；
- API Key 首次启动引导用户配置，或读取系统已登录的 Claude 凭证。

### 6.2 Hermes Agent（备选，未来可切换）

若日后切换到 HA，打包方案：

| 方案 | 做法 | 体积增量 | 复杂度 |
|------|------|----------|--------|
| **A. 要求预装** | 启动时检测 `hermes` 命令，缺失则引导安装 | 0 | 低，但体验差 |
| **B. 捆绑 Python** | 用 [python-build-standalone](https://github.com/indygreg/python-build-standalone) 捆绑 Python 3.11 + uv 依赖，`extraResources` 打入 | +80–120MB | 高，跨平台签名/权限复杂 |
| **C. MCP stdio 桥接** | memora 作为 MCP Client，spawn `hermes mcp` 子进程，JSON-RPC over stdio | 取决于 HA 是否预装 | 中 |

> 备选方案仅在主方案（CC）无法满足业务（如强需求模型自由度）时启用，届时通过新增 `HermesProvider` 实现 `AgentProvider` 接口即可，UI/IPC 层零改动。

---

## 七、实施阶段

### Phase 0：选型确认（0.5 天）
- 本地 `npm install @anthropic-ai/claude-agent-sdk` 跑通官方示例；
- 确认 SDK 流式消息的精确字段名（对照 d.ts）；
- 验证 `session_id` resume 在 Electron 主进程可用。

### Phase 1：Provider 抽象 + CC 基础对话（1–2 天）
1. 新增 `src/scripts/agentProvider.js`，定义 `AgentProvider` 基类与 `ClaudeCodeProvider`；
2. `main.js` 注册 `cc:invoke` / `cc:stop` / `cc:new-session` IPC；
3. `preload.js` 暴露 CC API；
4. `app.js` `sendAIMessage` 增加 `cc` 分支 + `_handleCCStreamEvent`；
5. 跑通纯文本流式对话。

### Phase 2：会话持久化 + 配置 UI（1 天）
1. `ccSessionId` 映射到 `_chatSessions`，切换会话时 resume；
2. 设置页 CC 配置区块（API Key / 工具 / 权限模式）；
3. 模式切换按钮上线。

### Phase 3：附件 + 工具调用展示（1–2 天）
1. 文本附件拼入 prompt；图片附件落盘后让 Agent `Read`；
2. `tool_use` / `tool_result` 渲染为可折叠步骤（复用 ADP progress steps 样式）；
3. 审计日志接入（复用 `auditedDeepSeekCall` 模式记录 CC 调用）。

### Phase 4：打包验证（1 天）
1. `electron-builder` 配置 `asarUnpack`；
2. mac / win 双平台构建，验证 SDK 原生二进制可执行；
3. 首次启动 API Key 引导流程。

**预计总工作量：4.5–6.5 天**。

---

## 八、风险与回退

| 风险 | 影响 | 缓解 |
|------|------|------|
| CC SDK API 变更 | 流式解析失效 | Provider 封装隔离；SDK 升级按 SemVer，锁版本 |
| CC 模型锁定 Claude | 无法用 DeepSeek 等本地模型 | 保留 LLM 模式作为本地模型出口；CC 侧重 Agent 能力 |
| SDK 原生二进制打包遗漏 | 运行时报错 | `asarUnpack` 配置 + 构建后冒烟测试 |
| API Key 泄露 | 安全风险 | Key 存于主进程 keytar / 加密存储，不进渲染进程 |
| 用户无 Anthropic 订阅 | 无法使用 | 引导配置 API Key；或降级提示切换 LLM 模式 |

**回退策略**：CC 模式为独立分支，失败不影响 Agent/LLM；用户可随时切回。若 CC 长期不可用，移除 `cc` 分支与依赖即可，架构无侵入。

---

## 九、与 Hermes Agent 的未来切换路径

若后续业务需要 HA 的模型自由度或技能自演化能力：

1. 新增 `HermesProvider extends AgentProvider`，内部以 MCP stdio 方式 spawn `hermes`；
2. 配置项新增 `agent_backend: 'cc' | 'hermes'`，CC 按钮可按需切换后端；
3. UI/IPC/事件流零改动（统一走 `cc:stream` 事件契约，或重命名为通用 `agent-provider:stream`）。

适配器抽象层是关键投资：它让"对接哪个开源 Agent"从一次性硬编码变为可插拔选择，对冲单一项目维护风险。
