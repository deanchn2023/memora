# 火山引擎方舟 Agent Plan 对接方案

> 文档创建：2026-06-21  
> 状态：设计中（用户尚未购买 Agent Plan 套餐，先完成代码对接，购买后可直接使用）  
> 关联文档：[CC HA Agent 集成方案 v2](./cc-ha-agent-integration-v2.md)、[OpenRouter 代理方案](./openrouter-proxy-vs-agentloop-design.md)

---

## 一、背景与目标

### 1.1 现状

Memora CC（M-Agent）模式当前使用火山引擎 **Coding Plan**，仅支持文本类模型（Doubao-Seed-Code / DeepSeek-V3.2 等），在以下场景受限：

- **无法理解图片**：用户粘贴 UI 截图、设计稿，CC 只能看文本描述
- **无法联网搜索**：Coding Plan 不含搜索 Harness，CC 的 WebSearch 工具走的是 SDK 内置搜索
- **无法生成多媒体**：需要图片/视频生成时必须切到其他平台

### 1.2 Agent Plan 核心能力

| 能力 | 说明 | CC 模式价值 |
|------|------|-------------|
| **全模态文本模型** | 支持视觉理解的文本生成模型（如 Doubao-Vision） | CC 可直接看截图/设计稿写代码 |
| **图像生成模型** | 文生图模型 | CC 可生成 UI 占位图、图标素材 |
| **视频生成模型** | 文生视频模型 | CC 可生成演示视频 |
| **向量化模型** | Embedding 模型 | 知识库语义检索增强 |
| **豆包搜索 Harness** | 内置联网搜索能力 | CC 可实时搜索文档/API/技术方案 |
| **Agent 记忆 Harness** | 跨会话记忆持久化 | CC 可记住用户偏好和项目上下文 |
| **专业数据集 Harness** | 领域知识库注入 | CC 回答更专业精准 |

### 1.3 设计目标

1. **零感知切换**：用户在设置中配置 Agent Plan API Key 后，CC 模式自动获得多模态能力
2. **复用现有架构**：Provider Registry + CC SDK + 流式事件契约，不新增 Agent Loop
3. **Harness 按 MCP 对接**：豆包搜索/Agent 记忆等 Harness 封装为 MCP Server 工具
4. **AFP 用量可见**：前端展示剩余 AFP 额度
5. **Coding Plan 保留**：Agent Plan 和 Coding Plan 并存，用户按需切换

---

## 二、Agent Plan 技术架构分析

### 2.1 API 接口

Agent Plan 兼容 Anthropic Messages API（与 Coding Plan 相同的协议格式）：

```
POST {baseUrl}/v1/messages
Headers:
  Content-Type: application/json
  x-api-key: {ark_api_key}
  anthropic-version: 2023-06-01
Body: (标准 Anthropic Messages 格式)
{
  "model": "doubao-seed-1-6-vision",   // 模型ID
  "max_tokens": 4096,
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "分析这张UI截图" },
        { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "..." } }
      ]
    }
  ]
}
```

**推断 Base URL**（基于 Coding Plan 模式 `https://ark.cn-beijing.volces.com/api/coding`）：

| 套餐类型 | 推断 Base URL | 说明 |
|----------|--------------|------|
| Coding Plan | `https://ark.cn-beijing.volces.com/api/coding` | 当前使用 |
| Agent Plan | `https://ark.cn-beijing.volces.com/api/agent` | 待购买后确认 |

> ⚠️ 实际 Base URL 以火山引擎控制台 Agent Plan 接入页面为准。购买后需在控制台创建 Agent Plan 推理接入点获取。

### 2.2 套餐与计费

| 套餐 | AFP 额度 | 定位 |
|------|---------|------|
| Small | 较少 | 轻度使用 |
| Medium | 适中 | 日常开发 |
| Large | 大量 | 高频使用 |
| Max | 最大 | 团队/重度 |

