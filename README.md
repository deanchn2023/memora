# 忆境 Memora

> AI 驱动的个人记忆与事项管理助手 — 让每一次灵感与待办，都不再遗忘

## 产品简介

**忆境 Memora** 是一款基于 Electron 的桌面客户端，通过 AI 智能分析剪贴板内容，自动识别待办事项、提取结构化记忆，帮助用户高效管理日常任务与信息。

### 核心特性

- **智能剪贴板监听**：自动分析复制的文本，识别待办事项并创建任务
- **AI 记忆系统**：从日常信息中提取瞬时/短期/长期记忆，构建个人知识图谱
- **智能记事本**：自动分类保存笔记，支持一键转为待办或提炼记忆
- **番茄钟**：25分钟专注工作 + 5分钟短休息，任务关联追踪
- **日历视图**：日/周/月视图，可视化任务安排
- **AI 助手**：集成腾讯云 ADP，提供智能对话能力
- **系统日历同步**：任务自动同步到 macOS 日历

### 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 28 |
| 前端 | 原生 HTML/CSS/JavaScript |
| AI 引擎 | DeepSeek API (兼容 OpenAI SDK) |
| 智能体 | 腾讯云 ADP (WebSocket) |
| 数据存储 | localStorage (任务) + JSON 文件 (记忆/笔记/设置) |
| 系统集成 | macOS AppleScript (日历) |

## 快速开始

### 安装依赖

```bash
npm install --registry=https://registry.npmmirror.com
```

### 开发运行

```bash
npm start
```

### 构建

```bash
# macOS
npm run build:mac

# Windows
npm run build:win

# Linux
npm run build:linux
```

## 项目结构

```
Memora/
├── main.js                 # Electron 主进程（剪贴板监听、AI调用、IPC）
├── preload.js              # 预加载脚本（安全桥接）
├── resources/
│   └── icon.svg            # 应用图标
├── src/
│   ├── index.html          # 主页面
│   ├── styles/
│   │   ├── main.css        # 全局样式与布局
│   │   └── components.css  # 组件样式
│   └── scripts/
│       ├── app.js          # 应用主控制器
│       ├── store.js        # 任务数据存储 (localStorage)
│       ├── pomodoro.js     # 番茄钟模块
│       ├── calendar.js     # 日历视图渲染
│       ├── reminder.js     # 提醒服务
│       ├── memory.js       # 记忆系统存储 (Node.js 模块)
│       └── notebook.js     # 记事本系统 (Node.js 模块)
└── package.json
```

## 功能模块

### 1. 剪贴板智能分析

- 每 10 秒轮询剪贴板变化
- 预分类器过滤无效内容（URL、代码、纯链接等）
- AI 深度分析：识别待办事项 + 提取有效信息
- 高置信度(≥90%)自动弹出建议，中置信度(≥70%)静默候选

### 2. 记忆系统

三层记忆架构：
- **瞬时记忆**（5分钟~1小时）：当前工作上下文
- **短期记忆**（1天~7天）：近期关注、项目、人物
- **长期记忆**（数月）：长期目标、核心兴趣、重要关系

支持内容分类：任务/兴趣/人物/项目/目标/知识/行动

### 3. AI 助手

- 集成腾讯云 ADP 智能体平台
- WebSocket 实时流式对话
- 预设快捷问题，快速获取信息

### 4. API 配置

- 内置 DeepSeek API Key（每日10次限制）
- 支持自定义 API Key（无限制）
- 可配置模型、地址、每日调用上限

## 配置说明

所有配置通过设置界面管理，存储在 Electron userData 目录：

| 配置项 | 存储位置 | 说明 |
|--------|---------|------|
| API Key | settings.json | DeepSeek API 密钥 |
| ADP AppKey | settings.json | 腾讯云 ADP 应用密钥 |
| AI Prompt | settings.json | 任务识别/记忆提取 Prompt |
| 任务数据 | localStorage | 任务列表与状态 |
| 记忆数据 | memory/memories.json | 结构化记忆 |
| 笔记数据 | notebook/notes.json | 记事本内容 |

## 开发者

**Dean Chen** (朱从坤)

## 许可证

MIT License
