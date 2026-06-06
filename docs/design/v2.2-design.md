# Memora 功能设计文档 v2.2

## 一、ADP 小助手 - 生成周报功能

### 1.1 功能概述

在 AI 助手的快捷问题胶囊（`task` 分类）中新增「📋 生成周报」按钮，点击后自动收集本周任务数据，通过 ADP 智能体生成结构化周报。

### 1.2 用户交互流程

```
用户点击「📋 生成周报」
    ↓
前端自动收集本周数据：
  - 本周任务列表（Store.getTasksByWeek）
  - 已完成 / 未完成 / 进行中任务统计
  - 番茄钟专注时长汇总
  - 记事本本周笔记摘要（可选）
    ↓
构造 prompt 发送给 ADP（走 sendADPMessage SSE 流式）
    ↓
ADP 流式输出周报内容（Markdown 格式）
    ↓
完成后显示：
  - 📋 周报标题
  - 周报正文（Markdown 渲染）
  - 操作按钮：[复制] [保存到笔记]
```

### 1.3 数据收集逻辑

```javascript
// 前端构造的上下文数据
{
  period: "2026-06-01 ~ 2026-06-07",
  stats: {
    total: 15,          // 本周任务总数
    completed: 8,       // 已完成
    inProgress: 3,      // 进行中
    pending: 4,         // 未开始
    focusMinutes: 320   // 番茄钟专注总时长（分钟）
  },
  tasks: [
    {
      title: "完成ADP技术方案",
      priority: "high",
      status: "completed",
      dueDate: "2026-06-03",
      tags: ["工作"],
      actualDuration: 120  // 实际耗时（分钟）
    },
    // ...更多任务
  ],
  highlights: []   // 高优先级/重要完成的任务单独标注
}
```

### 1.4 ADP Prompt 设计

```
你是一个周报生成助手。根据用户本周的工作数据，生成一份专业的周报。

要求：
1. 用 Markdown 格式输出
2. 包含以下结构：
   - 📊 本周概览（一句话总结 + 关键数据）
   - ✅ 已完成事项（按优先级排列，标注标签）
   - 🔄 进行中事项（进展描述）
   - ⏳ 待推进事项（下周重点）
   - 💡 本周洞察（从任务数据中提炼的工作模式/建议）
3. 语言简洁专业，避免空话套话
4. 如果有高优先级任务未完成，需要特别提醒
```

### 1.5 代码改动点

| 文件 | 改动 |
|------|------|
| `src/scripts/app.js` | `_switchQuickQuestions` 的 `task` 分类中新增「📋 生成周报」胶囊；新增 `generateWeeklyReport()` 方法 |
| `src/scripts/app.js` | `generateWeeklyReport()` 收集 Store 数据 → 构造 prompt → 调用 `sendADPMessage` |
| `src/scripts/app.js` | `handleAgentAction` 新增 `save-report-to-note` 操作 |

### 1.6 不走 Agent，走 ADP 的原因

周报生成是长文本创作任务，ADP 的 SSE 流式体验更好（实时看到周报逐步生成），且不需要本地 Agent 的意图分类。直接 `sendADPMessage` 即可。

---

## 二、文档视图 - 本地文档标签

### 2.1 功能概述

在「文档」视图的分类标签栏中新增「💻 本地文档」标签，展示用户本地文件目录的文档，支持按目录分类、时间筛选、文件类型筛选和关键词搜索。

### 2.2 架构设计

