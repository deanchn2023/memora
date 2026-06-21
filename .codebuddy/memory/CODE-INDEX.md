# Memora 项目代码索引

> **使用说明**：告诉 AI "参考 CODE-INDEX" 或 "查看代码索引"，AI 就能直接定位代码，无需搜索。

---

## 文件结构概览

| 文件 | 大小 | 行数 | 主要职责 |
|-----|------|------|---------|
| `main.js` | 主进程 | ~18700 | IPC 处理、配置管理、AI 调用、剪切板监听 |
| `preload.js` | 预加载 | ~120 | contextBridge API 暴露 |
| `src/scripts/app.js` | 渲染进程 | ~10800 | UI 逻辑、事件处理、数据渲染 |
| `src/index.html` | 界面 | ~830 | HTML 结构、元素 ID |
| `src/styles/main.css` | 样式 | ~5500 | 主样式表 |

---

## main.js - 主进程

### 常量定义

| 常量/对象 | 行号 | 说明 |
|----------|------|------|
| `PROVIDER_REGISTRY` | 41 | 供应商注册表（火山引擎/DeepSeek/腾讯云/OpenRouter/Agent Plan） |
| `DEFAULT_CC_CONFIG` | 242 | M-Agent 模式默认配置 |
| `MAX_CLIPBOARD_HASHES` | 262 | 剪切板哈希记录上限 |
| `DEFAULT_API_KEY` | 404 | 默认 API Key |
| `DEFAULT_BASE_URL` | 405 | 默认 Base URL |
| `DEFAULT_MODEL` | 406 | 默认模型 |
| `DEFAULT_HIGHVOL_BASE_URL` | 409 | 高吞吐 Base URL |
| `DEFAULT_HIGHVOL_MODEL` | 410 | 高吞吐模型 |
| `DEFAULT_DAILY_LIMIT_FOR_BUILTIN_KEY` | 413 | 内置 Key 日限额 |
| `AI_CALLS_KEY` | 439 | AI 调用计数 Key |
| `AI_CALLS_DATE_KEY` | 440 | AI 调用日期 Key |
| `DEFAULT_AUTH_SERVERS` | 455 | 默认认证服务器配置 |
| `APP_VERSION` | 552 | 应用版本号 |
| `PROMPT_DIR` | 723 | Prompt 文件目录 |
| `SKILLHUB_CLI` | 4430 | SkillHub CLI 路径 |
| `EXEC_ENV` | 4431 | CLI 执行环境变量 |

### PROVIDER_REGISTRY 供应商 @ 41-171

| 供应商ID | 名称 | 类型 | 区域 | 说明 |
|---------|------|------|------|------|
| `volcano` | 火山引擎 Coding Plan | direct | cn | Doubao-Seed-1.6-Vision |
| `deepseek` | DeepSeek | direct | cn | DeepSeek-V3.1 |
| `tencent` | 腾讯云 Coding Plan | direct | cn | Hunyuan-T1 |
| `openrouter` | OpenRouter | proxy | global | 多模型代理 |
| `volcano_agent` | 火山引擎 Agent Plan | direct | cn | 多模态+Harness |

### 重要函数

| 函数名 | 行号 | 说明 |
|-------|------|------|
| `getProviderConfig` | 174 | 读取供应商配置 |
| `isProviderConfigured` | 186 | 判断供应商是否已配置 |
| `getAvailableProviders` | 196 | 获取所有供应商列表 |
| `loadClaudeAgentSDK` | 226 | 异步加载 Claude Agent SDK |
| `getGlobalAIMode` | 418 | 获取全局 AI 模式 |
| `setGlobalAIMode` | 429 | 设置全局 AI 模式 |
| `getAPIConfig` | 1012 | 获取 API 配置 |
| `getHighVolLLMConfig` | 1063 | 获取高吞吐 LLM 配置 |
| `createWindow` | 1487 | 创建主窗口 |
| `createTray` | 1564 | 创建系统托盘 |
| `initClipboardWatcher` | 1603 | 初始化剪切板监听 |
| `getCCConfig` | 3327 | 获取 CC 配置 |
| `getConnectors` | 3964 | 获取连接器 |
| `saveConnectors` | 3970 | 保存连接器 |
| `getSkillsDir` | 4041 | 获取技能目录 |
| `_execAsync` | 4433 | 异步执行命令（不阻塞主进程） |
| `_safeJsonParse` | 4465 | 安全 JSON 解析 |

