# Claude Code + 国产模型代理 对接方案 v2

> 本文档是 `cc-ha-agent-integration.md` 的演进版，针对**中国大陆用户**场景修订：默认经 claude-code-router 转发到国产模型；网络可直连海外时自动绕过 router 直连 Anthropic。通过设置开关控制，两者对上层透明。
>
> **实施记录（2026-06-19）**：实际开发采用**火山引擎 Coding Plan**（原生 Anthropic 兼容），无需 claude-code-router 转换层，方案大幅简化。本文档保留 CCR 方案作为未来多 provider 扩展参考，实际实现见文末「实施记录」。

---

## 一、需求与约束

### 1.1 用户场景
- 中国大陆用户，希望使用 Claude Code 的 Agent 能力（工具循环、文件操作、多步推理）；
- 默认通过 **claude-code-router (CCR)** 转发到国产模型（DeepSeek / GLM / Kimi / Qwen），零翻墙可用；
- 若用户网络能直连海外（如已配代理或身处海外），可一键切换直连 Anthropic，享受原生 Claude；
- 需与所选方案打包发行。

### 1.2 可行性验证结论（已确认）

| 前提 | 结论 |
|------|------|
| CC SDK 支持自定义 endpoint | ✅ 通过 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` 环境变量，`ccr activate` 机制已验证 |
| claude-code-router 成熟度 | ✅ 35.1k stars / MIT / 默认 `127.0.0.1:3456`，内置 `deepseek`/`chutes-glm`/`enhancetool` transformer |
| 国产模型 tool use 兼容 | ✅ DeepSeek / GLM-4.5 / Kimi-K2 / Qwen3-Coder 已有大量实操教程，部分需 `enhancetool` 增强容错 |
| CCR 与 CC SDK 衔接 | ✅ CCR 实现标准 Anthropic Messages API，SDK 仅需指向其 base url |

---

## 二、整体架构

### 2.1 三层架构

```
┌──────────────────────────────────────────────────────────────┐
│  渲染进程 (app.js)                                            │
│  ai-mode-toggle: [Agent] [LLM] [🧠 CC]                       │
│  设置面板: 网络模式开关 / 模型选择 / CCR 配置                  │
└──────────────────┬───────────────────────────────────────────┘
                   │ IPC (cc:invoke / cc:stop / cc:config / cc:probe-network)
┌──────────────────▼───────────────────────────────────────────┐
│  主进程 (main.js)                                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ ClaudeCodeProvider (AgentProvider 实现)                 │  │
│  │  ├─ NetworkMode 判定: 'direct' | 'router'              │  │
│  │  ├─ RouterManager: 启停/健康检查内嵌 CCR 子进程          │  │
│  │  └─ 环境变量注入: ANTHROPIC_BASE_URL / AUTH_TOKEN       │  │
│  └────────────────────────────────────────────────────────┘  │
│  事件: cc:stream (session/delta/tool_use/tool_result/done)   │
└──────┬───────────────────────────────────┬───────────────────┘
       │ direct 模式                       │ router 模式
       ▼                                   ▼
  Anthropic API                    claude-code-router (内嵌子进程)
  (api.anthropic.com)              127.0.0.1:3456
                                            │
                                            ▼
                              DeepSeek / GLM / Kimi / Qwen
                              (国产模型，零翻墙)
```

### 2.2 网络模式判定与切换

核心是**一个设置开关 + 一次探测**，默认值保证大陆用户开箱即用：

| 模式 | 触发条件 | endpoint | 适用场景 |
|------|----------|----------|----------|
| **router（默认）** | 用户未显式切换 direct，或探测失败 | `http://127.0.0.1:3456` | 大陆用户、国产模型 |
| **direct** | 用户在设置中开启"直连海外"，且探测成功 | `https://api.anthropic.com` | 海外用户、有代理环境 |

**判定流程**（启动时与用户切换时执行）：

```
1. 读取设置 cc_network_mode: 'auto' | 'router' | 'direct'（默认 'auto'）
2. 若 'auto':
     探测 https://api.anthropic.com/v1/messages（HEAD 或轻量请求，3s 超时）
     ├─ 成功 → direct
     └─ 失败 → router
3. 若 'direct': 直接走 Anthropic（探测失败则提示并回退 router）
4. 若 'router': 启动/复用内嵌 CCR，走 127.0.0.1:3456
```