```
┌─────────────────────────────────────────────────┐
│ 文档视图                                         │
├─────────────────────────────────────────────────┤
│ [📄 文档] [💼 案例] [🎮 Demo] [📚 学习] [💻 本地] │ ← 新增标签
├─────────────────────────────────────────────────┤
│ 本地文档视图：                                    │
│ ┌───────────────────────────────────────────┐   │
│ │ 🔍 搜索本地文件...  [🔄 刷新索引]         │   │
│ ├───────────────────────────────────────────┤   │
│ │ 目录导航（Apple 分段控件）：               │   │
│ │ [🖥 桌面] [📥 下载] [📝 文档] [💻 代码]   │   │
│ │ [🎬 影片] [🖼 图片]                       │   │
│ ├───────────────────────────────────────────┤   │
│ │ 筛选条：                                   │   │
│ │ 时间：[今天|本周|本月|全部]                 │   │
│ │ 类型：[全部|PDF|Word|Excel|PPT|代码|图片...]│   │
│ ├───────────────────────────────────────────┤   │
│ │ 📊 索引状态：已索引 1,234 个文件 | 上次更新: 5分钟前 │
│ ├───────────────────────────────────────────┤   │
│ │ 文件列表：                                 │   │
│ │ ┌───────────────────────────────────┐     │   │
│ │ │ 📄 ADP技术方案.docx    3.2MB  2小时前│     │   │
│ │ │ 📊 Q2销售数据.xlsx     1.5MB  昨天  │     │   │
│ │ │ 📑 项目投标书.pdf      8.1MB  3天前  │     │   │
│ │ │ 🖼 截图2026-06-06.png  256KB 今天   │     │   │
│ │ └───────────────────────────────────┘     │   │
│ │ [加载更多...]                              │   │
│ └───────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### 2.3 核心模块设计

#### 2.3.1 后端：本地文件索引服务（main.js IPC）

```javascript
// IPC 接口设计
ipcMain.handle('local-files:index', async (event, { directories, forceRebuild }) => {
  // 扫描指定目录，建立文件索引
  // 存储到 localFileIndex（内存 + JSON 持久化）
  // 返回索引统计信息
});

ipcMain.handle('local-files:search', async (event, { 
  keyword, directory, timeRange, fileType, page, pageSize 
}) => {
  // 从索引中搜索文件
  // 支持关键词、目录、时间范围、文件类型筛选
  // 分页返回结果
});

ipcMain.handle('local-files:index-status', async () => {
  // 返回索引状态：文件总数、最后更新时间、各目录文件数
});

ipcMain.handle('local-files:open', async (event, filePath) => {
  // 用系统默认应用打开文件
  // shell.openPath(filePath)
});
```

#### 2.3.2 索引策略（性能优化）

```
索引策略：
1. 按目录增量索引：不是全盘扫描，按用户选的目录单独扫描
2. 延迟索引：首次打开「本地文档」时才开始索引
3. 增量更新：只扫描修改时间 > 上次索引时间的文件
4. 持久化：索引结果存为 JSON（userData/local-file-index.json）
5. 后台线程：用 Worker 或 child_process 避免阻塞 UI
6. 深度限制：默认只扫描 3 层子目录，避免扫描 node_modules 等
7. 忽略规则：自动忽略 .git, node_modules, .Trash, __pycache__ 等