### IPC 通道 (ipcMain.handle)

#### 通用工具类
| 通道名 | 行号 | 说明 |
|-------|------|------|
| `estimate-duration` | 2761 | 估算任务时长 |
| `analyze-task` | 2766 | 分析任务 |
| `ai-continue-writing` | 2827 | AI 续写 |
| `analyze-clipboard` | 2879 | 分析剪切板 |
| `optimize-clipboard-prompt` | 3103 | 优化剪切板 Prompt |

#### 日历/通知类
| 通道名 | 行号 | 说明 |
|-------|------|------|
| `add-to-calendar` | 3151 | 添加到日历 |
| `remove-from-calendar` | 3156 | 从日历移除 |
| `show-notification` | 3161 | 显示系统通知 |
| `window:get-focus-state` | 3167 | 获取窗口焦点状态 |
| `window:flash-attention` | 3191 | 闪烁窗口吸引注意 |
| `window:focus` | 3210 | 聚焦窗口 |

#### 剪切板类
| 通道名 | 行号 | 说明 |
|-------|------|------|
| `clipboard:start` | ~1700 | 启动剪切板监听 |
| `clipboard:stop` | ~1750 | 停止剪切板监听 |
| `clipboard:get-stats` | ~1800 | 获取剪切板统计 |

#### AI 调用类
| 通道名 | 行号 | 说明 |
|-------|------|------|
| `cc:invoke` | 4560 | 核心 AI 调用（最重要的 IPC） |
| `ark:get-afp-usage` | 4335 | Agent Plan AFP 用量查询 |

#### Skill 管理类
| 通道名 | 行号 | 说明 |
|-------|------|------|
| `skill:upload` | 4043 | 上传 Skill（zip 解压） |
| `skill:list-with-status` | 4096 | 获取已上传 Skill 列表（带安装状态） |
| `skill:install-to-cc` | 4180 | 安装 Skill 到 CC |
| `skill:uninstall-from-cc` | 4200 | 从 CC 卸载 Skill |
| `skill:import-from-workdir` | 4220 | 从 CC 工作目录导入 Skill |
| `skill:delete-from-workdir` | 4240 | 从工作目录删除 Skill |
| `skill:delete` | 4250 | 删除 Skill |
| `skill:detail` | 4300 | 获取 Skill 详情（SKILL.md 内容） |

#### SkillHub 市场类
| 通道名 | 行号 | 说明 |
|-------|------|------|
| `skillhub:check` | 4434 | 检查 CLI 是否安装 |
| `skillhub:install-cli` | 4440 | 安装 CLI |
| `skillhub:search` | 4470 | 搜索市场技能 |
| `skillhub:install` | 4490 | 安装市场技能 |
| `skillhub:list` | 4521 | 列出已安装技能 |
| `skillhub:uninstall` | 4552 | 卸载市场技能 |

#### 连接器管理类
| 通道名 | 行号 | 说明 |
|-------|------|------|
| `connector:list` | ~3980 | 获取连接器列表 |
| `connector:add` | ~3990 | 添加连接器 |
| `connector:update` | ~4000 | 更新连接器 |
| `connector:delete` | ~4010 | 删除连接器 |
| `connector:test` | ~4020 | 测试连接器 |

#### 用户画像类
| 通道名 | 行号 | 说明 |
|-------|------|------|
| `profile:get` | ~1400 | 获取用户画像 |
| `profile:update` | ~1420 | 更新用户画像 |

#### 知识图谱类
| 通道名 | 行号 | 说明 |
|-------|------|------|
| `knowledge:build-graph` | ~11700 | 构建知识图谱 |
| `knowledge:query` | ~11800 | 查询知识图谱 |

---

## preload.js - 预加载脚本

### 暴露的 API (window.electronAPI)