设置面板提供三选一开关（自动/直连/路由），用户可强制指定，避免探测误判。

---

## 三、claude-code-router 内嵌方案

### 3.1 依赖与打包

CCR 是纯 Node.js/TS 包（96.3% TS），可作 npm 依赖内嵌：

```json
// package.json
"dependencies": {
  "@anthropic-ai/claude-agent-sdk": "^0.1.0",
  "@musistudio/claude-code-router": "^1.0.40"
}
"build": {
  "asarUnpack": [
    "node_modules/@anthropic-ai/claude-agent-sdk/**",
    "node_modules/@anthropic-ai/claude-agent-sdk-binary-*/**",
    "node_modules/@musistudio/claude-code-router/**"
  ]
}
```

无需额外 runtime，体积增量约 40–70MB（CC SDK 二进制 + CCR）。

### 3.2 RouterManager（主进程内嵌编排）

新增 `src/scripts/routerManager.js`，负责 CCR 子进程生命周期：

```javascript
// src/scripts/routerManager.js
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class RouterManager {
  constructor() {
    this._proc = null;
    this._port = 3456; // 固定端口，避免与用户已装的 CCR 冲突时可配置
    this._configPath = null;
  }

  /**
   * 生成 CCR 配置文件（~/.memora/ccr-config.json）
   * 路径与用户全局 ~/.claude-code-router/ 隔离，避免污染用户环境
   */
  _generateConfig({ providers, router, proxyUrl }) {
    const configDir = path.join(require('electron').app.getPath('userData'), 'ccr');
    fs.mkdirSync(configDir, { recursive: true });
    const configPath = path.join(configDir, 'config.json');

    const config = {
      HOST: '127.0.0.1',
      LOG: false, // 内嵌模式关闭日志文件，改用 console
      API_TIMEOUT_MS: 120000,
      Providers: providers,  // 用户的国产模型配置
      Router: router,        // 路由规则
    };
    if (proxyUrl) config.PROXY_URL = proxyUrl;

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    this._configPath = configPath;
    return configPath;
  }

  /**
   * 启动 CCR 子进程
   * CCR 支持 CONFIG_FILE 环境变量指定配置路径
   */
  async start({ providers, router, proxyUrl }) {
    if (this._proc && await this.healthCheck()) return true;

    this._generateConfig({ providers, router, proxyUrl });

    // 通过 node 直接 require CCR 入口启动（比 spawn ccr 更可控）
    const ccrEntry = require.resolve('@musistudio/claude-code-router/dist/start');
    this._proc = spawn(process.execPath, [ccrEntry], {
      env: {
        ...process.env,
        CONFIG_FILE: this._configPath,
        PORT: String(this._port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this._proc.stdout.on('data', (d) => console.log('[CCR]', d.toString()));
    this._proc.stderr.on('data', (d) => console.error('[CCR]', d.toString()));
    this._proc.on('exit', (code) => {
      console.log('[CCR] exited with', code);
      this._proc = null;
    });

    // 等待就绪（轮询健康检查）
    for (let i = 0; i < 30; i++) {
      if (await this.healthCheck()) return true;
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('CCR 启动超时');
  }

  async healthCheck() {
    try {
      const res = await fetch(`http://127.0.0.1:${this._port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      return res.ok;
    } catch { return false; }
  }

  async stop() {
    if (this._proc) {
      this._proc.kill('SIGTERM');
      this._proc = null;
    }
  }

  getBaseUrl() { return `http://127.0.0.1:${this._port}`; }
}

