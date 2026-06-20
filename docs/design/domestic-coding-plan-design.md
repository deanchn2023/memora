# 国内 Coding Plan 多供应商方案设计

## 1. 背景

当前 M-Agent 模式支持两种 AI 后端：

| 供应商 | 类型 | 地域 | 现状 |
|--------|------|------|------|
| 火山引擎 Coding Plan | Anthropic 兼容直连 | 国内 | 默认配置，已可用 |
| OpenRouter | 本地代理翻译（Anthropic ↔ OpenAI） | 海外 | 已开发完成 |

**问题**：OpenRouter 模型全部为海外模型，国内用户网络延迟高、可能无法访问。火山引擎 Coding Plan 虽好，但用户缺少国内备选供应商。

**目标**：在现有架构上增加"国内 Coding Plan"概念，将火山引擎和腾讯云等国内供应商统一管理。按配置状态动态显示可用供应商。

## 2. 供应商分类

### 2.1 按接入方式分类

```
┌─────────────────────────────────────────────────────────┐
│                    M-Agent 模型选择栏                      │
│                                                          │
│  ┌─────────────┐  ┌──────────────────────────────────┐  │
│  │ 供应商选择    │  │           模型选择               │  │
│  │              │  │                                  │  │
│  │ ▸ 默认       │  │  (根据供应商动态加载)              │  │
│  │ ▸ 国内 ▾     │  │                                  │  │
│  │   • 火山引擎  │  │                                  │  │
│  │   • 腾讯混元  │  │                                  │  │
│  │   • DeepSeek │  │                                  │  │
│  │ ▸ 海外 ▾     │  │                                  │  │
│  │   • OpenRouter│  │                                  │  │
│  └─────────────┘  └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 2.2 供应商清单

#### 国内供应商（直连 Anthropic 兼容）

| 供应商 | Base URL | 模型 | 认证 | 说明 |
|--------|----------|------|------|------|
| 火山引擎 Coding Plan | `https://ark.cn-beijing.volces.com/api/coding` | `ark-code-latest` | Auth Token | 现有默认，SDK 直连 |
| DeepSeek | `https://api.deepseek.com/anthropic` | `deepseek-chat` / `deepseek-reasoner` | API Key (sk-xxx) | 原生 Anthropic 兼容端点 |
| 腾讯云 Coding Plan | `https://api.lkeap.cloud.tencent.com/coding/anthropic` | `tc-code-latest` 等 | API Key (sk-sp-xxx) | ✅ Anthropic 兼容端点，直连无需代理 |

#### 海外供应商（代理翻译）

| 供应商 | Base URL | 模型 | 认证 | 说明 |
|--------|----------|------|------|------|
| OpenRouter | `https://openrouter.ai/api/v1` | 数百种 | API Key (sk-or-v1-xxx) | 现有代理方案 B |

### 2.3 接入方式决策

```
供应商类型判定：
  ├─ Anthropic 兼容端点？ → 直连模式（无需代理，SDK 原生支持）
  │   ├─ 火山引擎 Coding Plan ✓
  │   ├─ DeepSeek Anthropic 端点 ✓
  │   └─ 其他 Anthropic 兼容服务 ✓
  │
  └─ OpenAI 兼容端点？ → 代理模式（复用现有 anthropic-proxy）
      ├─ OpenRouter ✓（已有）
      ├─ 腾讯混元（需代理）
      └─ 其他 OpenAI 兼容服务
```

**腾讯混元特殊处理**：腾讯混元使用 OpenAI 兼容格式（`/v1/chat/completions`），不是 Anthropic 格式。有两种方案：
- **方案 A**：复用现有 `anthropic-proxy.js`，新增腾讯混元作为代理后端（推荐，零新代码）
- **方案 B**：腾讯混元提供 Anthropic 兼容端点（如有），直接直连（需确认腾讯云是否提供）

**推荐方案 A**：代理模块已经支持任意 OpenAI 兼容后端，只需传入不同的 `baseUrl` + `apiKey` 即可。

## 3. 架构设计