- **AFP（Agent Fuel Point）**：统一用量单位，不同模型消耗不同 AFP 系数
- **包月制**：订阅期内使用，月底清零
- **超额后付费**：套餐 AFP 用完后可转为后付费继续使用

### 2.3 支持模型（推断，购买后以实际为准）

| 模型类型 | 模型示例 | CC 模式用途 |
|----------|---------|-------------|
| 文本生成（含视觉） | doubao-seed-1-6-vision, doubao-1-5-vision-pro | **核心**：看图写代码、UI 分析 |
| 文本生成（纯文本） | doubao-seed-1-6, deepseek-v3.1 | 通用编程 |
| 图像生成 | doubao-seedream-3-0 | 生成 UI 占位图、图标 |
| 视频生成 | seedance-2-0 | 生成演示视频 |
| 向量化 | doubao-embedding-text | 知识库语义检索 |

### 2.4 Harness 能力

| Harness | 功能 | 对接方式 |
|---------|------|---------|
| **豆包搜索** | 联网搜索实时信息 | MCP Server（搜索工具）或 API 直调 |
| **专业数据集** | 领域知识库增强 | API 直调 → 注入 CC 上下文 |
| **Agent 记忆** | 跨会话记忆持久化 | API 直调 → 同步到 Memora 记忆系统 |
| **ArkClaw** | 代码执行沙箱 | MCP Server（已有 CC Bash 工具，优先级低） |
| **Supabase** | 数据库即服务 | MCP Server（未来扩展） |

---

## 三、对接方案

### 3.1 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    Memora 前端 (app.js)                   │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ CC 对话页面  │  │ 供应商选择器  │  │ AFP 用量面板  │  │
│  └──────┬──────┘  └──────┬───────┘  └───────┬────────┘  │
└─────────┼─────────────────┼──────────────────┼───────────┘
          │ IPC              │ IPC               │ IPC
┌─────────▼─────────────────▼──────────────────▼───────────┐
│                   main.js (主进程)                         │
│                                                           │
│  ┌──────────────────────────────────────────────────────┐ │
│  │              Provider Registry                        │ │
│  │  volcano (Coding Plan)  ← 当前                        │ │
│  │  volcano-agent (Agent Plan) ← 新增                   │ │
│  │  deepseek / tencent / openrouter                      │ │
│  └────────────────────┬─────────────────────────────────┘ │
│                       │                                   │
│  ┌────────────────────▼─────────────────────────────────┐ │
│  │           CC SDK (Claude Agent SDK)                  │ │
│  │  options.env:                                       │ │
│  │    ANTHROPIC_BASE_URL → Agent Plan endpoint          │ │
│  │    ANTHROPIC_AUTH_TOKEN → ark-api-key                │ │
│  │    ANTHROPIC_MODEL → doubao-seed-vision              │ │
│  │  options.mcpServers:                                 │ │
│  │    doubao-search ← 豆包搜索 Harness                  │ │
│  │    agent-memory ← Agent 记忆 Harness                 │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌──────────────────────────────────────────────────────┐ │
│  │           多模态能力增强                              │ │
│  │  • 图片输入：用户拖入截图 → base64 → CC content block │ │
│  │  • 图片生成：CC 工具调用 → Ark API → 返回 URL        │ │
│  │  • 联网搜索：CC 工具调用 → 豆包搜索 Harness → 结果    │ │
│  └──────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
          │                                               │
          ▼                                               ▼