module.exports = { RouterManager };
```

### 3.3 默认国产模型配置模板

开箱即用的默认 Provider 模板（用户在设置页可改），覆盖主流国产模型：

```json
{
  "Providers": [
    {
      "name": "deepseek",
      "api_base_url": "https://api.deepseek.com/chat/completions",
      "api_key": "$DEEPSEEK_API_KEY",
      "models": ["deepseek-chat", "deepseek-reasoner"],
      "transformer": { "use": ["deepseek"] }
    },
    {
      "name": "glm",
      "api_base_url": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      "api_key": "$GLM_API_KEY",
      "models": ["glm-4.5", "glm-4.6"],
      "transformer": { "use": ["maxtoken", "enhancetool"], "max_tokens": 16384 }
    },
    {
      "name": "kimi",
      "api_base_url": "https://api.moonshot.cn/v1/chat/completions",
      "api_key": "$KIMI_API_KEY",
      "models": ["kimi-k2-0905-preview"],
      "transformer": { "use": ["maxtoken"], "max_tokens": 16384 }
    },
    {
      "name": "qwen",
      "api_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      "api_key": "$DASHSCOPE_API_KEY",
      "models": ["qwen3-coder-plus"],
      "transformer": { "use": ["maxtoken", "enhancetool"], "max_tokens": 16384 }
    }
  ],
  "Router": {
    "default": "deepseek,deepseek-chat",
    "background": "deepseek,deepseek-chat",
    "think": "deepseek,deepseek-reasoner",
    "longContext": "kimi,kimi-k2-0905-preview",
    "longContextThreshold": 60000
  }
}
```

> `$VAR` 插值由 CCR 支持：API Key 从环境变量读取，避免明文写入配置文件。主进程启动 CCR 时将用户在设置页填入的 Key 注入子进程 env。

---

## 四、ClaudeCodeProvider 实现

### 4.1 核心逻辑（direct / router 双模式）

```javascript
// src/scripts/agentProvider.js
const { query, ClaudeAgentOptions } = require('@anthropic-ai/claude-agent-sdk');
const { RouterManager } = require('./routerManager');

class ClaudeCodeProvider extends AgentProvider {
  constructor() {
    super();
    this._router = new RouterManager();
    this._abort = null;
    this._mode = null; // 'direct' | 'router'
  }

  /**
   * 判定网络模式并准备 endpoint 环境
   */
  async _prepareEndpoint() {
    const setting = getSetting('cc_network_mode') || 'auto';

    if (setting === 'direct' || setting === 'auto') {
      const reachable = await this._probeAnthropic();
      if (reachable) {
        this._mode = 'direct';
        return { baseUrl: undefined, authToken: getSetting('cc_anthropic_api_key') };
        // baseUrl 留空 → SDK 用默认 https://api.anthropic.com
      }
      if (setting === 'direct') {
        throw new Error('直连 Anthropic 失败，请检查网络或切换为路由模式');
      }
    }

    // auto 探测失败 或 显式 router
    this._mode = 'router';
    await this._router.start({
      providers: getSetting('cc_providers') || DEFAULT_PROVIDERS,
      router: getSetting('cc_router') || DEFAULT_ROUTER,
      proxyUrl: getSetting('cc_proxy_url') || null,
    });
    return {
      baseUrl: this._router.getBaseUrl(),
      authToken: 'ccr-internal', // CCR 内嵌模式可不校验 key
    };
  }

  async _probeAnthropic() {
    try {
      await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': getSetting('cc_anthropic_api_key') || '' },
        signal: AbortSignal.timeout(3000),
        body: JSON.stringify({ model: 'claude-3-5-haiku-20241022', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      });
      return true; // 能拿到响应（即使 401）说明网络通
    } catch (e) {
      return e.response?.status ? true : false; // 有 HTTP 响应也算通
    }
  }