### 3.1 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                      Electron 主进程                          │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │                Provider Registry                     │     │
│  │                                                      │     │
│  │  providers = [                                       │     │
│  │    { id: 'volcano', name: '火山引擎', region: 'cn',  │     │
│  │      type: 'direct', baseUrl, authToken, model },    │     │
│  │    { id: 'deepseek', name: 'DeepSeek', region: 'cn',│     │
│  │      type: 'direct', baseUrl, apiKey, model },       │     │
│  │    { id: 'tencent', name: '腾讯混元', region: 'cn',   │     │
│  │      type: 'proxy', baseUrl, secretId, secretKey },  │     │
│  │    { id: 'openrouter', name: 'OpenRouter',           │     │
│  │      region: 'global', type: 'proxy', apiKey },      │     │
│  │  ]                                                   │     │
│  └─────────────────────────────────────────────────────┘     │
│                          │                                    │
│         ┌────────────────┼────────────────┐                   │
│         ▼                ▼                ▼                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐          │
│  │  Direct Mode │ │  Proxy Mode  │ │  Proxy Mode  │          │
│  │  (火山/DS)    │ │  (腾讯混元)   │ │  (OpenRouter)│          │
│  │              │ │              │ │              │          │
│  │ ANTHROPIC_   │ │ Proxy :3999  │ │ Proxy :3999  │          │
│  │ BASE_URL =   │ │ → 腾讯 API   │ │ → OpenRouter │          │
│  │ 供应商端点     │ │ (OpenAI格式) │ │ (OpenAI格式)  │          │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘          │
│         │                │                │                  │
│         └────────────────┼────────────────┘                  │
│                          ▼                                    │
│              ┌──────────────────────┐                          │
│              │  Claude Code Agent   │                          │
│              │  SDK (query)         │                          │
│              │                      │                          │
│              │  • 工具执行循环        │                          │
│              │  • Skill / MCP       │                          │
│              │  • 会话恢复            │                          │
│              │  • 权限模式            │                          │
│              └──────────┬───────────┘                          │
│                         │ cc:stream                           │
│                         ▼                                      │
│              ┌──────────────────────┐                          │
│              │  前端渲染层 (app.js)   │                          │
│              └──────────────────────┘                          │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Provider 配置数据结构

```javascript
// main.js — Provider 注册表
const PROVIDER_REGISTRY = {
  // 国内 — 直连 Anthropic 兼容
  volcano: {
    id: 'volcano',
    name: '火山引擎 Coding Plan',
    shortName: '火山引擎',
    region: 'cn',                    // 国内
    type: 'direct',                  // 直连，无需代理
    icon: '🌋',
    fields: [
      { key: 'baseUrl', label: 'Base URL', type: 'text', default: 'https://ark.cn-beijing.volces.com/api/coding' },
      { key: 'authToken', label: 'Auth Token', type: 'password', placeholder: 'ark-xxxxxxxx' },
      { key: 'model', label: '模型', type: 'text', default: 'ark-code-latest' },
    ],
    // SDK env 映射
    envMap: (config) => ({
      ANTHROPIC_BASE_URL: config.baseUrl,
      ANTHROPIC_AUTH_TOKEN: config.authToken,
      ANTHROPIC_MODEL: config.model,
    }),
  },

  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    shortName: 'DeepSeek',
    region: 'cn',
    type: 'direct',
    icon: '🔵',
    fields: [
      { key: 'baseUrl', label: 'Base URL', type: 'text', default: 'https://api.deepseek.com/anthropic' },
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-xxxxxxxx' },
      { key: 'model', label: '模型', type: 'select', options: [
        { value: 'deepseek-chat', label: 'DeepSeek Chat (快速)' },
        { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner (推理)' },
      ]},
    ],
    envMap: (config) => ({
      ANTHROPIC_BASE_URL: config.baseUrl,
      ANTHROPIC_AUTH_TOKEN: config.apiKey,
      ANTHROPIC_MODEL: config.model,
    }),
  },

  tencent: {
    id: 'tencent',
    name: '腾讯云 Coding Plan',
    shortName: '腾讯云',
    region: 'cn',
    type: 'direct',                   // ✅ Anthropic 兼容端点，直连
    icon: '🐧',
    fields: [
      { key: 'baseUrl', label: 'Base URL', type: 'text', default: 'https://api.lkeap.cloud.tencent.com/coding/anthropic' },
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-sp-xxxxxxxx' },
      { key: 'model', label: '模型', type: 'select', options: [
        { value: 'tc-code-latest', label: 'Auto (自动匹配)' },
        { value: 'minimax-m2.5', label: 'MiniMax-M2.5' },
        { value: 'kimi-k2.5', label: 'Kimi-K2.5' },
        { value: 'glm-5', label: 'GLM-5' },
        { value: 'hunyuan-t1', label: 'Hunyuan-T1' },
        { value: 'hunyuan-turbos', label: 'Hunyuan-TurboS' },
      ]},
    ],
    envMap: (config) => ({
      ANTHROPIC_BASE_URL: config.baseUrl,
      ANTHROPIC_AUTH_TOKEN: config.apiKey,
      ANTHROPIC_MODEL: config.model,
    }),
  },

  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter（海外多模型）',
    shortName: 'OpenRouter',
    region: 'global',                // 海外
    type: 'proxy',
    icon: '🌐',
    fields: [
      { key: 'baseUrl', label: 'Base URL', type: 'text', default: 'https://openrouter.ai/api/v1' },
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-or-v1-xxxxxxxx' },
      { key: 'defaultModel', label: '默认模型', type: 'text', placeholder: 'anthropic/claude-sonnet-4' },
    ],
    proxyConfig: (config) => ({
      upstreamBaseUrl: config.baseUrl,
      upstreamApiKey: config.apiKey,
      upstreamAuthType: 'bearer',
    }),
  },
};
```

