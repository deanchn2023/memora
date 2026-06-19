# Claude Code 模式生产环境注意事项

> ⚠️ **重要**：本文档记录在 Memora 中集成 `@anthropic-ai/claude-agent-sdk` 的生产环境注意事项。每次修改 CC 模式代码前务必对照本文档检查，避免踩坑。

---

## 一、架构层：SDK 是 spawn 子进程，非纯 HTTP 调用

Claude Code Agent SDK 内部会 spawn 一个 Claude Code CLI 子进程通过 stdio 通信，**不是**简单的 HTTP 请求。

### 1.1 打包要求

- **必须 `asarUnpack`**：`claude` 原生二进制（约 215MB/平台）不能压入 asar，否则运行时无法执行
- 当前配置（`package.json`）：
  ```json
  "asarUnpack": [
    "node_modules/@anthropic-ai/claude-agent-sdk/**",
    "node_modules/@anthropic-ai/claude-agent-sdk-*/**"
  ]
  ```
- **平台二进制包名**：`@anthropic-ai/claude-agent-sdk-{os}-{arch}`（如 `claude-agent-sdk-darwin-arm64`），不是 `claude-code-binary-*`
- **跨平台构建**：mac universal 需同时含 arm64 + x64 二进制；Windows 需 `claude-agent-sdk-win32-x64`

### 1.2 并发限制

- **每 session = 一个进程树**，并发上限受 RAM 约束
- Memora 当前为单窗口单会话，无并发问题
- 若未来支持多会话并行，需按 sessionId 亲和路由 + 监控内存

### 1.3 Session 状态

- SDK 默认将 session transcript 存为 **本地 JSONL 文件**（在 cwd 下）
- 重装应用 / 换机会丢失上下文
- 当前实现：`ccSessionId` 存 localStorage 用于 resume，但 transcript 在磁盘
- 未来扩展：可对接 SDK 的 `InMemorySessionStore` + 自定义持久化实现跨设备

### 1.4 子进程清理

- ✅ 已在 `app.on('before-quit')` 中 abort CC 子进程，避免僵尸进程
- ✅ `ccAbortController` 统一管理，`cc:stop` IPC 可外部终止

### 1.5 SDK 是 ESM 模块，不能用 require（关键踩坑）

`@anthropic-ai/claude-agent-sdk` 是 **ES Module**（`sdk.mjs`），在 CommonJS 的 `main.js` 中 **不能用 `require()`**，否则报错：
```
require() of ES Module .../sdk.mjs not supported.
```

**必须用动态 `import()`**：
```javascript
let claudeAgentSDK = null;
async function loadClaudeAgentSDK() {
  if (claudeAgentSDK !== null) return claudeAgentSDK;
  try {
    claudeAgentSDK = await import('@anthropic-ai/claude-agent-sdk');
    return claudeAgentSDK;
  } catch (e) {
    claudeAgentSDK = false; // 标记失败，避免重复尝试
    return false;
  }
}
// 启动时预加载
loadClaudeAgentSDK();
```

`cc:invoke` handler 中异步获取：
```javascript
const sdk = await loadClaudeAgentSDK();
if (!sdk) return { success: false, error: 'SDK 未加载' };
const { query } = sdk;
```

**已验证**：启动日志输出 `[CC] Claude Agent SDK loaded successfully`。

---

## 二、安全与权限：最容易出事故的地方

### 2.1 工具白名单 + 黑名单双重防御

**绝对不要**只配 `allowedTools: ["Bash"]`——Agent 可能自行 `rm -rf`、`git push`、装包。

当前实现（`main.js` cc:invoke）：
```javascript
const allowedTools = config.allowedTools.split(','); // 默认 Read,Glob,Grep,WebSearch
const disallowedTools = ['Bash', 'Write', 'Edit', 'Monitor', 'Agent']; // 黑名单兜底
```

- **白名单**（`allowedTools`）：用户可配置，默认只读工具
- **黑名单**（`disallowedTools`）：硬编码危险工具，即使用户误配白名单也拦截
- 修改黑名单需极其谨慎，`Bash`/`Write`/`Edit` 解禁会带来 `rm -rf` / 任意文件篡改风险

### 2.2 bypassPermissions 风险