索引数据结构：
{
  version: 1,
  lastUpdated: "2026-06-06T20:00:00Z",
  directories: {
    "~/Desktop": { lastScanned: "...", fileCount: 234 },
    "~/Downloads": { lastScanned: "...", fileCount: 567 },
    "~/Documents": { lastScanned: "...", fileCount: 890 }
  },
  files: [
    {
      path: "/Users/xxx/Desktop/ADP方案.docx",
      name: "ADP方案.docx",
      ext: "docx",
      size: 3355443,
      modifiedAt: "2026-06-06T18:30:00Z",
      directory: "~/Desktop",    // 归属目录标签
      type: "document"           // document | spreadsheet | presentation | image | video | code | archive | other
    }
  ]
}
```

#### 2.3.3 目录映射

```javascript
const DIRECTORY_MAP = {
  desktop: { label: '🖥 桌面', path: app.getPath('desktop') },
  downloads: { label: '📥 下载', path: app.getPath('downloads') },
  documents: { label: '📝 文档', path: app.getPath('documents') },
  pictures: { label: '🖼 图片', path: app.getPath('pictures') },
  movies: { label: '🎬 影片', path: app.getPath('movies') },
  home: { label: '🏠 主目录', path: app.getPath('home') },
};
```

#### 2.3.4 文件类型分类

```javascript
const FILE_TYPE_MAP = {
  document: { label: '文档', icon: '📄', exts: ['pdf','doc','docx','txt','rtf','odt','pages'] },
  spreadsheet: { label: '表格', icon: '📊', exts: ['xls','xlsx','csv','numbers'] },
  presentation: { label: '演示', icon: '📑', exts: ['ppt','pptx','key'] },
  image: { label: '图片', icon: '🖼', exts: ['jpg','jpeg','png','gif','webp','svg','heic'] },
  video: { label: '影片', icon: '🎬', exts: ['mp4','mov','avi','mkv','wmv'] },
  code: { label: '代码', icon: '💻', exts: ['js','ts','py','java','go','html','css','json','md'] },
  archive: { label: '压缩包', icon: '📦', exts: ['zip','rar','7z','tar','gz'] },
};
```

### 2.4 前端模块设计（localFiles.js）

```javascript
const LocalFiles = {
  currentDirectory: 'desktop',  // 当前目录标签
  currentTimeRange: 'all',      // today | week | month | all
  currentFileType: 'all',       // all | document | spreadsheet | ...
  keyword: '',
  page: 1,
  pageSize: 50,
  indexStatus: null,

  async onShow() { ... },           // 首次显示时触发索引
  async buildIndex(forceRebuild) { ... },  // 构建索引
  async searchFiles() { ... },      // 搜索/筛选文件
  renderDirectoryTabs() { ... },    // 渲染目录标签
  renderFilters() { ... },          // 渲染筛选条件
  renderFileList(files) { ... },    // 渲染文件列表
  renderIndexStatus() { ... },      // 渲染索引状态
  openFile(filePath) { ... },       // 打开文件
  revealInFinder(filePath) { ... }, // 在 Finder 中显示
};
```

### 2.5 文件卡片设计

```
┌──────────────────────────────────────┐
│ 📄  ADP技术方案v2.docx              │  ← 文件类型图标 + 文件名
│      文档 · 3.2MB · 2小时前          │  ← 类型 · 大小 · 修改时间
│      📁 桌面                         │  ← 归属目录
│                          [📂 打开]  │  ← 操作按钮
└──────────────────────────────────────┘
```

- 点击卡片：预览（图片/文本内联预览，其他类型用系统打开）
- 右键/长按：在 Finder 中显示、复制路径

### 2.6 搜索整合

当用户在文档视图顶部搜索框输入关键词时，**同时搜索在线文档和本地文件**，结果分两个区域展示：

```
搜索结果：
├── 📡 在线文档（3条）
│   ├── ADP 4.0 升级指南
│   └── ...
└── 💻 本地文件（2条）
    ├── ADP技术方案v2.docx
    └── ADP_demo.mp4
```

### 2.7 代码改动点

| 文件 | 改动 |
|------|------|
| `main.js` | 新增 IPC：`local-files:index`、`local-files:search`、`local-files:index-status`、`local-files:open` |
| `main.js` | 新增 `buildLocalFileIndex()` 索引构建函数 |
| `preload.js` | 暴露 `localFiles` API |
| `src/scripts/localFiles.js` | **新文件**：本地文件前端模块 |
| `src/styles/localFiles.css` | **新文件**：本地文件样式 |
| `src/scripts/documents.js` | 分类标签新增「本地」选项，切换到 LocalFiles 模块 |
| `src/index.html` | 文档视图中新增本地文件区域 DOM |
| `src/index.html` | 引入 localFiles.js 和 localFiles.css |

### 2.8 性能保障

| 场景 | 策略 |
|------|------|
| 首次索引慢 | 显示进度条 + 文件计数；后台 child_process 执行 |
| 目录文件过多 | 深度限制 3 层 + 忽略规则 + 单目录上限 5000 文件 |
| 搜索慢 | 内存索引 + 前端分页（每页 50 条） |
| 索引文件大 | 只存元数据（路径/名称/大小/修改时间），不存内容 |
| 刷新索引 | 增量更新（只扫描 modifiedAt > lastIndexTime 的文件） |

---

## 三、实现优先级

1. **P0 - 生成周报**：改动小，3 个文件，1 小时内可完成
2. **P1 - 本地文档标签**：涉及新模块 + IPC + 索引，需要 3-4 小时