### 3.3 配置存储

```javascript
// 存储格式（Settings）
{
  // 每个供应商独立存储，key 前缀 cc_provider_{id}_
  "cc_provider_volcano_baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
  "cc_provider_volcano_authToken": "ark-xxxxxxxx",
  "cc_provider_volcano_model": "ark-code-latest",
  "cc_provider_volcano_enabled": "true",

  "cc_provider_deepseek_baseUrl": "https://api.deepseek.com/anthropic",
  "cc_provider_deepseek_apiKey": "sk-xxxxxxxx",
  "cc_provider_deepseek_model": "deepseek-chat",
  "cc_provider_deepseek_enabled": "false",

  "cc_provider_tencent_baseUrl": "https://api.hunyuan.cloud.tencent.com/v1",
  "cc_provider_tencent_secretId": "AKIDxxxxxxxx",
  "cc_provider_tencent_secretKey": "xxxxxxxx",
  "cc_provider_tencent_model": "hunyuan-turbos-latest",
  "cc_provider_tencent_enabled": "false",

  "cc_provider_openrouter_baseUrl": "https://openrouter.ai/api/v1",
  "cc_provider_openrouter_apiKey": "sk-or-v1-xxxxxxxx",
  "cc_provider_openrouter_defaultModel": "anthropic/claude-sonnet-4",
  "cc_provider_openrouter_enabled": "true",

  // 当前选中的供应商
  "cc_active_provider": "volcano",
}
```

### 3.4 供应商可用性判定

```javascript
// 判断供应商是否已配置（有必需的认证字段）
function isProviderConfigured(providerId) {
  const provider = PROVIDER_REGISTRY[providerId];
  const config = getProviderConfig(providerId);
  // 检查所有 password 类型字段是否有值
  return provider.fields
    .filter(f => f.type === 'password')
    .every(f => config[f.key] && config[f.key].trim() !== '');
}

// 获取可用供应商列表
function getAvailableProviders() {
  return Object.values(PROVIDER_REGISTRY)
    .filter(p => isProviderConfigured(p.id))
    .sort((a, b) => {
      // 国内优先，然后按名称排序
      if (a.region === 'cn' && b.region !== 'cn') return -1;
      if (a.region !== 'cn' && b.region === 'cn') return 1;
      return a.name.localeCompare(b.name);
    });
}
```

## 4. UI 设计