  async invoke({ message, attachments, sessionId, systemRole, onEvent }) {
    const { baseUrl, authToken } = await this._prepareEndpoint();

    // 注入环境变量：CC SDK 读取 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN
    const env = { ...process.env };
    if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl;
    if (authToken) env.ANTHROPIC_AUTH_TOKEN = authToken;
    // 注意：SDK 在主进程内运行，process.env 设置对当前进程生效

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
      ...(sessionId ? { resume: sessionId } : {}),
    });

    this._abort = new AbortController();
    let newSessionId = sessionId;

    (async () => {
      try {
        for await (const msg of query({ prompt, options, abortController: this._abort })) {
          if (msg.type === 'system' && msg.subtype === 'init') {
            newSessionId = msg.data?.session_id;
            onEvent({ event: 'session', sessionId: newSessionId });
          } else if (msg.type === 'assistant') {
            for (const block of msg.message?.content || []) {
              if (block.type === 'text') onEvent({ event: 'delta', content: block.text });
              else if (block.type === 'tool_use') onEvent({ event: 'tool_use', name: block.name, input: block.input });
            }
          } else if (msg.type === 'result' && msg.subtype === 'success') {
            onEvent({ event: 'done', sessionId: newSessionId, usage: msg.usage });
          }
        }
        onEvent({ event: 'done', sessionId: newSessionId });
      } catch (e) {
        if (e.name !== 'AbortError') onEvent({ event: 'error', error: e.message });
      }
    })();

    return { success: true, streaming: true, sessionId: newSessionId, mode: this._mode };
  }

  async stop() { this._abort?.abort(); }
  async newSession() { return null; }
  async dispose() { await this._router.stop(); }
}
```

### 4.2 进程生命周期注意点

1. **CCR 子进程随主进程退出**：Electron `app.on('before-quit')` 中调用 `provider.dispose()` 杀掉 CCR，避免僵尸进程。
2. **环境变量作用域**：`process.env.ANTHROPIC_BASE_URL` 设置后对主进程全局生效，若同时有 direct 调用需在每次 invoke 前重置。更稳妥的做法是用 SDK 的 `ClaudeAgentOptions` 显式传 base url（若 SDK 支持），否则用 try/finally 恢复 env。
3. **端口冲突**：默认 3456，若被占用（用户已装 CCR）则探测健康检查成功后复用，不重复启动。

---

## 五、配置与 UI

### 5.1 设置项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `cc_network_mode` | 网络模式：`auto` / `direct` / `router` | `auto` |
| `cc_anthropic_api_key` | 直连模式用的 Anthropic Key | 空 |
| `cc_providers` | CCR Provider 配置（JSON） | 内置 DeepSeek/GLM/Kimi/Qwen 模板 |
| `cc_router` | CCR 路由规则（JSON） | 默认走 DeepSeek |
| `cc_proxy_url` | CCR 上游代理（可选） | 空 |
| `cc_default_model` | 默认国产模型 | `deepseek,deepseek-chat` |
| `cc_allowed_tools` | 允许工具 | `Read,Glob,Grep` |
| `cc_permission_mode` | 权限模式 | `default` |

各国产模型 API Key（DeepSeek/GLM/Kimi/Qwen）在设置页独立输入框，保存时写入 keytar 加密存储，启动 CCR 时注入子进程 env。

### 5.2 UI 设计

**模式切换栏**（`src/index.html`）：
```html
<div class="ai-mode-toggle" id="aiModeToggle">
  <button class="ai-mode-btn active" data-mode="agent">🤖 Agent</button>
  <button class="ai-mode-btn" data-mode="llm">💬 LLM</button>
  <button class="ai-mode-btn" data-mode="cc">🧠 CC</button>