┌─────────────────────┐                     ┌───────────────────────┐
│  火山方舟 Agent Plan  │                     │  火山方舟 Coding Plan  │
│  (多模态 + Harness)  │                     │  (纯文本编程模型)      │
│  /api/agent          │                     │  /api/coding           │
└─────────────────────┘                     └───────────────────────┘
```

### 3.2 新增 Provider Registry 条目

在 `main.js` `PROVIDER_REGISTRY` 中新增 `volcano-agent`：

```javascript
volcano_agent: {
  id: 'volcano_agent',
  name: '火山引擎 Agent Plan',
  shortName: 'Agent Plan',
  region: 'cn',
  type: 'direct',           // Anthropic 兼容直连（与 Coding Plan 相同协议）
  icon: '🌋',
  plan: 'agent',            // 标记为 Agent Plan（用于区分 Coding Plan）
  fields: [
    { key: 'baseUrl', label: 'Base URL', type: 'text', default: 'https://ark.cn-beijing.volces.com/api/agent' },
    { key: 'authToken', label: 'API Key', type: 'password', placeholder: 'ark-xxxxxxxx' },
    { key: 'modelList', label: '模型列表', type: 'textarea', default: '' },
    { key: 'model', label: '主模型', type: 'select', default: 'auto', options: [
      { value: 'auto', label: 'Auto（智能调度）' },
      { value: 'doubao-seed-1-6-vision', label: 'Doubao-Seed-1.6-Vision（代码+视觉）' },
      { value: 'doubao-seed-1-6', label: 'Doubao-Seed-1.6（纯文本）' },
      { value: 'deepseek-v3.1', label: 'DeepSeek-V3.1（推理）' },
    ]},
    // Agent Plan 专属：多模态模型路由
    { key: 'imageGenModel', label: '图像生成模型', type: 'select', default: 'doubao-seedream-3-0', options: [
      { value: 'doubao-seedream-3-0', label: 'Doubao-Seedream-3.0' },
    ]},
    { key: 'videoGenModel', label: '视频生成模型', type: 'select', default: 'seedance-2-0', options: [
      { value: 'seedance-2-0', label: 'Seedance-2.0' },
    ]},
    { key: 'embeddingModel', label: '向量化模型', type: 'select', default: 'doubao-embedding-text', options: [
      { value: 'doubao-embedding-text', label: 'Doubao-Embedding-Text' },
    ]},
    // Harness 开关
    { key: 'enableDoubaoSearch', label: '启用豆包搜索', type: 'toggle', default: true },
    { key: 'enableAgentMemory', label: '启用 Agent 记忆', type: 'toggle', default: false },
  ],
  envMap: (config) => ({
    ANTHROPIC_BASE_URL: config.baseUrl,
    ANTHROPIC_AUTH_TOKEN: config.authToken,
    ANTHROPIC_MODEL: config.model,
  }),
},
```

### 3.3 多模态图片输入支持

#### 3.3.1 前端：图片粘贴/拖入

在 `app.js` `sendAIMessage` 方法中，当供应商为 `volcano_agent` 时，将图片附件转为 Anthropic content block：

```javascript
// 当前逻辑：附件文本拼接为 prompt 前缀
// 新增逻辑：Agent Plan 供应商 + 图片附件 → 构建多模态 content