### 4.1 对话栏模型选择区

**现状**：
```
📂 工作目录: 默认 🔄 | 🧩 Skill: 无 ▾ | 🔌 连接器: 无 | 🌐 模型: 默认 ▾ 🔄 | 🔁 重启
```

**改造后**：
```
📂 工作目录: 默认 🔄 | 🧩 Skill: 无 ▾ | 🔌 连接器: 无 | 🔌 供应商: 火山引擎 ▾ | 🌐 模型: 默认 ▾ 🔄 | 🔁 重启
                                     │                    │
                                     │                    └─ 根据选中供应商动态加载模型列表
                                     │
                                     └─ 下拉框显示已配置的供应商
                                        ├─ 🌋 火山引擎（国内）
                                        ├─ 🔵 DeepSeek（国内）
                                        ├─ 🐧 腾讯混元（国内）
                                        ├─ 🌐 OpenRouter（海外）
                                        └─ 默认（Coding Plan 原始配置）
```

### 4.2 供应商下拉框交互

```
┌──────────────────────────────┐
│  🔌 供应商: 火山引擎       ▾ │  ← 点击展开
└──────────────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│  默认（Coding Plan 原始配置）  │  ← 始终显示，使用 DEFAULT_CC_CONFIG
├──────────────────────────────┤
│  ── 国内 ──                   │  ← 分组标题
│  🌋 火山引擎           ✓ 已配置│  ← 绿色 ✓ 表示已配置
│  🔵 DeepSeek           ✓ 已配置│
│  🐧 腾讯混元           ✗ 未配置│  ← 灰色，不可选（或可选但提示配置）
├──────────────────────────────┤
│  ── 海外 ──                   │
│  🌐 OpenRouter         ✓ 已配置│
└──────────────────────────────┘
```

**规则**：
- 已配置的供应商：正常颜色，可选
- 未配置的供应商：灰色，点击后跳转到设置页面对应区域
- "默认" 始终显示且可选，使用 `DEFAULT_CC_CONFIG` 的硬编码值

### 4.3 设置面板改造

**现状**：设置面板有两大区域 — M-Agent 基础配置 + OpenRouter 配置

**改造后**：

```
┌─────────────────────────────────────────────────┐
│  🧠 M-Agent                                      │
│                                                  │
│  ┌─ 基础配置（默认供应商）─────────────────────┐  │
│  │  Base URL:     [________________]           │  │
│  │  Auth Token:   [________________]           │  │
│  │  模型:          [________________]           │  │
│  │  允许工具:      [________________]           │  │
│  │  权限模式:      [default       ▾]           │  │
│  │  最大轮次:      [50            ]             │  │
│  │  工作目录:      [________________] 🔄       │  │
│  │  环境变量:      [+ 添加]                    │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌─ 国内供应商 ────────────────────────────────┐  │
│  │                                              │  │
│  │  ┌─ 🌋 火山引擎 Coding Plan ──── [启用 ✓]─┐ │  │
│  │  │  Base URL:   [________________]         │ │  │
│  │  │  Auth Token: [________________]         │ │  │
│  │  │  模型:        [________________]         │ │  │
│  │  │  🔗 测试连接                              │ │  │
│  │  └────────────────────────────────────────┘ │  │
│  │                                              │  │
│  │  ┌─ 🔵 DeepSeek ──────────────── [启用 ☐]─┐ │  │
│  │  │  Base URL:   [________________]         │ │  │
│  │  │  API Key:    [________________]         │ │  │
│  │  │  模型:        [deepseek-chat  ▾]         │ │  │
│  │  │  🔗 测试连接                              │ │  │
│  │  └────────────────────────────────────────┘ │  │
│  │                                              │  │
│  │  ┌─ 🐧 腾讯混元 ──────────────── [启用 ☐]─┐ │  │
│  │  │  Base URL:   [________________]         │ │  │
│  │  │  Secret ID:  [________________]         │ │  │
│  │  │  Secret Key: [________________]         │ │  │
│  │  │  模型:        [hunyuan-turbos  ▾]         │ │  │
│  │  │  🔗 测试连接                              │ │  │
│  │  │  ⚠️ 通过本地代理转换格式                  │ │  │
│  │  └────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────┘  │
│                                                  │
│  ┌─ 海外供应商 ────────────────────────────────┐  │
│  │                                              │  │
│  │  ┌─ 🌐 OpenRouter ────────────── [启用 ✓]─┐ │  │
│  │  │  Base URL:    [________________]       │ │  │
│  │  │  API Key:     [________________]       │ │  │
│  │  │  默认模型:     [________________]       │ │  │
│  │  │  🔗 测试连接                                │ │  │
│  │  └────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 4.4 折叠/展开策略

- 每个供应商卡片可折叠/展开（类似手风琴）
- 只展开一个卡片，选中其他卡片自动折叠前一个
- 已启用的供应商卡片左边显示彩色指示条
- 未配置的供应商卡片标题显示 "⚠️ 未配置" 灰色文字

## 5. 核心流程

### 5.1 供应商切换流程

```
用户在对话栏选择供应商（如从"火山引擎"切到"DeepSeek"）
    │
    ▼
