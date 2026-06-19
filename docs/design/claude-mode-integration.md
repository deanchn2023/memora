# Claude 模式对接方案

## 一、背景与目标

### 当前架构
Memora v2.6.0 已支持两种 AI 模式：
- **Agent 模式**：使用 ADP 智能体（工具调用、多步推理、SSE 流式）
- **LLM 模式**：使用本地配置的大模型 API（DeepSeek/OpenAI 等）

### 目标
新增 **Claude 模式**，对接本地 Claude API（Anthropic Claude），支持：
1. Claude 3.5 Sonnet / Claude 3 Opus 等模型
2. 流式输出（SSE）
3. 与现有 Agent/LLM 模式无缝切换

---

## 二、架构设计

### 2.1 模式切换 UI

**位置**：AI 对话区顶部模式切换栏

```
[🤖 Agent] [💬 LLM] [🧠 Claude]  ← 新增 Claude 按钮
```

**实现**：
- `src/index.html` 新增 `<button class="ai-mode-btn" data-mode="claude" id="aiModeClaude">🧠 Claude</button>`
- `src/scripts/app.js` 新增 `_initClaudeMode()` 和 `_setGlobalAIMode('claude')`

### 2.2 配置存储

**新增 Claude 配置项**（存储在 localStorage / 云端同步）：

| 配置项 | 说明 | 示例值 |
|--------|------|--------|
| `claude_base_url` | Claude API 地址 | `https://api.anthropic.com` |
| `claude_api_key` | Claude API Key | `sk-ant-xxx...` |
| `claude_model` | 模型名称 | `claude-3-5-sonnet-20241022` |

**配置面板**（设置页面新增 Claude 配置区块）：

```html
<div class="claude-config-section">
  <h4>🧠 Claude 配置</h4>
  <input id="claudeBaseUrl" placeholder="https://api.anthropic.com">
  <input id="claudeApiKey" type="password" placeholder="Claude API Key">
  <select id="claudeModel">
    <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet（推荐）</option>
    <option value="claude-3-opus-20240229">Claude 3 Opus（最强）</option>
    <option value="claude-3-haiku-20240307">Claude 3 Haiku（快速）</option>
  </select>
  <button id="testClaudeConnection">测试连接</button>
</div>
```

### 2.3 调用路由逻辑

**main.js 新增函数**：

```javascript
// 获取 Claude 配置
function getClaudeConfig() {
  return {
    baseUrl: getSetting('claude_base_url') || 'https://api.anthropic.com',
    apiKey: getSetting('claude_api_key'),
    model: getSetting('claude_model') || 'claude-3-5-sonnet-20241022'
  };
}

// Claude 流式调用
async function callClaudeStream({ messages, systemPrompt, onEvent }) {
  const config = getClaudeConfig();
  if (!config.apiKey) throw new Error('Claude API Key 未配置');

  // Claude API 格式转换
  const claudeMessages = messages.map(m => ({
    role: m.role === 'system' ? 'system' : m.role,
    content: m.content
  }));

  const response = await fetch(`${config.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: claudeMessages.filter(m => m.role !== 'system'),
      stream: true
    })
  });

  // SSE 流式处理
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));
        onEvent(data);
      }
    }
  }
}
```

---

## 三、Claude API 格式差异

### 3.1 请求格式对比

| 项目 | OpenAI/DeepSeek | Claude (Anthropic) |
|------|-----------------|-------------------|
| **认证方式** | `Authorization: Bearer {key}` | `x-api-key: {key}` |
| **版本头** | 无 | `anthropic-version: 2023-06-01` |
| **System Prompt** | messages 数组中 role=system | 独立 `system` 字段 |
| **Max Tokens** | 可选 | **必须指定** |
| **流式格式** | `data: {"choices":[{"delta":{"content":"..."}}]}` | `data: {"type":"content_block_delta","delta":{"text":"..."}}` |

### 3.2 SSE 事件类型

**Claude SSE 事件类型**：
- `message_start`：消息开始
- `content_block_start`：内容块开始
- `content_block_delta`：内容增量（主要文本）
- `content_block_stop`：内容块结束
- `message_delta`：消息元数据更新
- `message_stop`：消息结束

**转换逻辑**：

```javascript
function handleClaudeSSE(data) {
  switch (data.type) {
    case 'content_block_delta':
      // 文本增量
      return { event: 'text_delta', text: data.delta?.text || '' };
    case 'message_stop':
      // 流结束
      return { event: 'done' };
    case 'message_start':
      // 消息开始（可获取 usage）
      return { event: 'start', usage: data.message?.usage };
    default:
      return null;
  }
}
```

---

## 四、实现步骤

### 4.1 Phase 1：配置层（1-2小时）

1. **main.js**
   - 新增 `getClaudeConfig()` 函数
   - 新增 Claude 配置存储/读取逻辑
   - 新增 `test-claude-connection` IPC handler

2. **preload.js**
   - 新增 `getClaudeConfig`、`saveClaudeConfig`、`testClaudeConnection` API

3. **src/scripts/app.js**
   - 新增 Claude 配置面板渲染逻辑
   - 新增配置保存事件绑定

### 4.2 Phase 2：调用层（2-3小时）

1. **main.js**
   - 新增 `callClaudeStream()` 函数
   - 新增 `sendClaudeMessage` IPC handler
   - 实现 Claude SSE 事件转换

2. **preload.js**
   - 新增 `sendClaudeMessage`、`onClaudeSSEEvent` API

3. **src/scripts/app.js**
   - `sendAIMessage()` 新增 Claude 模式分支
   - 新增 `_handleClaudeSSEEvent()` 处理函数

### 4.3 Phase 3：UI层（1小时）

1. **src/index.html**
   - 新增 Claude 模式按钮
   - 新增 Claude 配置区块

2. **src/styles/main.css**
   - 新增 Claude 模式样式

---

## 五、代码改动清单

### 5.1 main.js

```diff
+ // Claude 配置获取
+ function getClaudeConfig() { ... }

