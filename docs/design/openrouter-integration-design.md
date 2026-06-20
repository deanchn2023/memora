# OpenRouter 集成设计方案

## 1. 背景与目标

在 M-Agent 模式下，当前仅支持 Coding Plan（Anthropic 兼容 API）。用户希望能在对话中灵活切换到 OpenRouter 上的模型，利用 OpenRouter 的多模型聚合能力（Claude、GPT、Gemini、DeepSeek、Llama 等），无需修改全局配置。

### 核心需求
- M-Agent 对话输入框上方增加 OpenRouter 模型选择器
- 不选择时默认使用设置中的 M-Agent 配置模型（Coding Plan）
- 选择 OpenRouter 模型时，使用该模型进行对话
- OpenRouter API Key 等配置项放在 M-Agent 设置面板中

## 2. OpenRouter API 概要

| 项目 | 值 |
|------|-----|
| Chat Completions | `POST https://openrouter.ai/api/v1/chat/completions` |
| 模型列表 | `GET https://openrouter.ai/api/v1/models` |
| 认证方式 | `Authorization: Bearer <OPENROUTER_API_KEY>` (Header) |
| 请求格式 | OpenAI 兼容 JSON |
| 流式支持 | `stream: true` (SSE) |
| 可选 Header | `HTTP-Referer`, `X-OpenRouter-Title` (应用归因) |

## 3. 架构设计

### 3.1 两种执行路径

```
用户发送消息
    │
    ├─ 未选 OpenRouter 模型 → cc:invoke（现有路径）
    │   └─ Claude Code Agent SDK → Coding Plan 服务
    │       （Anthropic API 格式，完整工具链：Read/Write/Edit/Bash/Grep/Glob/WebSearch）
    │
    └─ 选择了 OpenRouter 模型 → openrouter:invoke（新增路径）
        └─ 自建 Agent Loop → OpenRouter API
            （OpenAI API 格式，本地实现工具调用循环）
```

### 3.2 为什么不能直接用 CC SDK？

Claude Code Agent SDK 绑定 Anthropic API 格式（`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`）。OpenRouter 使用 OpenAI 兼容格式，无法直接替换。因此选择 OpenRouter 模型时，走独立的 Agent Loop 实现。

### 3.3 Agent Loop 设计（openrouter:invoke）

```
1. 构建消息列表（system + 历史 + 用户消息）
2. POST /v1/chat/completions (stream: true)
   ├─ tools 参数：声明可用工具（function calling）
   ├─ model 参数：用户选择的 OpenRouter 模型 slug
   └─ Authorization: Bearer <API Key>
3. 解析 SSE 流
   ├─ text delta → 流式推送到前端（cc:stream 事件，复用现有渲染）
   └─ tool_calls → 执行工具 → 将结果追加到消息 → 回到步骤 2
4. 无 tool_calls 或达到 maxTurns → 结束
```

### 3.4 工具定义（function calling）

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `Read` | 读取文件 | `{ path: string }` |
| `Write` | 写入文件 | `{ path: string, content: string }` |
| `Edit` | 编辑文件（替换） | `{ path: string, old_str: string, new_str: string }` |
| `Bash` | 执行终端命令 | `{ command: string }` |
| `Glob` | 搜索文件 | `{ pattern: string, path?: string }` |
| `Grep` | 搜索文件内容 | `{ pattern: string, path?: string }` |
| `WebSearch` | 网络搜索 | `{ query: string }` |

工具执行受 `permissionMode` 和 `allowedTools` 控制（与 CC SDK 模式一致的权限模型）。

## 4. UI 变更

### 4.1 对话输入框区域（ccWorkdirBar 内新增）

在现有的 cc-workdir-bar 中，连接器后面新增 OpenRouter 模型选择器：

```html
<!-- 在 ccConnectorManageBtn 和 ccRestartBtn 之间插入 -->
<span class="cc-openrouter-label">🌐 模型:</span>
<select class="cc-openrouter-select" id="ccOpenRouterSelect" title="选择 OpenRouter 模型（留空使用默认配置）">
  <option value="">默认（Coding Plan）</option>
  <!-- 动态填充 -->
</select>
<button class="cc-openrouter-refresh-btn" id="ccOpenRouterRefreshBtn" title="刷新模型列表">🔄</button>
```

**交互逻辑：**
- 仅 M-Agent 模式显示（随 ccWorkdirBar 一起显隐）
- 首次展开时自动拉取 OpenRouter 模型列表
- 选择模型后，该会话内后续消息都走 OpenRouter
- 切换会话时重置为"默认"
- 模型列表缓存在本地（1小时过期），避免每次展开都请求