app.js: 获取选中供应商 ID
    │
    ├─ 供应商 = "默认" → 使用 DEFAULT_CC_CONFIG 的 baseUrl/authToken/model
    │   → ccInvoke({ ..., providerId: null })
    │
    ├─ 供应商 = direct 类型（火山/DeepSeek）
    │   → ccInvoke({ ..., providerId: 'deepseek' })
    │   → main.js 读取 provider 配置，直接设置 SDK env
    │   → ANTHROPIC_BASE_URL = deepseek baseUrl
    │   → ANTHROPIC_AUTH_TOKEN = deepseek apiKey
    │   → ANTHROPIC_MODEL = deepseek model
    │
    └─ 供应商 = proxy 类型（腾讯/OpenRouter）
        → ccInvoke({ ..., providerId: 'openrouter', openRouterModel: selectedModel })
        → main.js 启动/复用 anthropic-proxy
        → 代理的 upstreamBaseUrl/apiKey 切换为对应供应商
        → ANTHROPIC_BASE_URL = localhost:3999
        → ANTHROPIC_AUTH_TOKEN = dummy
        → ANTHROPIC_MODEL = selectedModel
```

### 5.2 代理复用策略

现有 `anthropic-proxy.js` 只支持一个上游（OpenRouter）。需要改造为**支持动态切换上游**：

```javascript
// 改造方案：代理支持运行时切换上游
class AnthropicProxy {
  constructor() {
    this.upstream = null;  // 当前上游配置
  }

  // 动态切换上游（不重启代理）
  setUpstream({ baseUrl, apiKey, authType, extraHeaders }) {
    this.upstream = { baseUrl, apiKey, authType, extraHeaders };
  }