+ // Claude 流式调用
+ async function callClaudeStream({ messages, systemPrompt, onEvent }) { ... }

+ // IPC: 获取 Claude 配置
+ ipcMain.handle('get-claude-config', ...)

+ // IPC: 保存 Claude 配置
+ ipcMain.handle('save-claude-config', ...)

+ // IPC: 测试 Claude 连接
+ ipcMain.handle('test-claude-connection', ...)

+ // IPC: 发送 Claude 消息（流式）
+ ipcMain.handle('send-claude-message', ...)
```

### 5.2 preload.js

```diff
+ getClaudeConfig: () => ipcRenderer.invoke('get-claude-config'),
+ saveClaudeConfig: (config) => ipcRenderer.invoke('save-claude-config', config),
+ testClaudeConnection: (params) => ipcRenderer.invoke('test-claude-connection', params),
+ sendClaudeMessage: (data) => ipcRenderer.invoke('send-claude-message', data),
+ onClaudeSSEEvent: (callback) => ipcRenderer.on('claude:sse-event', callback),
+ removeClaudeListeners: () => ipcRenderer.removeAllListeners('claude:sse-event'),
```

### 5.3 src/scripts/app.js

```diff
+ // Claude 配置面板渲染
+ async _loadClaudeConfig() { ... }

+ // Claude 模式切换
+ document.getElementById('aiModeClaude')?.addEventListener('click', ...)

+ // sendAIMessage 新增 Claude 分支
+ if (this._aiAssistantMode === 'claude') {
+   // Claude 流式调用
+   result = await window.electronAPI.sendClaudeMessage({ ... });
+ }

+ // Claude SSE 事件处理
+ _handleClaudeSSEEvent(evt, messageEl) { ... }
```

### 5.4 src/index.html

```diff
+ <button class="ai-mode-btn" data-mode="claude" id="aiModeClaude">🧠 Claude</button>

+ <!-- Claude 配置区块 -->
+ <div class="config-section claude-config-section">
+   ...
+ </div>
```

---

## 六、云端同步扩展

### 6.1 登录状态下的 Claude 配置同步

**服务器端新增字段**（config-server/server.js）：

```javascript
{
  api: {
    base_url: "...",
    api_key: "...",
    model: "...",
    // 新增 Claude 配置
    claude_base_url: "https://api.anthropic.com",
    claude_api_key: "sk-ant-xxx",
    claude_model: "claude-3-5-sonnet-20241022"
  }
}
```

### 6.2 配置优先级

```
云端配置 > 本地配置 > 默认配置
```

---

## 七、测试验证

### 7.1 连接测试

```javascript
// 测试 Claude API 连通性
await window.electronAPI.testClaudeConnection({
  baseUrl: 'https://api.anthropic.com',
  apiKey: 'sk-ant-xxx',
  model: 'claude-3-5-sonnet-20241022'
});
```

### 7.2 流式输出测试

1. 切换到 Claude 模式
2. 发送消息："你好，请介绍一下你自己"
3. 验证流式输出是否正常显示

### 7.3 模式切换测试

1. Agent → Claude → LLM 循环切换
2. 验证每种模式都能正常工作

---

## 八、注意事项

### 8.1 Claude API 特殊要求

1. **必须指定 max_tokens**：Claude API 强制要求，建议默认 4096
2. **System Prompt 独立字段**：不能放在 messages 数组中
3. **版本头必须**：`anthropic-version: 2023-06-01`
4. **不支持 function calling**：Claude 3.5 Sonnet 支持 tool use，但格式与 OpenAI 不同

### 8.2 错误处理

- API Key 无效：显示"Claude API Key 未配置或无效"
- 网络错误：显示"Claude API 连接失败"
- Token 超限：显示"Claude API Token 限制超出"

### 8.3 费用提示

Claude 3.5 Sonnet 价格：
- Input: $3 / million tokens
- Output: $15 / million tokens

建议在配置面板显示费用提示。

---

## 九、扩展方向

### 9.1 Claude Tool Use（未来）

Claude 3.5 Sonnet 支持 tool use，未来可扩展：
- 工具调用（类似 Agent 模式）
- 多步推理
- 文件处理

### 9.2 Claude Vision

Claude 3.5 Sonnet 支持图片输入：
- 可复用现有图片附件逻辑
- 转换为 Claude 图片格式 `{ type: "image", source: { ... } }`

---

## 十、总结

| 项目 | 工作量 | 风险 |
|------|--------|------|
| 配置层 | 1-2小时 | 低 |
| 调用层 | 2-3小时 | 中（SSE 格式差异） |
| UI层 | 1小时 | 低 |
| **总计** | **4-6小时** | **中** |

**建议**：先实现基础 Claude 对话功能，后续再扩展 tool use 和 vision。