</div>
```

**CC 设置面板**：
```
┌─ 🧠 Claude Code 设置 ─────────────────────────┐
│ 网络模式: ( ) 自动  ( ) 直连海外  (•) 国产路由  │
│ ┌─ 直连配置 ─────────────────────────────┐    │
│ │ Anthropic API Key: [_______________]   │    │
│ │ [测试直连]                             │    │
│ └────────────────────────────────────────┘    │
│ ┌─ 国产路由配置 (claude-code-router) ────┐   │
│ │ 默认模型: [DeepSeek ▼]                 │   │
│ │ DeepSeek Key: [________]  ✓已配置      │   │
│ │ GLM Key:      [________]  ✗未配置      │   │
│ │ Kimi Key:     [________]  ✗未配置      │   │
│ │ Qwen Key:     [________]  ✗未配置      │   │
│ │ [高级:编辑 Provider JSON] [测试路由]   │   │
│ └────────────────────────────────────────┘   │
│ 允许工具: [☑Read ☑Glob ☑Grep ☐Bash]          │
└────────────────────────────────────────────────┘
```

网络模式切换时，面板动态显示对应配置区。状态栏显示当前生效模式（如"🧠 CC · 国产路由 · DeepSeek"）。

---

## 六、IPC 与事件流

### 6.1 新增 IPC

```javascript
// preload.js
ccInvoke: (data) => ipcRenderer.invoke('cc:invoke', data),
ccStop: () => ipcRenderer.invoke('cc:stop'),
ccNewSession: () => ipcRenderer.invoke('cc:new-session'),
ccProbeNetwork: () => ipcRenderer.invoke('cc:probe-network'),  // 手动触发探测
ccTestDirect: (apiKey) => ipcRenderer.invoke('cc:test-direct', apiKey),
ccTestRouter: () => ipcRenderer.invoke('cc:test-router'),
ccGetConfig: () => ipcRenderer.invoke('cc:get-config'),
ccSetConfig: (config) => ipcRenderer.invoke('cc:set-config', config),
onCCStream: (callback) => ipcRenderer.on('cc:stream', (_, data) => callback(data)),
removeCCListeners: () => ipcRenderer.removeAllListeners('cc:stream'),
```

### 6.2 `cc:stream` 事件契约（与现有 agent:stream 同构）

| event | payload | 复用前端处理 |
|-------|---------|--------------|
| `session` | `{ sessionId }` | 存入 `_chatSessions.ccSessionId` |
| `delta` | `{ content }` | 追加文本气泡 |
| `tool_use` | `{ name, input }` | 渲染工具步骤 |
| `tool_result` | `{ content }` | 工具结果展示 |
| `done` | `{ sessionId, usage }` | 结束流式、审计 |
| `error` | `{ error }` | 错误提示 |

### 6.3 `app.js` sendAIMessage 分支

```javascript
if (this._aiAssistantMode === 'cc') {
  const ccResult = await window.electronAPI.ccInvoke({
    message, attachments: attachmentData,
    sessionId: activeSession?.ccSessionId,
    systemRole: localContextSystemRole,
  });
  if (ccResult.success && ccResult.streaming) {
    // 更新状态栏显示当前模式
    this._updateCCStatusBar(ccResult.mode);
    await new Promise((resolve) => {
      this._ccStreamResolve = resolve;
      window.electronAPI.onCCStream((evt) => this._handleCCStreamEvent(evt, assistantMessage));
    });
  } else {
    throw new Error(ccResult.error);
  }
}
```

---

## 七、打包与发行

### 7.1 依赖打包

```json
"build": {
  "asarUnpack": [
    "node_modules/@anthropic-ai/claude-agent-sdk/**",
    "node_modules/@anthropic-ai/claude-agent-sdk-binary-*/**",
    "node_modules/@musistudio/claude-code-router/**",
    "node_modules/@musistudio/claude-code-router/dist/**"
  ]
}
```

要点：
- CC SDK 原生二进制 + CCR 的 dist 都需 `asarUnpack`，运行时要直接执行/require；
- CCR 的 transformer 插件（如 `enhancetool`）是动态加载，确保打包后路径可解析；
- 跨平台构建各平台二进制自动选择；
- **无需 Python runtime**，体积增量约 40–70MB。

### 7.2 首次启动引导

```
首次使用 CC 模式:
1. 网络探测中...
2. 检测到大陆网络环境 → 推荐国产路由模式
3. 引导配置至少一个国产模型 API Key（DeepSeek 优先，免费额度多）
4. 自动启动内嵌 CCR，测试连通性
5. 进入对话
```

### 7.3 签名与权限

- macOS：CCR 子进程无特殊权限需求，正常签名即可；
- Windows：需确保防火墙允许 127.0.0.1:3456 本地回环（通常默认允许）；
- CCR 出站请求到国产模型 API（api.deepseek.com 等）走 HTTPS，无额外证书需求。

---

## 八、实施阶段

### Phase 0：可行性验证（0.5 天）
1. 本地 `npm install @anthropic-ai/claude-agent-sdk @musistudio/claude-code-router`；
2. 手动配置 CCR 指向 DeepSeek，CC SDK 指向 CCR，跑通一次工具调用；
3. 确认 SDK 流式消息字段名（对照 d.ts）；
4. 验证 `enhancetool` transformer 对国产模型工具调用的修复效果。

### Phase 1：RouterManager + 网络探测（1.5 天）
1. 实现 `RouterManager`：配置生成、子进程启停、健康检查；
2. 实现网络探测（`_probeAnthropic`）与三模式切换；
3. IPC `cc:probe-network` / `cc:test-direct` / `cc:test-router`；
4. 设置页网络模式开关 + 探测结果展示。

### Phase 2：ClaudeCodeProvider + 基础对话（1.5 天）
1. 实现 `ClaudeCodeProvider.invoke`，env 注入与恢复；
2. `cc:invoke` / `cc:stop` IPC；
3. `app.js` cc 分支 + `_handleCCStreamEvent`；
4. 纯文本流式对话跑通（router 模式）。

### Phase 3：会话持久化 + 国产模型配置 UI（1 天）
1. `ccSessionId` 映射到 `_chatSessions`，resume；
2. 设置页国产模型 Key 输入、Provider JSON 编辑；
3. 模型选择下拉（default model）。

### Phase 4：直连模式 + 附件/工具展示（1.5 天）
1. direct 模式 env 切换、探测回退；
2. 文本附件拼入 prompt；图片附件落盘 Read；
3. `tool_use`/`tool_result` 渲染（复用 ADP progress steps 样式）；
4. 审计日志接入。

### Phase 5：打包验证（1 天）
1. `electron-builder` 配置 `asarUnpack`；
2. mac/win 构建，验证 CCR 子进程 + CC 二进制可执行；
3. 首次启动引导流程；
4. 端口冲突处理（用户已装 CCR 时复用）。

**预计总工作量：7 天**。

---

## 九、风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| 国产模型 tool use 不稳定 | 工具循环失败 | 默认开启 `enhancetool` transformer；DeepSeek 工具调用最稳定，设为默认 |
| CCR 版本升级 API 变更 | RouterManager 失效 | 锁版本 + 冒烟测试；CCR 配置格式稳定，低风险 |
| CC SDK 不支持显式传 base url | 只能走 env | env 注入 + try/finally 恢复；或等 SDK 暴露 option |
| 内嵌 CCR 与用户已装 CCR 端口冲突 | 启动失败 | 健康检查成功则复用；失败则自动换端口 |
| Anthropic 探测误判（如代理偶通） | 模式跳变 | 提供"锁定模式"选项，用户可强制 router/direct 不自动 |
| 国产模型 API Key 泄露 | 安全 | keytar 加密存储，不写入 CCR 配置明文，env 注入 |
| CCR 子进程僵尸 | 资源泄漏 | `before-quit` 清理 + 健康检查重启 |

**回退**：CC 模式独立分支，失败不影响 Agent/LLM；用户可随时切回。若 CCR 长期不可用，移除 router 分支保留 direct（海外用户仍可用）。

---

## 十、与 v1 方案的差异

| 维度 | v1 (cc-ha-agent-integration.md) | v2 (本文) |
|------|--------------------------------|-----------|
| 默认网络 | 假设可直连 Anthropic | 默认国产路由，直连为可选 |
| 模型 | 锁定 Claude | Claude + DeepSeek/GLM/Kimi/Qwen |
| 新增组件 | 仅 CC SDK | CC SDK + claude-code-router |
| 网络判定 | 无 | auto/direct/router 三模式 + 探测 |
| 大陆可用性 | ❌ 需翻墙 | ✅ 开箱即用 |
| 复杂度 | 中 | 中高（多 RouterManager） |
| 打包体积 | +30–60MB | +40–70MB |

v1 的 AgentProvider 抽象层、事件流契约、UI 模式切换骨架在 v2 完全保留，v2 是 v1 的超集。

---

## 十一、总结

本方案让大陆用户**开箱即用** CC 模式（默认国产路由），海外/有代理用户可一键切直连享受原生 Claude。通过内嵌 claude-code-router 作为本地 Anthropic API 代理，将 CC SDK 的工具循环能力桥接到 DeepSeek/GLM/Kimi/Qwen，兼顾能力与可用性。

**关键设计决策**：
1. **网络探测 + 三模式开关**：auto 默认安全，用户可强制锁定；
2. **CCR 内嵌而非要求预装**：降低用户门槛，配置隔离不污染全局；
3. **国产模型默认 DeepSeek**：工具调用最稳定，免费额度充足；
4. **AgentProvider 抽象**：未来切 HA 或其他后端零 UI 改动；
5. **双模式对上层透明**：`cc:stream` 事件契约统一，前端不感知 direct/router 差异。

---

## 十二、实施记录（2026-06-19）

### 12.1 实际选型：火山引擎 Coding Plan（原生 Anthropic 兼容）

开发阶段确认火山引擎 Coding Plan 提供**原生 Anthropic 兼容 endpoint**，无需 claude-code-router 转换层：

| 配置项 | 值 |
|--------|------|
| Base URL | `https://ark.cn-beijing.volces.com/api/coding` |
| 模型 | `ark-code-latest`（实际模型在火山控制台切换） |
| 认证 | `ANTHROPIC_AUTH_TOKEN`（火山 API Key，ark- 开头） |
| 支持模型 | DeepSeek-V3.2 / GLM-4.7 / Kimi-K2.5 / Doubao-Seed-Code |