  // 请求翻译时使用当前上游
  async handleRequest(req, res) {
    const { baseUrl, apiKey, authType, extraHeaders } = this.upstream;
    // ... 翻译 + 转发 ...
  }
}
```

**优势**：代理只启动一次（端口 3999），切换供应商时无需重启代理，只需 `setUpstream()` 即可。

### 5.3 腾讯混元认证特殊处理

腾讯云 API 使用 TC3-HMAC-SHA256 签名认证，不是简单的 Bearer Token。代理需要增加腾讯签名逻辑：

```javascript
// anthropic-proxy.js 中增加腾讯签名支持
async function buildUpstreamHeaders(upstream, body) {
  if (upstream.authType === 'tencent') {
    // TC3-HMAC-SHA256 签名
    return signTC3(
      upstream.secretId,
      upstream.secretKey,
      body,
      'hunyuan',         // service
      'ap-beijing'       // region
    );
  }
  // 默认 Bearer 认证
  return {
    'Authorization': `Bearer ${upstream.apiKey}`,
    'Content-Type': 'application/json',
  };
}
```

**注意**：main.js 中已有 `signTC3()` 函数实现（用于 ADP 文件上传），可以复用。

### 5.4 模型列表获取

| 供应商 | 模型列表来源 | 方式 |
|--------|------------|------|
| 火山引擎 | 预设（`ark-code-latest`） | 硬编码，无 API 查询 |
| DeepSeek | 预设（`deepseek-chat` / `deepseek-reasoner`） | 硬编码 |
| 腾讯混元 | 预设（`hunyuan-turbos-latest` 等） | 硬编码 |
| OpenRouter | `GET /api/v1/models` | 动态拉取（已有实现） |

国内供应商模型少且固定，硬编码即可，无需动态拉取。

## 6. 改动清单

### 6.1 main.js

| 改动点 | 说明 |
|--------|------|
| 新增 `PROVIDER_REGISTRY` | 供应商注册表（含字段定义、env 映射、代理配置） |
| 新增 `getProviderConfig(providerId)` | 读取供应商配置 |
| 新增 `isProviderConfigured(providerId)` | 判断供应商是否已配置 |
| 新增 `getAvailableProviders()` | 获取已配置的供应商列表 |
| 改造 `cc:invoke` | 新增 `providerId` 参数，根据供应商类型设置 SDK env |
| 改造 `anthropic-proxy` | 支持 `setUpstream()` 动态切换上游 |
| 改造 `cc:get-config` | 返回所有供应商配置状态 |
| 改造 `cc:set-config` | 支持按供应商保存配置 |
| 新增 IPC `cc:get-providers` | 返回可用供应商列表（含配置状态） |
| 新增 IPC `cc:test-provider` | 测试指定供应商连接 |

### 6.2 preload.js

| 改动点 | 说明 |
|--------|------|
| 新增 `ccGetProviders` | 获取供应商列表 |
| 新增 `ccTestProvider` | 测试供应商连接 |
| `ccInvoke` 新增 `providerId` 参数 | 传递选中供应商 |

### 6.3 app.js

| 改动点 | 说明 |
|--------|------|
| 新增供应商选择器初始化 | `_initProviderSelector()` — 填充已配置供应商 |
| 改造模型选择器 | `_initModelSelector()` — 根据选中供应商动态加载模型 |
| 改造 `sendAIMessage` | 传递 `providerId` 到 `ccInvoke` |
| 新增设置面板渲染 | `_renderProviderSettings()` — 按供应商注册表动态渲染配置表单 |
| 新增供应商测试连接 | `_testProviderConnection(providerId)` |
| 保存配置改造 | 按供应商独立保存 |

### 6.4 index.html

| 改动点 | 说明 |
|--------|------|
| 对话栏新增供应商下拉框 | `#ccProviderSelect` — 在模型选择器之前 |
| 设置面板重构 | 按"基础配置"+"国内供应商"+"海外供应商"分区 |
| 供应商卡片模板 | 可折叠的供应商配置卡片 |

### 6.5 main.css

| 改动点 | 说明 |
|--------|------|
| 供应商选择器样式 | 下拉框 + 分组标题 + 状态指示 |
| 供应商卡片样式 | 折叠/展开、启用开关、彩色指示条 |
| 设置面板分区样式 | 国内/海外的分隔线和标题 |

### 6.6 anthropic-proxy.js

| 改动点 | 说明 |
|--------|------|
| 新增 `setUpstream()` | 动态切换上游配置（baseUrl/apiKey/authType） |
| 新增腾讯签名支持 | `authType: 'tencent'` 时使用 TC3-HMAC-SHA256 签名 |
| 上游 header 注入 | 支持自定义 header（OpenRouter 归因 header 等） |

## 7. 兼容性策略

### 7.1 向后兼容

- **默认配置不变**：不选择供应商时，使用 `DEFAULT_CC_CONFIG`（火山引擎 Coding Plan），与现有行为完全一致
- **旧设置迁移**：读取配置时检测旧格式（`cc_auth_token` / `cc_openrouter_api_key` 等），自动迁移到新格式（`cc_provider_volcano_authToken` / `cc_provider_openrouter_apiKey`）
- **旧 IPC 不变**：`cc:invoke` 的 `providerId` 参数可选，不传时走默认逻辑

### 7.2 迁移逻辑