if (activeProviderId === 'volcano_agent' && attachments?.some(a => a.type === 'image')) {
  // 构建多模态消息
  const content = [];
  
  // 图片附件 → image content block
  for (const att of attachments.filter(a => a.type === 'image')) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: att.mimeType || 'image/png',
        data: att.base64Data,
      }
    });
  }
  
  // 文本附件 → text content block
  for (const att of attachments.filter(a => a.type === 'text' && a.textContent)) {
    content.push({ type: 'text', text: `[文件: ${att.name}]\n${att.textContent}` });
  }
  
  // 用户消息
  content.push({ type: 'text', text: message });
  
  // 通过新增 IPC 参数传递多模态 content
  ccInvokeParams.content = content;
}
```

#### 3.3.2 主进程：CC SDK 多模态调用

在 `main.js` `cc:invoke` handler 中，当收到 `content` 参数（多模态内容数组）时，传给 CC SDK：

```javascript
// cc:invoke handler
if (content && Array.isArray(content)) {
  // 多模态模式：CC SDK 原生支持 content blocks
  prompt = content; // SDK query() 接受 string 或 content blocks 数组
} else {
  // 纯文本模式（现有逻辑不变）
  prompt = message;
}
```

> Claude Code Agent SDK 的 `query()` 方法接受 `string | UserMessage[]`，其中 `UserMessage.content` 可以是 `ContentBlock[]`，原生支持 image 类型。无需额外处理。

#### 3.3.3 Coding Plan 降级处理

当供应商为 Coding Plan（仅文本）但用户粘贴了图片时：

```javascript
// 在 sendAIMessage 中
if (activeProviderId === 'volcano' && hasImageAttachment) {
  this.showToast('当前供应商（Coding Plan）不支持图片输入，已自动过滤。切换到 Agent Plan 可启用多模态。', 'warning');
  // 过滤掉图片，仅保留文本
  attachments = attachments.filter(a => a.type !== 'image');
}
```

### 3.4 Harness 对接

#### 3.4.1 豆包搜索（Doubao Search）

**方案**：封装为 MCP Server（stdio 类型），注册为 CC 连接器。

```javascript
// main.js — 当供应商为 volcano_agent 且启用豆包搜索时，自动注入 MCP Server
if (activeProviderId === 'volcano_agent' && providerConfig.enableDoubaoSearch) {
  const doubaoSearchMCP = {
    'doubao-search': {
      type: 'stdio',
      command: 'node',
      args: [path.join(__dirname, 'src/mcp/doubao-search-server.js')],
      env: {
        ARK_API_KEY: providerConfig.authToken,
        ARK_BASE_URL: providerConfig.baseUrl,
      }
    }
  };
  // 合并到 mcpServers
  options.mcpServers = [...(options.mcpServers || []), doubaoSearchMCP];
}
```

**MCP Server 实现** (`src/mcp/doubao-search-server.js`)：

```javascript
// 豆包搜索 MCP Server
// 工具：web_search(query) → 返回搜索结果摘要
// 调用火山方舟 Harness API：POST {baseUrl}/harnesses/doubao_search
const searchTool = {
  name: 'web_search',
  description: '使用豆包搜索引擎搜索互联网信息',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词' },
      count: { type: 'number', description: '返回结果数量（默认5）', default: 5 }
    },
    required: ['query']
  }
};