**相比原方案的简化**：
- 移除 RouterManager / 网络探测 / 三模式开关（火山引擎国内直连，无需探测）
- 移除 claude-code-router 依赖（火山引擎原生兼容 Anthropic API）
- CC SDK 通过 `options.env` 注入 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_MODEL` 即可

### 12.2 已完成代码改动

| 文件 | 改动 |
|------|------|
| `package.json` | 添加 `@anthropic-ai/claude-agent-sdk` 依赖 + `asarUnpack` 配置 |
| `preload.js` | 暴露 `ccInvoke`/`ccStop`/`ccNewSession`/`ccTestConnection`/`ccGetConfig`/`ccSetConfig`/`onCCStream`/`removeCCListeners` |
| `main.js` | CC SDK require + `DEFAULT_CC_CONFIG`（火山引擎默认值 + 用户 API Key）+ `getCCConfig()` + 6 个 CC IPC handlers + 流式调用逻辑 |
| `src/index.html` | CC 模式按钮 + CC 设置 tab + CC 配置面板（Token/BaseURL/Model/工具/权限/轮次/测试连接） |
| `src/scripts/app.js` | CC 模式事件绑定 + `sendAIMessage` cc 分支 + `_handleCCStreamEvent`/`_renderCCStream`/`_addCCProgressStep`/`_finishCCMessage` + `_loadCCConfig`/`_testCCConnection` + `saveSettings` 扩展 + `stopADPGeneration` 扩展 + `createNewChatSession` 扩展 |
| `src/styles/main.css` | `.agent-badge-cc` + `.cc-stream-text` 样式 |

### 12.3 CC 模式工作流

```
用户切换到 CC 模式 → sendAIMessage 判定 _aiAssistantMode === 'cc'
  → ccInvoke({ message, attachments, sessionId, systemRole })
    → main.js: getCCConfig() 读取火山引擎配置
    → CC SDK query({ prompt, options: { env: { ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_MODEL }, resume: sessionId } })
    → async for msg of stream:
        system(init) → cc:stream { event: 'session', sessionId }
        stream_event(content_block_delta text_delta) → cc:stream { event: 'delta', content }
        stream_event(content_block_start tool_use) → cc:stream { event: 'tool_use', name }
        assistant(tool_use) → cc:stream { event: 'tool_result' }
        result(success) → cc:stream { event: 'done', sessionId, usage }
  → 前端 _handleCCStreamEvent 渲染（复用 ADP 进度步骤 + Agent 流式文本渲染）
  → _finishCCMessage 最终渲染 markdown + 复制按钮 + 时间戳
```

### 12.4 会话持久化

CC 会话通过 `ccSessionId` 映射到 `_chatSessions`（同 ADP `conversationId` 模式）：
- 首次调用：SDK 返回 `session_id`，保存到 `session.ccSessionId`
- 后续调用：传入 `ccSessionId` 作为 `resume`，SDK 恢复完整上下文
- 新建对话：调用 `ccNewSession` IPC 重置

### 12.5 未来扩展

保留 CCR 方案作为多 provider 扩展路径：
- 若需支持非火山引擎的国产模型（如直连 DeepSeek/GLM API），可新增 CCR 内嵌模式
- 通过设置开关在「火山引擎直连」和「CCR 多 provider」间切换
- `cc:stream` 事件契约不变，前端零改动