```javascript
function migrateOldConfig() {
  // 火山引擎：旧 cc_auth_token → 新 cc_provider_volcano_authToken
  if (getSetting('cc_auth_token') && !getSetting('cc_provider_volcano_authToken')) {
    setSetting('cc_provider_volcano_authToken', getSetting('cc_auth_token'));
    setSetting('cc_provider_volcano_baseUrl', getSetting('cc_base_url') || DEFAULT_CC_CONFIG.baseUrl);
    setSetting('cc_provider_volcano_model', getSetting('cc_model') || DEFAULT_CC_CONFIG.model);
    setSetting('cc_provider_volcano_enabled', 'true');
  }
  // OpenRouter：旧 cc_openrouter_api_key → 新 cc_provider_openrouter_apiKey
  if (getSetting('cc_openrouter_api_key') && !getSetting('cc_provider_openrouter_apiKey')) {
    setSetting('cc_provider_openrouter_apiKey', getSetting('cc_openrouter_api_key'));
    setSetting('cc_provider_openrouter_baseUrl', getSetting('cc_openrouter_base_url') || 'https://openrouter.ai/api/v1');
    setSetting('cc_provider_openrouter_defaultModel', getSetting('cc_openrouter_default_model') || '');
    setSetting('cc_provider_openrouter_enabled', 'true');
  }
}
```

## 8. 供应商对比

| 维度 | 火山引擎 | DeepSeek | 腾讯混元 | OpenRouter |
|------|---------|----------|---------|------------|
| 地域 | 国内 | 国内 | 国内 | 海外 |
| 接入方式 | 直连 | 直连 | 代理 | 代理 |
| 延迟 | 低 | 低 | 低 | 高 |
| 工具调用 | ✅ 原生支持 | ✅ 原生支持 | ⚠️ 需验证 | ✅ 已验证 |
| 思考链 | ❌ | ✅ Reasoner | ⚠️ 需验证 | 按模型 |
| Skill/MCP | ✅ | ✅ | ✅ | ✅ |
| 会话恢复 | ✅ | ✅ | ✅ | ✅ |
| 模型数量 | 1 | 2 | ~5 | 数百 |
| 认证方式 | Auth Token | API Key | TC3 签名 | Bearer Token |
| 额外依赖 | 无 | 无 | 无 | 无 |
| 配置复杂度 | 低 | 低 | 中 | 低 |

## 9. 开发计划

| 阶段 | 内容 | 预估工时 | 优先级 |
|------|------|----------|--------|
| P1 | Provider Registry + 配置存储 + 迁移逻辑 | 2h | 高 |
| P2 | `cc:invoke` 改造支持 `providerId` | 1h | 高 |
| P3 | 设置面板 UI 重构（供应商卡片） | 2h | 高 |
| P4 | 对话栏供应商选择器 | 1h | 高 |
| P5 | 代理 `setUpstream()` 动态切换 | 1h | 中 |
| P6 | 腾讯混元 TC3 签名集成 | 1h | 低 |
| P7 | DeepSeek 供应商集成 | 0.5h | 中 |
| P8 | 测试 + 边界处理 | 1.5h | 高 |
| **合计** | | **~10h** | |

### 建议开发顺序

1. **先做 P1-P4**（直连供应商）：火山引擎 + DeepSeek，不改代理，快速上线
2. **再做 P5-P6**（代理供应商）：腾讯混元，改造代理支持动态上游
3. **最后 P8**：全量测试

## 10. 风险与缓解

| 风险 | 影响 | 缓解方案 |
|------|------|----------|
| DeepSeek Anthropic 端点不完全兼容 | 工具调用失败 | 先测试工具调用功能，文档标注兼容性 |
| 腾讯混元不支持 function calling | Agent Loop 报错 | 设置面板标注"实验性支持"，前端提示 |
| 代理动态切换上游有竞态 | 请求发到错误上游 | 加锁：切换上游时等待当前请求完成 |
| 旧配置迁移失败 | 用户配置丢失 | 迁移前备份，迁移后验证，失败回滚 |
| 多供应商同时配置 | 用户混淆 | 默认选中上次使用的供应商，保存到 localStorage |