// 执行搜索
async function executeSearch(args) {
  const response = await fetch(`${arkBaseUrl}/harnesses/doubao_search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': arkApiKey,
    },
    body: JSON.stringify({ query: args.query, count: args.count || 5 })
  });
  const data = await response.json();
  return { content: [{ type: 'text', text: JSON.stringify(data.results) }] };
}
```

> ⚠️ 豆包搜索 Harness 的 API 格式购买后需确认。上述为推测格式，可能需要调整。

#### 3.4.2 Agent 记忆（Agent Memory）

**方案**：与 Memora 本地记忆系统双向同步，而非独立 Harness。

```
CC 会话结束 → CC SDK 返回的 result.usage 中提取记忆标记
  → main.js 将 CC 生成的新记忆同步到 Memora 记忆库
  → 下次 CC 调用时通过 CLAUDE.md 注入上下文（已有逻辑）
```

Agent 记忆 Harness 暂不单独对接，复用现有的 `syncCLAUDEMdToCC()` + Memora 记忆系统。

#### 3.4.3 专业数据集

**方案**：API 直调，将检索结果注入 CC 上下文。

```javascript
// 在 cc:invoke 中，对话开始前注入数据集上下文
if (activeProviderId === 'volcano_agent' && providerConfig.datasetId) {
  const datasetResult = await fetchDatasetContext(providerConfig, message);
  if (datasetResult) {
    prompt = `[数据集上下文]\n${datasetResult}\n\n用户问题：${message}`;
  }
}
```

### 3.5 图片/视频生成工具

为 CC 模式新增 **MCP 工具**，让 CC Agent 可以调用图片和视频生成模型：

```javascript
// src/mcp/ark-multimodal-server.js
// 工具列表：
// 1. generate_image(prompt, size?) → 返回图片 URL
// 2. generate_video(prompt, duration?) → 返回视频 URL
// 3. analyze_image(imageUrl, question?) → 视觉理解（如果主模型不支持视觉）

const tools = [
  {
    name: 'generate_image',
    description: '使用火山方舟图像生成模型创建图片',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '图片描述' },
        size: { type: 'string', enum: ['1024x1024', '1280x720', '768x1024'], default: '1024x1024' }
      },
      required: ['prompt']
    }
  },
  {
    name: 'generate_video',
    description: '使用火山方舟视频生成模型创建短视频',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '视频描述' },
        duration: { type: 'number', description: '时长（秒）', default: 5 }
      },
      required: ['prompt']
    }
  }
];
```

**注册为 CC 连接器**（仅 Agent Plan 供应商时自动启用）：

```javascript
if (activeProviderId === 'volcano_agent') {
  const multimodalMCP = {
    'ark-multimodal': {
      type: 'stdio',
      command: 'node',
      args: [path.join(__dirname, 'src/mcp/ark-multimodal-server.js')],
      env: {
        ARK_API_KEY: providerConfig.authToken,
        ARK_BASE_URL: providerConfig.baseUrl,
        IMAGE_MODEL: providerConfig.imageGenModel || 'doubao-seedream-3-0',
        VIDEO_MODEL: providerConfig.videoGenModel || 'seedance-2-0',
      }
    }
  };
  options.mcpServers = [...(options.mcpServers || []), multimodalMCP];
}
```

### 3.6 AFP 用量监控

#### 3.6.1 主进程：AFP 查询 IPC

```javascript
// main.js — 新增 IPC handler
ipcMain.handle('ark:get-afp-usage', async (event, providerId) => {
  const config = getProviderConfig(providerId);
  if (!config.authToken) return { success: false, error: 'API Key 未配置' };
  
  try {
    // 火山方舟用量查询 API（具体 endpoint 购买后确认）
    const url = config.baseUrl.replace(/\/+$/, '') + '/usage';
    const resp = await fetch(url, {
      headers: {
        'x-api-key': config.authToken,
        'anthropic-version': '2023-06-01',
      },
    });
    if (resp.ok) {
      const data = await resp.json();
      return {
        success: true,
        plan: data.plan || 'unknown',
        totalAFP: data.total_afp || 0,
        usedAFP: data.used_afp || 0,
        remainingAFP: data.remaining_afp || 0,
        resetDate: data.reset_date || '',
      };
    }
    return { success: false, error: `HTTP ${resp.status}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
```

#### 3.6.2 前端：CC 对话栏 AFP 指示器

在 AI 助手页面顶部状态栏中，当供应商为 `volcano_agent` 时显示 AFP 剩余量：

```html
<!-- index.html — CC 对话栏区域 -->
<div id="afpIndicator" class="afp-indicator hidden">
  <span class="afp-icon">⛽</span>
  <span class="afp-label">AFP</span>
  <span class="afp-value" id="afpValue">--</span>
  <span class="afp-total" id="afpTotal">/--</span>
  <div class="afp-bar">
    <div class="afp-bar-fill" id="afpBarFill"></div>
  </div>
</div>
```

```javascript
// app.js — 加载和刷新 AFP 用量
async _loadAFPUsage() {
  const providerId = this._getCurrentCCProvider?.() || 'volcano_agent';
  if (providerId !== 'volcano_agent') {
    document.getElementById('afpIndicator')?.classList.add('hidden');
    return;
  }
  const result = await window.electronAPI?.arkGetAFPUsage?.(providerId);
  if (result?.success) {
    const indicator = document.getElementById('afpIndicator');
    indicator?.classList.remove('hidden');
    document.getElementById('afpValue').textContent = result.remainingAFP.toLocaleString();
    document.getElementById('afpTotal').textContent = `/${result.totalAFP.toLocaleString()}`;
    const pct = (result.remainingAFP / result.totalAFP) * 100;
    const bar = document.getElementById('afpBarFill');
    bar.style.width = `${pct}%`;
    bar.className = pct > 50 ? 'afp-bar-fill' : pct > 20 ? 'afp-bar-fill warning' : 'afp-bar-fill danger';
  }
}
```

#### 3.6.3 CC 流式事件中追踪 AFP

CC SDK 的 `result.usage` 返回 token 使用量。在 CC 调用完成后，如果供应商为 Agent Plan，估算 AFP 消耗：

```javascript
// main.js — cc:invoke 的 done 事件中
if (activeProviderId === 'volcano_agent' && usage) {
  // 发送 AFP 估算事件到前端
  mainWindow.webContents.send('cc:stream', {
    event: 'usage',
    usage,
    afpEstimate: estimateAFP(usage, providerConfig.model),
  });
}
```

### 3.7 供应商自动降级

当 Agent Plan AFP 不足或模型不可用时，自动降级到 Coding Plan：

```javascript
// main.js — cc:invoke handler
try {
  // ... CC SDK 调用
} catch (err) {
  // Agent Plan 失败 → 尝试降级到 Coding Plan
  if (activeProviderId === 'volcano_agent' && isProviderConfigured('volcano')) {
    console.warn('[CC] Agent Plan failed, falling back to Coding Plan:', err.message);
    mainWindow.webContents.send('cc:stream', {
      event: 'info',
      level: 'warning',
      content: `Agent Plan 调用失败（${err.message}），已自动降级到 Coding Plan`
    });
    // 用 Coding Plan 配置重试
    activeProviderId = 'volcano';
    providerEnv = PROVIDER_REGISTRY.volcano.envMap(getProviderConfig('volcano'));
    // 重新调用...
  }
}
```

---

## 四、代码改动清单

### 4.1 新增文件

| 文件 | 说明 |
|------|------|
| `src/mcp/doubao-search-server.js` | 豆包搜索 Harness MCP Server |
| `src/mcp/ark-multimodal-server.js` | 图片/视频生成 MCP Server |
| `src/mcp/mcp-base.js` | MCP Server 基类（复用 JSON-RPC 协议） |

### 4.2 修改文件

| 文件 | 改动 |
|------|------|
| `main.js` | `PROVIDER_REGISTRY` 新增 `volcano_agent` 条目；`cc:invoke` 增加多模态 content 传递 + Harness MCP 自动注入；新增 `ark:get-afp-usage` IPC handler；供应商降级逻辑 |
| `preload.js` | 暴露 `arkGetAFPUsage` IPC 通道 |
| `src/scripts/app.js` | `sendAIMessage` 增加图片附件转 content block；新增 `_loadAFPUsage()`；CC 流式事件处理 `usage` 事件 |
| `src/index.html` | CC 设置面板新增 Agent Plan 供应商配置（含多模态模型选择 + Harness 开关）；AI 助手页新增 AFP 用量指示器 |
| `src/styles/main.css` | AFP 指示器样式（`.afp-indicator` / `.afp-bar`） |
| `src/scripts/i18n.js` | 新增 Agent Plan 相关翻译 |

### 4.3 不改动的文件（复用现有架构）

| 文件 | 原因 |
|------|------|
| `src/proxy/anthropic-proxy.js` | Agent Plan 直连模式，无需代理翻译 |
| CC 流式事件契约（`cc:stream`） | 事件格式不变，前端零改动 |
| Skill 系统 | CC SDK 原生支持，不感知供应商变化 |
| 会话持久化 | `ccSessionId` 机制不变 |
| 权限模式 | CC SDK 控制，不受供应商影响 |

---

## 五、前端交互设计

### 5.1 设置面板 — Agent Plan 配置

在 M-Agent 设置标签页的供应商选择区域，新增"火山引擎 Agent Plan"选项。选中后展开配置面板：

```
┌──────────────────────────────────────────────────────────┐
│  🌋 火山引擎 Agent Plan                                    │
│                                                          │
│  API Key:  [ark-xxxxxxxxxxxxxxxx]     [测试连接]         │
│  Base URL: [https://ark.cn-beijing.volces.com/api/agent]  │
│                                                          │
│  ── 主模型（文本+视觉） ──                                │
│  [Doubao-Seed-1.6-Vision（代码+视觉） ▼]                │
│                                                          │
│  ── 多模态模型路由 ──                                    │
│  图像生成: [Doubao-Seedream-3.0 ▼]                      │
│  视频生成: [Seedance-2.0 ▼]                             │
│  向量化:   [Doubao-Embedding-Text ▼]                    │
│                                                          │
│  ── Harness ──                                           │
│  [✓] 豆包搜索    联网搜索实时信息                        │
│  [ ] Agent 记忆   跨会话记忆持久化                       │
│  [ ] 专业数据集   领域知识增强                           │
│                                                          │
│  ── AFP 用量 ──                                          │
│  ⛽ 剩余 8,500 / 10,000 AFP  ████████████░░░  85%       │
│  重置日期：2026-07-01                                    │
└──────────────────────────────────────────────────────────┘
```

### 5.2 AI 助手页 — 多模态输入

当供应商为 Agent Plan 时：

1. **粘贴图片**：用户 Cmd+V 粘贴截图，自动转为缩略图显示在输入框上方
2. **拖入文件**：支持拖入 PNG/JPG/WebP 图片文件
3. **图片预览**：输入区显示图片缩略图 + 删除按钮
4. **发送**：自动构建 Anthropic 多模态 content block

当供应商为 Coding Plan 时：
- 粘贴图片时显示提示："当前供应商不支持图片，切换到 Agent Plan 可启用"
- 图片被过滤，仅发送文本

### 5.3 CC 对话栏 — AFP 指示器

```
┌────────────────────────────────────────────────────────┐
│  [供应商: Agent Plan ▼]  ⛽ AFP 8,500/10K  ████░░ 85% │
├────────────────────────────────────────────────────────┤
│                                                        │
│  [对话区...]                                           │
│                                                        │
└────────────────────────────────────────────────────────┘
```

- 颜色：>50% 绿色，20-50% 橙色，<20% 红色
- 点击展开详情：套餐类型、本月用量、重置日期
- 每次 CC 调用完成后自动刷新

---

## 六、实施计划

### Phase 1：Provider 注册 + 基础对接（1天）

1. `main.js`：`PROVIDER_REGISTRY` 新增 `volcano_agent`
2. `main.js`：`cc:invoke` 支持 `content` 数组（多模态 content blocks）
3. `app.js`：图片粘贴 → base64 → content block 转换逻辑
4. `app.js`：Coding Plan 供应商图片过滤 + 提示
5. `index.html` + `i18n.js`：Agent Plan 供应商配置 UI
6. 测试：用 Coding Plan 的 API Key 连 Agent Plan endpoint（验证协议兼容性）

### Phase 2：Harness 对接（1-2天，需购买后验证）

1. `src/mcp/doubao-search-server.js`：豆包搜索 MCP Server
2. `main.js`：Agent Plan 供应商自动注入搜索 + 多模态 MCP Server
3. `src/mcp/ark-multimodal-server.js`：图片/视频生成 MCP Server
4. 测试：CC 对话中调用搜索工具、生成图片

### Phase 3：AFP 监控 + 降级（0.5天）

1. `main.js`：`ark:get-afp-usage` IPC handler
2. `preload.js`：暴露 `arkGetAFPUsage`
3. `app.js`：AFP 指示器加载 + 刷新
4. `main.js`：Agent Plan 失败 → Coding Plan 降级
5. `index.html` + `main.css`：AFP 指示器 UI + 样式

### Phase 4：完善与优化（0.5天）

1. 图片输入的文件大小限制（建议 < 5MB）
2. 多图片输入支持（最多 5 张）
3. AFP 消耗估算公式校准
4. i18n 英文翻译
5. 文档更新

---

## 七、风险与注意事项

### 7.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Agent Plan Base URL 未确认 | 对接失败 | 先用推断 URL，购买后确认实际值 |
| Harness API 格式未知 | MCP Server 无法实现 | 先搭框架，购买后按实际 API 调整 |
| 图片大小超过 API 限制 | 请求失败 | 前端压缩图片到 < 5MB 再发送 |
| AFP 查询 API 格式未知 | 用量不可见 | 先用 CC SDK 返回的 usage 估算，购买后对接官方 API |
| 多模态模型 function calling 支持不确定 | CC 工具调用可能失败 | 降级到纯文本模型，保留工具能力 |

### 7.2 注意事项

1. **API Key 安全**：Agent Plan API Key 存储在 `memora-settings.json`（与 Coding Plan 相同），不上传云端
2. **套餐切换**：用户从 Coding Plan 切到 Agent Plan 时，已有 CC 会话的 `ccSessionId` 可能不兼容（不同后端），建议提示用户新建会话
3. **计费透明**：每次 CC 调用消耗的 AFP 应在前端可见，避免用户超量
4. **降级策略**：AFP 耗尽时自动降级到 Coding Plan，并提示用户
5. **Harness 独立计费**：豆包搜索等 Harness 可能独立消耗 AFP，需在用量面板中分别展示

### 7.3 兼容性

- **Coding Plan 不受影响**：新增 `volcano_agent` 作为独立供应商，不影响现有 `volcano` 配置
- **旧用户零感知**：默认供应商仍为 `volcano`（Coding Plan），用户主动切换才使用 Agent Plan
- **前端事件契约不变**：`cc:stream` 事件格式完全兼容，新增 `usage` 事件为可选扩展

---

## 八、与现有系统的关系

```
                    ┌──────────────────┐
                    │   Memora 设置面板  │
                    │                  │
                    │  供应商选择:      │
                    │  ○ Coding Plan   │ ← 当前默认
                    │  ● Agent Plan    │ ← 新增
                    │  ○ DeepSeek      │
                    │  ○ 腾讯云         │
                    │  ○ OpenRouter    │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  Provider Registry │
                    │  (main.js)        │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
    ┌─────────▼────┐  ┌─────▼──────┐  ┌───▼──────────┐
    │ Coding Plan  │  │ Agent Plan │  │ DeepSeek 等  │
    │ /api/coding  │  │ /api/agent │  │              │
    │ 纯文本       │  │ 多模态     │  │              │
    │ 无 Harness   │  │ + Harness  │  │              │
    └──────────────┘  └──────┬─────┘  └──────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
    ┌─────────▼────┐  ┌─────▼──────┐  ┌────▼──────────┐
    │ 豆包搜索 MCP  │  │ 多模态 MCP │  │ AFP 用量监控   │
    │ (web_search) │  │ (img/video)│  │ (usage API)   │
    └──────────────┘  └────────────┘  └───────────────┘
                             │
                    ┌────────▼─────────┐
                    │   CC SDK (不变)   │
                    │  query() + env   │
                    │  + mcpServers    │
                    └──────────────────┘
```

---

## 九、未来扩展

1. **Agent Plan → Memora 记忆双向同步**：CC 对话中产生的知识原子自动写入 Memora 记忆库，反向亦然
2. **Agent Plan 专业数据集 → 知识库**：将火山方舟专业数据集检索结果与 Memora 知识图谱融合
3. **多供应商智能路由**：根据任务类型自动选择供应商（编程用 Coding Plan、多模态用 Agent Plan、推理用 DeepSeek）
4. **AFP 预算提醒**：设置 AFP 月度预算阈值，接近时提醒用户
5. **Agent Plan SDK**：火山引擎可能推出原生 Agent SDK（类似 Claude Agent SDK），届时可替换底层实现，前端零改动