| API 名 | 行号 | 对应 IPC | 说明 |
|-------|------|---------|------|
| `profileGet` | ~30 | `profile:get` | 获取用户画像 |
| `profileUpdate` | ~31 | `profile:update` | 更新用户画像 |
| `getSetting` | ~35 | `settings:get` | 获取设置 |
| `setSetting` | ~36 | `settings:set` | 设置设置 |
| `openExternal` | ~40 | `shell:open-external` | 打开外部链接 |
| `ccInvoke` | ~50 | `cc:invoke` | AI 调用 |
| `skillListWithStatus` | ~60 | `skill:list-with-status` | Skill 列表 |
| `skillUpload` | ~61 | `skill:upload` | 上传 Skill |
| `skillInstallToCC` | ~62 | `skill:install-to-cc` | 安装到 CC |
| `skillUninstallFromCC` | ~63 | `skill:uninstall-from-cc` | 从 CC 卸载 |
| `skillDelete` | ~64 | `skill:delete` | 删除 Skill |
| `skillDetail` | ~65 | `skill:detail` | Skill 详情 |
| `skillhubCheck` | ~70 | `skillhub:check` | 检查 CLI |
| `skillhubInstallCli` | ~71 | `skillhub:install-cli` | 安装 CLI |
| `skillhubSearch` | ~72 | `skillhub:search` | 搜索市场 |
| `skillhubInstall` | ~73 | `skillhub:install` | 安装市场技能 |
| `skillhubList` | ~74 | `skillhub:list` | 列出已安装 |
| `skillhubUninstall` | ~75 | `skillhub:uninstall` | 卸载市场技能 |
| `connectorList` | ~80 | `connector:list` | 连接器列表 |
| `connectorAdd` | ~81 | `connector:add` | 添加连接器 |
| `arkGetAFPUsage` | ~90 | `ark:get-afp-usage` | AFP 用量 |

---

## src/scripts/app.js - 渲染进程

### 核心方法

#### 初始化 & 事件
| 方法名 | 行号 | 说明 |
|-------|------|------|
| `bindEvents()` | ~600 | 绑定所有事件监听器 |
| `init()` | ~100 | 应用初始化 |
| `showToast()` | ~200 | 显示 Toast 提示 |
| `escapeHtml()` | ~250 | HTML 转义 |

#### Skill 管理
| 方法名 | 行号 | 说明 |
|-------|------|------|
| `_loadSkillList()` | 6081 | 加载 Skill 列表 |
| `_renderSkillList()` | 6092 | 渲染 Skill 卡片网格 |
| `_showSkillDetail()` | 6242 | 显示 Skill 详情弹窗 |
| `_initSkillDragDrop()` | 6375 | 初始化拖拽上传 |
| `_uploadSkill()` | 6050 | 上传 Skill |
| `_skillhubSearch()` | 6502 | 搜索 SkillHub 市场 |
| `_renderSkillHubCard()` | 6561 | 渲染 SkillHub 卡片 |
| `_skillhubInstallSkill()` | 6598 | 安装 SkillHub 技能 |
| `_skillhubUninstallSkill()` | 6629 | 卸载 SkillHub 技能 |
| `_refreshSkillHubInstalled()` | 6490 | 刷新已安装列表（带缓存） |

#### AI 助手
| 方法名 | 行号 | 说明 |
|-------|------|------|
| `showAIAssistantView()` | ~1500 | 显示 AI 助手视图 |
| `_sendCCMessage()` | ~2000 | 发送 CC 消息 |
| `_refreshCCSkillSelect()` | ~6400 | 刷新 CC Skill 下拉框 |
| `_getCCWorkdir()` | ~6390 | 获取 CC 工作目录 |

#### 连接器管理
| 方法名 | 行号 | 说明 |
|-------|------|------|
| `_loadConnectorList()` | 6658 | 加载连接器列表 |
| `_renderConnectorList()` | 6670 | 渲染连接器列表 |
| `_addConnector()` | 6700 | 添加连接器 |
| `_testConnector()` | 6750 | 测试连接器 |

#### 记忆管理
| 方法名 | 行号 | 说明 |
|-------|------|------|
| `loadMemories()` | ~8500 | 加载记忆列表 |
| `deleteMemory()` | ~8600 | 删除记忆 |
| `reorganizeMemory()` | ~8700 | 整理记忆 |

#### 知识图谱
| 方法名 | 行号 | 说明 |
|-------|------|------|
| `_buildKnowledgeGraph()` | ~9000 | 构建知识图谱 |
| `_renderGraph()` | ~9100 | 渲染图谱 |

---

## src/index.html - 界面结构

### 主要容器 ID