- Electron 桌面应用非 root 容器，风险低于服务端，但仍有数据安全风险
- UI 已对 `bypassPermissions` 选项加 ⚠️ 标记 + 动态警告提示
- **即便选择 bypassPermissions，disallowedTools 仍生效**，这是最后一道防线

### 2.3 环境变量泄露防护（关键修复）

**原代码问题**：`env: { ...process.env }` 全量透传宿主环境变量，子进程可读取宿主的其他 API Key。

**当前实现**：env **白名单**模式，只传必要变量：
```javascript
env: {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  USER: process.env.USER,
  LANG: process.env.LANG,
  TERM: process.env.TERM,
  ANTHROPIC_BASE_URL: config.baseUrl,
  ANTHROPIC_AUTH_TOKEN: config.authToken,
  ANTHROPIC_MODEL: config.model,
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: 'ANTHROPIC_API_KEY', // 清理敏感变量
  ANTHROPIC_API_KEY: '',
}
```

**修改 env 时必须**：只添加必要变量，绝不 `...process.env` 全量透传。

### 2.4 settingSources 污染

- `settingSources: ['user']` 会加载全局 `~/.claude/settings.json`（可能含用户其他 API Key/权限配置）
- 当前实现：`settingSources: ['project']`，只加载项目级配置，不污染
- **不要改为 `['user']` 或不设**，除非明确需要读取用户全局配置

### 2.5 Prompt Injection 与 Read 工具

- `Read` 工具未走 Bubblewrap 沙箱，恶意 prompt 理论上可让 Agent 读取 cwd 内文件
- 已通过 `cwd: userData/cc-workspace` 限制工作目录，火山引擎 Token 在 `settings.json`（不在 cwd 内）
- 风险可控，但若未来解禁 `Write`/`Edit` 需重新评估

### 2.6 API Key 存储

- 火山引擎 Token 存于 `settings.json`（明文）
- 未来改进：迁移到 `keytar` 加密存储（Electron 原生支持）
- 当前 Read 工具被限制在 cc-workspace，无法读取 settings.json

---

## 三、成本与生命周期控制

### 3.1 Agent ≠ Chat Completions

一次 `query()` 可能触发**多轮 tool_use → 多轮 API 调用**，Token 消耗远超单次对话。

### 3.2 maxTurns（必须设）

- 当前默认 `maxTurns: 50`，用户可在设置页调整（1-200）
- 防止单次 query 无限循环消耗 Token

### 3.3 外层 timeout（必须设）

- SDK 无内置 Session 超时，只有 maxTurns 约束
- 当前实现：**10 分钟外层 timeout** + abort
  ```javascript
  const CC_TIMEOUT_MS = 10 * 60 * 1000;
  let ccTimeoutHandle = setTimeout(() => {
    ccAbortController?.abort();
  }, CC_TIMEOUT_MS);
  ```
- 调整 timeout 需权衡：太短打断复杂任务，太长跑飞浪费成本

### 3.4 成本监控

- SDK `ResultMessage` 返回 `total_cost_usd` 和 `usage`
- 当前实现：
  - 主进程日志记录 cost/turns/tokens
  - 单次超 $1 打印警告
  - 前端消息底部展示 token 用量 + 成本（`📊 输入 X · 输出 Y · $Z.ZZZZ`）
- 未来可接入审计系统（复用现有 `auditedDeepSeekCall` 模式）

---

## 四、开发调试坑

### 4.1 stderr 捕获（关键）

- 子进程 stderr **默认丢弃**，异常只报 "exited with code 1"
- 当前实现：挂载 stderr 回调
  ```javascript
  stderr: (data) => {
    console.error('[CC:stderr]', data.toString().trim());
  }
  ```
- **调试 CC 问题时第一步**：看主进程控制台的 `[CC:stderr]` 输出

### 4.2 MCP stdio Server

- 某些 stdio MCP server 不等待连接就绪，导致首轮 tool list 为空
- 当前未集成外部 MCP，暂无此问题
- 未来若集成 MCP 需确认 server 支持或加握手逻辑

### 4.3 system prompt 被框架注入

- SDK 会自动追加 "You are Claude Agent…" 等系统指令
- 用户写的 system prompt 是**拼接**而非完全替换
- 当前实现：`systemRole`（本地上下文注入）通过 prompt 拼接传递，未用 SDK 的 `customSystemPrompt`/`appendSystemPrompt`
- 若需完全控制系统 prompt，可改用 `appendSystemPrompt`（追加而非替换框架默认）