### 4.2 M-Agent 设置面板新增 OpenRouter 配置区

在现有 M-Agent 设置面板（ccPanel）末尾，新增一个分隔区块：

```html
<!-- OpenRouter 配置 -->
<hr style="margin: 20px 0; border: none; border-top: 1px solid var(--border-color);">
<h4 class="settings-section-title">🌐 OpenRouter（多模型聚合）</h4>
<small style="color: var(--text-secondary); display: block; margin-bottom: 8px;">
  OpenRouter 提供数百种 AI 模型的统一 API 访问。配置 API Key 后，
  可在 M-Agent 对话中通过模型选择器切换使用不同模型。
  与 Coding Plan 配置互斥：对话时选了 OpenRouter 模型则走 OpenRouter 路径。
</small>

<div class="form-group">
  <label for="ccOpenRouterApiKey">OpenRouter API Key</label>
  <input type="password" id="ccOpenRouterApiKey" placeholder="sk-or-v1-xxxxxxxx">
  <small style="color: var(--text-secondary); margin-top: 4px; display: block;">
    从 <a href="https://openrouter.ai/keys" target="_blank">openrouter.ai/keys</a> 获取。
  </small>
</div>

<div class="form-group">
  <label for="ccOpenRouterBaseUrl">Base URL（可选，默认官方地址）</label>
  <input type="text" id="ccOpenRouterBaseUrl" placeholder="https://openrouter.ai/api/v1">
</div>

<div class="form-group">
  <label for="ccOpenRouterDefaultModel">默认模型（可选）</label>
  <input type="text" id="ccOpenRouterDefaultModel" placeholder="anthropic/claude-sonnet-4">
  <small style="color: var(--text-secondary); margin-top: 4px; display: block;">
    设置后在对话模型选择器中默认选中此模型。留空则默认使用 Coding Plan 配置。
  </small>
</div>

<button class="btn secondary" id="testOpenRouterBtn" style="margin-bottom: 12px;">🔗 测试连接</button>
<span id="testOpenRouterResult" style="margin-left: 8px; font-size: 13px;"></span>
```

## 5. 后端变更（main.js）

### 5.1 新增配置存储

复用现有 `setSetting/getSetting` 机制：

| Key | 默认值 | 说明 |
|-----|--------|------|
| `cc_openrouter_api_key` | `''` | OpenRouter API Key |
| `cc_openrouter_base_url` | `'https://openrouter.ai/api/v1'` | OpenRouter API 地址 |
| `cc_openrouter_default_model` | `''` | 默认模型 slug |

### 5.2 新增 IPC 通道

| 通道 | 方向 | 说明 |
|------|------|------|
| `cc:openrouter-get-models` | renderer → main | 获取模型列表（带本地缓存） |
| `cc:openrouter-test` | renderer → main | 测试 OpenRouter 连接 |
| `cc:openrouter-invoke` | renderer → main | 启动 OpenRouter Agent Loop |
| `cc:openrouter-stop` | renderer → main | 停止当前 OpenRouter 会话 |
| `cc:stream` (复用) | main → renderer | 流式推送消息（复用现有事件格式） |

### 5.3 openrouter-invoke 实现要点

```javascript
ipcMain.handle('cc:openrouter-invoke', async (event, { 
  message, attachments, sessionId, systemRole, workdir, 
  openRouterModel,  // 用户选择的模型 slug
  skill, connectorIds 
}) => {
  const apiKey = getSetting('cc_openrouter_api_key');
  const baseUrl = getSetting('cc_openrouter_base_url') || 'https://openrouter.ai/api/v1';
  
  if (!apiKey) {
    return { success: false, error: 'OpenRouter API Key 未配置' };
  }

  const config = getCCConfig();
  const ccWorkdir = workdir || config.defaultWorkdir;
  
  // 构建工具列表（受 allowedTools + permissionMode 控制）
  const tools = buildOpenRouterTools(config);
  
  // 构建 system prompt（复用 CLAUDE.md + systemRole）
  const systemPrompt = await buildSystemPrompt(ccWorkdir, systemRole);
  
  // Agent Loop
  let messages = [{ role: 'system', content: systemPrompt }];
  // ... 加入历史消息和用户消息
  
  for (let turn = 0; turn < config.maxTurns; turn++) {
    // 调用 OpenRouter API（stream）
    const response = await callOpenRouter({
      baseUrl, apiKey, model: openRouterModel,
      messages, tools, stream: true
    });
    
    // 解析响应：文本 + tool_calls
    // 文本 → 通过 cc:stream 推送到前端
    // tool_calls → 执行工具 → 追加结果到 messages → 继续循环
    // 无 tool_calls → 结束
  }
});
```