| ID | 行号 | 说明 |
|----|------|------|
| `skillContainer` | 760 | Skill 管理容器 |
| `skillGrid` | 778 | Skill 卡片网格 |
| `skillEmpty` | 779 | Skill 空状态 |
| `skillBody` | 777 | Skill 内容区 |
| `skillUploadBtn` | 771 | 上传按钮 |
| `skillFileInput` | 772 | 文件输入 |
| `skillhubGuide` | 790 | SkillHub 引导 |
| `skillhubSearchInput` | 800 | 搜索输入框 |
| `skillhubLimitSelect` | 805 | 每页数量选择 |
| `skillhubResults` | 811 | 搜索结果容器 |
| `skillhubInstallCliBtn` | 808 | 安装 CLI 按钮 |
| `connectorContainer` | 821 | 连接器容器 |
| `connectorBody` | 825 | 连接器列表 |
| `connectorAddBtn` | 823 | 添加连接器按钮 |

### Sub-panel 切换
| data-subpanel | 行号 | 说明 |
|--------------|------|------|
| `my-skills` | 765 | 我的技能面板 |
| `market` | 788 | SkillHub 市场面板 |
| `connectors` | 820 | 连接器管理面板 |

---

## src/styles/main.css - 样式表

### 关键样式类

| 类名 | 行号 | 说明 |
|-----|------|------|
| `.skill-container` | 4552 | Skill 容器布局 |
| `.skill-toolbar` | 4556 | 工具栏 |
| `.skill-grid` | 4563 | Skill 卡片网格 |
| `.skill-card` | 4570 | Skill 卡片 |
| `.skill-card-header` | 4580 | 卡片头部 |
| `.skill-card-name` | 4585 | 卡片名称 |
| `.skill-card-desc` | 4590 | 卡片描述 |
| `.skill-card-actions` | 4595 | 卡片操作按钮 |
| `.skill-source-badge` | 4600 | 来源标签 |
| `.skill-status-badge` | 4610 | 状态标签 |
| `.skill-detail-overlay` | 4620 | 详情弹窗遮罩 |
| `.skill-detail-modal` | 4625 | 详情弹窗 |
| `.skill-detail-header` | 4635 | 详情头部 |
| `.skill-detail-body` | 4645 | 详情内容 |
| `.skill-detail-footer` | 4655 | 详情底部 |
| `.skillhub-guide` | 5343 | SkillHub 引导 |
| `.skillhub-grid` | 5417 | SkillHub 卡片网格 |
| `.skillhub-card` | 5425 | SkillHub 卡片 |
| `.skill-drag-active` | 4618 | 拖拽激活态 |

---

## src/mcp/ - MCP Server

### 文件列表

| 文件 | 说明 |
|-----|------|
| `mcp-base.js` | MCP Server 基类（JSON-RPC over stdio） |
| `doubao-search-server.js` | 豆包搜索 MCP Server |
| `ark-multimodal-server.js` | 多模态生成 MCP Server |

### doubao-search-server.js 工具
- `web_search` - 联网搜索

### ark-multimodal-server.js 工具
- `generate_image` - 生成图片
- `generate_video` - 生成视频

---

## 常用代码模式

### 添加新的 IPC 通道
```javascript
// main.js
ipcMain.handle('channel:name', async (event, params) => {
  // 处理逻辑
  return { success: true, data };
});

// preload.js
channelName: (params) => ipcRenderer.invoke('channel:name', params),

// app.js
const result = await window.electronAPI?.channelName?.(params);
```

### 添加新的 Skill 来源
```javascript
// main.js - 在 skill:list-with-status 中添加来源检测
// app.js - 在 _renderSkillList 中添加来源标签
// main.css - 添加对应的 .skill-source-badge 类
```

### 添加新的供应商
```javascript
// main.js - 在 PROVIDER_REGISTRY 中添加配置
// preload.js - 如需新的 API，暴露对应方法
// app.js - 在设置页面添加供应商选择 UI
```

---

## 快速定位指南

| 需求 | 查找位置 |
|-----|---------|
| 修改 AI 调用逻辑 | main.js @ 4560 (cc:invoke) |
| 修改 Skill 列表渲染 | app.js @ 6092 (_renderSkillList) |
| 修改 SkillHub 搜索 | app.js @ 6502 (_skillhubSearch) |
| 修改 Skill 详情弹窗 | app.js @ 6242 (_showSkillDetail) |
| 添加新的 IPC 通道 | main.js @ 末尾 或 preload.js |
| 修改供应商配置 | main.js @ 41-171 (PROVIDER_REGISTRY) |
| 修改 MCP Server | src/mcp/*.js |
| 修改样式 | src/styles/main.css |

---

*最后更新: 2026-06-21*