### 4.4 Skills 与上下文压缩

- Skill 描述受上下文预算限制可能被截断
- 上下文 compact 后 user 角色的 Skill 块可能被摘要掉导致召回失败
- 当前未启用 Skills，暂无此问题

---

## 五、生产最小 Checklist（对照当前实现）

| 检查项 | 状态 | 说明 |
|--------|------|------|
| ✅ 显式设 `cwd` | 已完成 | `userData/cc-workspace`，自动创建 |
| ✅ `allowedTools` 白名单 | 已完成 | 默认 `Read,Glob,Grep,WebSearch`，用户可配 |
| ✅ `disallowedTools` 双重防御 | 已完成 | 硬编码 `Bash,Write,Edit,Monitor,Agent` |
| ✅ `maxTurns` | 已完成 | 默认 50，可配 1-200 |
| ✅ 外层 timeout | 已完成 | 10 分钟 + abort |
| ✅ 捕获 stderr | 已完成 | `console.error('[CC:stderr]', ...)` |
| ✅ env 白名单 | 已完成 | 只传必要变量，不 `...process.env` |
| ✅ `settingSources` 限制 | 已完成 | `['project']` 不加载全局配置 |
| ✅ API Key 不在 cwd 可访问区 | 已完成 | Token 在 settings.json，cwd 是 cc-workspace |
| ✅ 子进程退出清理 | 已完成 | `before-quit` abort + `cc:stop` IPC |
| ✅ 成本日志 + 告警 | 已完成 | 主进程日志 + 超 $1 警告 + 前端展示 |
| ⚠️ API Key 加密存储 | 待优化 | 当前明文 settings.json，未来迁移 keytar |
| ⚠️ Session transcript 持久化 | 待优化 | 当前本地 JSONL，未来可对接 InMemorySessionStore |
| ⚠️ 打包体积优化 | 待评估 | 215MB/平台二进制，可考虑按需下载 |

---

## 六、关键代码位置索引

| 功能 | 文件 | 位置 |
|------|------|------|
| SDK require + 默认配置 | `main.js` | 顶部 `claudeAgentSDK` / `DEFAULT_CC_CONFIG` |
| CC 配置读取 | `main.js` | `getCCConfig()` |
| CC IPC handlers | `main.js` | `cc:get-config` / `cc:set-config` / `cc:new-session` / `cc:stop` / `cc:test-connection` / `cc:invoke` |
| CC 流式调用核心 | `main.js` | `ipcMain.handle('cc:invoke', ...)` |
| 子进程清理 | `main.js` | `app.on('before-quit', ...)` |
| CC API 暴露 | `preload.js` | `ccInvoke` / `ccStop` / `ccNewSession` / `onCCStream` 等 |
| CC 模式按钮 | `src/index.html` | `#aiModeCC` |
| CC 设置面板 | `src/index.html` | `#ccPanel` |
| CC 模式分支 | `src/scripts/app.js` | `sendAIMessage` 中 `_aiAssistantMode === 'cc'` |
| CC 流式渲染 | `src/scripts/app.js` | `_handleCCStreamEvent` / `_renderCCStream` / `_finishCCMessage` |
| CC 配置加载/保存 | `src/scripts/app.js` | `_loadCCConfig` / `_testCCConnection` / `saveSettings` |
| CC 停止/新建 | `src/scripts/app.js` | `stopADPGeneration` / `createNewChatSession` |

---

## 七、修改 CC 代码时的自检清单

每次修改 CC 模式代码后，逐项确认：

1. [ ] env 没有改回 `...process.env` 全量透传
2. [ ] `disallowedTools` 黑名单未被移除
3. [ ] `settingSources` 仍为 `['project']`
4. [ ] `cwd` 仍显式指定
5. [ ] `stderr` 回调仍存在
6. [ ] `maxTurns` + 外层 timeout 仍生效
7. [ ] `before-quit` 子进程清理未被删除
8. [ ] cost 日志仍记录
9. [ ] 新增的 IPC 在 `preload.js` 已暴露
10. [ ] `stopADPGeneration` / `createNewChatSession` 的 CC 清理逻辑未被破坏

---

*最后更新：2026-06-19*
*对应 SDK 版本：@anthropic-ai/claude-agent-sdk@0.3.181*