### 5.4 SSE 流式推送格式（复用 cc:stream）

OpenRouter 的 SSE 事件映射到现有 cc:stream 格式：

| OpenRouter SSE | cc:stream 事件 | 说明 |
|----------------|----------------|------|
| `delta.content` | `{ event: 'text', content: '...' }` | 文本增量 |
| `delta.tool_calls` | `{ event: 'tool_use', name: '...', input: {...} }` | 工具调用 |
| `finish_reason: 'stop'` | `{ event: 'done' }` | 完成 |
| `finish_reason: 'tool_calls'` | 继续循环 | 工具调用完成，需要执行后继续 |
| error | `{ event: 'error', content: '...' }` | 错误 |

前端 `_handleCCStreamEvent` 无需修改，因为事件格式保持一致。

## 6. 前端变更（app.js）

### 6.1 模型选择器初始化

```javascript
// 在 showAIAssistantView 或 _updateCCWorkdirBar 中
async _initOpenRouterModelSelector() {
  const select = document.getElementById('ccOpenRouterSelect');
  if (!select || select.dataset.loaded === 'true') return;
  
  const result = await window.electronAPI?.ccOpenRouterGetModels?.();
  if (result?.success && result.models) {
    // 按提供商分组
    result.models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;  // e.g. "anthropic/claude-sonnet-4"
      opt.textContent = `${m.id} ${m.pricing ? `($${m.pricing.prompt}/1M)` : ''}`;
      select.appendChild(opt);
    });
    select.dataset.loaded = 'true';
  }
}
```

### 6.2 发送消息时传递模型

在现有 `_sendMessage` 中，CC 模式分支增加：

```javascript
const openRouterModel = document.getElementById('ccOpenRouterSelect')?.value;
if (openRouterModel) {
  // 走 OpenRouter 路径
  result = await window.electronAPI.ccOpenRouterInvoke({
    message, attachments, sessionId, systemRole,
    workdir: this._ccCurrentWorkdir,
    openRouterModel,
    skill: selectedSkill,
    connectorIds: selectedConnectors,
  });
} else {
  // 走现有 CC SDK 路径
  result = await window.electronAPI.ccInvoke({ ... });
}
```

### 6.3 会话切换时重置模型选择

```javascript
// 在 _switchToSession 中
const orSelect = document.getElementById('ccOpenRouterSelect');
if (orSelect) orSelect.value = '';
```

## 7. preload.js 新增

```javascript
ccOpenRouterGetModels: () => ipcRenderer.invoke('cc:openrouter-get-models'),
ccOpenRouterTest: (params) => ipcRenderer.invoke('cc:openrouter-test', params),
ccOpenRouterInvoke: (params) => ipcRenderer.invoke('cc:openrouter-invoke', params),
ccOpenRouterStop: () => ipcRenderer.invoke('cc:openrouter-stop'),
```

## 8. 模型列表缓存策略

- 首次请求 `GET /api/v1/models`，结果缓存到本地文件 `userData/openrouter-models-cache.json`
- 缓存有效期 1 小时
- 用户可点 🔄 按钮强制刷新
- 缓存格式：`{ models: [...], fetchedAt: timestamp }`
- 模型列表可能很长（数百个），前端用搜索框过滤

## 9. 注意事项与限制

1. **OpenRouter 不支持 Skill**：Skill 是 CC SDK 特有功能，OpenRouter 路径下 Skill 选择器禁用或提示"OpenRouter 模式不支持 Skill"
2. **OpenRouter 不支持 MCP 连接器**：同上，连接器选择器禁用
3. **工具能力可能受限**：部分 OpenRouter 模型不支持 function calling，此时退化为纯对话模式（无工具调用）
4. **费用提示**：OpenRouter 按量计费，不同模型价格差异大，UI 上展示模型价格提示
5. **CLAUDE.md 记忆**：OpenRouter 路径同样读取 CLAUDE.md 作为 system prompt 注入
6. **权限模式**：OpenRouter 路径复用 M-Agent 设置的 `permissionMode` 和 `allowedTools` 控制工具执行权限

## 10. 开发计划

| 阶段 | 内容 | 预估工时 |
|------|------|----------|
| P1 | 设置面板：OpenRouter 配置区 + IPC | 1h |
| P2 | 模型列表获取 + 缓存 + 前端选择器 | 1h |
| P3 | openrouter-invoke Agent Loop 实现 | 3h |
| P4 | 工具执行（Read/Write/Edit/Bash/Grep/Glob/WebSearch） | 2h |
| P5 | 前端集成：消息发送分支 + 模型选择交互 | 1h |
| P6 | 测试 + 边界处理 | 1h |
| **合计** | | **~9h** |
