# 我的全部记忆汇总

> 生成时间：2026-06-02  
> 来源：CodeBuddy AI 记忆系统

---

## 目录

1. [端口分配规则与已注册系统](#1-端口分配规则与已注册系统)
2. [Apple Design 风格规范](#2-apple-design-风格规范)
3. [CRUD 公共功能规范](#3-crud-公共功能规范)
4. [CSS/JS/HTML 代码拆分规范](#4-cssjshtml-代码拆分规范)
5. [PptxGenJS 生成 PPT 规范](#5-pptxgenjs-生成-ppt-规范)
6. [CreativePPT 部署信息](#6-creativeppt-部署信息)
7. [AutoMind 架构原则](#7-automind-架构原则)
8. [ADP V2 SSE 前端对接经验](#8-adp-v2-sse-前端对接经验)
9. [报告长期存储方案（V2 文件系统方案）](#9-报告长期存储方案v2-文件系统方案)
10. [ADPToolkit 服务器部署信息](#10-adptoolkit-服务器部署信息)
11. [DeepSeek API 配置](#11-deepseek-api-配置)
12. [腾讯云 ADP 调用规范（HTTP SSE）](#12-腾讯云-adp-调用规范http-sse)
13. [StellarQS30 已完成功能清单](#13-stellarqs30-已完成功能清单)
14. [ADGraph Agent 聊天界面步骤进度条处理规范](#14-adgraph-agent-聊天界面步骤进度条处理规范)
15. [依赖安装国内镜像规范](#15-依赖安装国内镜像规范)
16. [Lighthouse 部署规范（StellarQS30）](#16-lighthouse-部署规范stellarqs30)

---

## 1. 端口分配规则与已注册系统

### 端口分配规则

- **前端 Web**: 3000-3999 段（每个系统 +1 递增）
- **API 后端**: 4000-4999 段（对应前端 +1000）
- **特殊服务**: 5000+ 段（数据库、Redis、Admin 面板等）
- 新建系统时必须查询此表避免端口冲突

### 已注册系统

#### CogniFrame（脚手架生成器）

| 项目 | 值 |
|------|-----|
| 名称 | CogniFrame - Enterprise Scaffold Generator |
| 定位 | 企业级全栈脚手架生成器（Monaco架构 × Apple Design） |
| 前端地址 | http://localhost:3000 |
| API 地址 | http://localhost:4000 |
| 启动命令 | `cd /Users/congkunzhu/CodeBuddy/CogniFrame && pnpm dev` |
| 登录邮箱 | admin@cogniframe.com |
| 登录密码 | Admin@2024! |
| 角色 | admin（无限 AI 调用额度） |
| 技术栈 | Next.js 15 + Fastify 5 + React 19 + PostgreSQL 16 + Drizzle ORM |
| Git 仓库 | /Users/congkunzhu/CodeBuddy/CogniFrame |
| 当前分支 | main |

#### StellarQS30（雅思智能学习系统）

| 项目 | 值 |
|------|-----|
| 名称 | StellarQS30 - IELTS Intelligent Learning System |
| 定位 | AI自适应雅思学习平台（阅读/听力/口语/写作） |
| 前端地址 | http://localhost:3001 (或静态文件直接访问) |
| API 地址 | http://localhost:4001 |
| 启动命令 | `cd /Users/congkunzhu/CodeBuddy/StellarQS30 && pnpm dev` |
| 数据库 | PostgreSQL ielts_learning_system (本地 congkunzhu:StellarQS30DB2024) |
| 技术栈 | Fastify + Drizzle ORM + vanilla HTML/JS/CSS |
| 服务器 | Lighthouse 121.5.164.126:3080 |
| Git 仓库 | /Users/congkunzhu/CodeBuddy/StellarQS30 |

### 已占用端口清单（禁止重复使用）

```
3000 - CogniFrame Web UI
3002 - CreativePPT
4000 - CogniFrame API Service
4001 - StellarQS30 API Service
3080 - StellarQS30 生产端口(Lighthouse)
4002 - StellarQS30 生产API端口(Lighthouse内部)
6379 - Redis (lidao-redis)
7890 - Vela Cloud
8080 - Mindemo App
```

---

## 2. Apple Design 风格规范

用户所有应用都采用 Apple Design Language 风格：

- **毛玻璃质感**: `backdrop-filter: blur(20px)` + 半透明白底
- **字体族**: SF Pro 字体族 (`-apple-system, BlinkMacSystemFont, "SF Pro Display"`)
- **边框**: 0.5px 超细线边框
- **阴影**: 多层微妙阴影模拟 macOS 窗口
- **字距**: 紧凑字距 `tracking-tight`
- **三级灰色体系**: `#1d1d1f` → `#86868b` → `#aeaeb2`
- **主色**: Apple Blue `#007AFF`
- **状态色**: 绿 `#34C759`、橙 `#FF9500`、红 `#FF3B30`
- **背景**: `#f5f5f7`
- **圆角**: 大圆角 `rounded-2xl/3xl`
- **动效**: Spring 弹性动效 `cubic-bezier(0.2, 0.8, 0.2, 1)`
- **渐变光球背景**
- **Hover 浮起效果**
- **Apple Segmented Control 分段控件**
- **留白**: 充裕内边距与留白
- **内容最大宽度**: 1200px
- **颜色比例 60-30-10**: 主色天空蓝/Apple蓝 60%，辅助色石板灰 30%，强调色琥珀黄 10%

---

## 3. CRUD 公共功能规范

用户要求在做任何 CRUD 功能时，自动包含以下公共功能，不需要每次提醒：

1. **数据库层面**：每条记录必须有 `created_at`（创建时间），更新类记录要有 `updated_at`
2. **时间显示**：页面展示相对时间（"X分钟前"），hover/title 显示完整日期时间（`YYYY-MM-DD HH:mm`）
3. **删除功能**：列表项必须有删除按钮（hover 显示或操作区域），删除前有确认弹窗
4. **空状态**：列表为空时显示空状态提示（图标+文字）
5. **加载状态**：数据加载中显示 skeleton 或 spinner
6. **操作反馈**：成功/失败都要有 toast 提示
7. **排序**：列表默认按创建时间倒序
8. **关联信息**：显示创建者名称、关联的项目/阶段等上下文信息
9. **自动保存**：AI 生成的结果自动保存到数据库并关联项目，不需要用户手动保存
10. **分页/加载更多**：数据量大时自动分页，不要一次加载全部

此清单适用于所有后续项目的所有 CRUD 功能开发。

---

## 4. CSS/JS/HTML 代码拆分规范

用户要求所有项目中 CSS、JavaScript、HTML 代码必须拆分为独立文件，不要写在同一个文件里。

- HTML 文件通过 `<link>` 引入 CSS
- 通过 `<script src>` 引入 JS
- 页面做到自适应屏幕大小，适配 PC 和移动端展示
- 这是长期偏好，适用于所有后续项目

---

## 5. PptxGenJS 生成 PPT 规范

基于踩坑经验总结的关键规范：

1. **必须先定义布局常量**：`LAYOUT_16x9 = 10"×5.625"`，用 `ZONE` 对象规划每个区域的 y 起止坐标和高度。头部区(~1.8")、内容区(~3.3")、底部 chips+footer(~0.5")。

2. **三栏布局公式**：`panelW=2.82, centerW=3.36, colGap=0.20` → 左0.22/中3.32/右6.84，确保总宽≤9.7（留边距）。

3. **元素不重叠原则**：中心图如果用 2x2 网格，hub 圆心必须在四卡片正中间间隙位置（`cx=cxBase+cw+gapX/2`），不能覆盖任何卡片。

4. **垂直边界检查**：任何元素的 `y+h ≤ SLIDE_H (5.625)`，底部 chips 在 `y≥5.12`，footer 在 `y≥5.40`。

5. **底部导航 chips 居中**：计算 `totalW = n*w + (n-1)*gap`，`startX = (SLIDE_W - totalW)/2`，确保不溢出。

6. **颜色不用 # 前缀**，`transparency` 用 0-100 整数，shadow 每次新建对象（不要复用）。

7. **addCard 辅助函数模式**：背景矩形 + 顶部彩色线(0.025高) + tag圆角矩形 + 标题 + 描述文字，保持一致。

8. **生成后用 markitdown 验证**：`python3 -m markitdown output.pptx` 检查文本完整性。

9. **字体统一 Arial**，中文无需特殊字体；`fontSize`: 标题20-24, 卡片标题12-13, 正文9-10, tag/chip 7-8, footer 7-8。

---

## 6. CreativePPT 部署信息

CreativePPT 已成功部署到 Lighthouse 服务器：

- **服务器**：`lhins-567ibr8m` (adpchatclient, 121.5.164.126, ap-shanghai, Ubuntu)
- **部署目录**：`/root/creativeppt_20260527191555`
- **服务端口**：3002
- **访问地址**：http://121.5.164.126:3002
- **管理后台**：http://121.5.164.126:3002/admin
- **PM2 进程名**：creativeppt
- **管理员账号**：test@bizdeck.com（第一个注册用户自动为管理员）

### 新增功能（2026-05-29 v2）

1. **标准模式（Standard）**：1.5积分/页，单次AI调用生成 PresentationData JSON，9种专业布局渲染（移植自 pptengine 引擎）
   - 9种布局：title_slide, section_header, bullet_list, two_columns, grid_cards, accent_stats, quote_slide, summary_slide, timeline_process
   - API: `POST /api/ppt/generate-standard`
   - 引擎文件：`js/standard-engine.js`

2. **模板合并（Mode2 完整实现）**：上传模板+目标两个PPTX，提取样式后AI重新映射
   - API: `POST /api/ppt/merge`
   - 解析器：`js/pptx-parser.js`（adm-zip 解析 PPTX XML 提取文本/颜色/字体）

3. **PPT美化（Mode3 完整实现）**：上传PPTX + 可选文字，AI重新设计排版
   - API: `POST /api/ppt/beautify`

### 品质模式对比

| 模式 | 积分/页 | 说明 |
|------|---------|------|
| Fast（快速） | 1 | outline→content→DesignEngine渲染 |
| Standard（标准） | 1.5 | AI一步生成PresentationData→StandardEngine渲染（9布局） |
| Pro（精致） | 2 | 多阶段AI管线→DesignEngine渲染（14布局） |

### 管理员后台功能（2026-05-29）

- Dashboard：用户数、文档数、Token消耗、质量分数、7天Token趋势、模式分布、阶段性能
- 生成任务：所有用户生成任务列表，按task_id分组查看
- 详细日志：每一步的输入/输出/Prompt/Token/耗时/QA结果，支持按阶段/模式/TaskID筛选
- 用户管理：所有用户列表，积分/文档/Token消耗统计
- Prompt 编辑：在线编辑 prompts/ 目录下所有 .md 文件，保存自动备份为 .bak，实时清除缓存
- 重新生成：自定义 Prompt 测试，支持 Pro/LLM/自定义模式
- 日志详情弹窗：查看完整输入输出和 Prompt，一键复制到重试

---

## 7. AutoMind 架构原则

AutoMind 是 Agent 原生系统，架构核心原则：

> 所有页面操作交互中需要 AI 的部分，都调用 ADP 智能体（而非直接调各 AI API），由 ADP 智能体来连接不同的 AI 能力（文生图、CFD仿真、市场洞察等）。系统只需要做好 MCP Server，ADP 通过 MCP Client 将所需的结果、数据、AI 能力提交进来即可。

即：**系统 = MCP Server（暴露工具/数据接口）+ ADP 智能体（AI 大脑）+ 前端（交互壳子）**

### 交互设计原则（2026-05-24 更新）

1. Studio 是核心操作页面（对话+快捷按钮+产出卡片），不是空白对话
2. 辅助页面做结果记录和后续查看：Gallery（设计库）、Lifecycle（生命周期）
3. 对话不是唯一入口，按钮/表单等传统交互也要有，让人一看就知道怎么操作
4. MCP 推送结果自动记录到数据库，辅助页面从数据库读取展示
5. 页面精简：Studio（/）、Gallery（/gallery）、Lifecycle（/lifecycle）、Login/Register

---

## 8. ADP V2 SSE 前端对接经验

关键陷阱与解决方案：

1. **进度指示器重复 ID**：旧对话 DOM 残留同 ID 元素 → `addProgressIndicator()` 先调用 `removeProgressIndicator()` 清除旧元素

2. **iframe sandbox 跨域**：缺少 `allow-same-origin` → `sandbox="allow-scripts allow-popups allow-forms allow-same-origin"`

3. **步骤详情无法展开**：`style="display:none"` 优先级高于 CSS class → 用 CSS class 控制 display

4. **text.replace 安全检查**：不能检查新文本长度>=旧文本，ADP 合法替换可能用短文本覆盖长文本

5. **Node.js 默认超时**：HTTP server 默认 72s keep-alive timeout，长工具调用断连 → `keepAliveTimeout:300000, requestTimeout:0`

6. **跨 chunk SSE 事件**：一个事件可能被拆到两个 chunk → buffer 缓冲拼接，`lines.pop()` 保留不完整行

7. **工具结果 JSON 混入文本**：ADP 在 `text.delta` 中夹杂 `{"content":[{"type":"text"...}]}` → 正则过滤

8. **AppKey 位置**：V2 接口 AppKey 必须在 Body（PascalCase），不在 Header/Query

---

## 9. 报告长期存储方案（V2 文件系统方案）

- HTML 文件按日期目录存储：`data/reports/2026-05/rpt_xxx.html`
- `reports.json` 只存元数据（`id, title, file_path, file_size, created_at`）
- **保存时**：HTML 写文件 + 元数据写 JSON
- **查看时**：`/api/reports/:id/view` 从文件系统读取 HTML 返回
- **下载时**：`/api/reports/:id/download` 带 `Content-Disposition attachment`
- **删除时**：同时删除文件和 JSON 记录
- **自动迁移**：读取列表时检测旧格式（html_content 在 JSON 中），自动迁移到文件系统

---

## 10. ADPToolkit 服务器部署信息

- **访问地址**：http://21.91.29.59:3000/index.html（前端入口）
- **服务运行在端口**：3000
- **服务目录**：/data/server/app.js
- **静态文件目录**：/data/toolkit/
- **PM2 进程管理**，`ecosystem.config.js` 配置在 `/data/ecosystem.config.js`
- **PM2 进程名**：adptoolkit
- **.env 文件**：/data/server/.env（`PORT=3000`）

---

## 11. DeepSeek API 配置

用户的 DeepSeek API 配置：

- **API Key**: `sk-b4116cb788d64e3fb20e8e5bd1333168`
- **Base URL**: `https://api.deepseek.com`（兼容 OpenAI SDK 格式）
- **可用模型**：
  - `deepseek-v4-flash`（非思考模式，适合常规文本解析）
  - `deepseek-v4-pro`（更强推理）
  - `deepseek-chat`（=deepseek-v4-flash非思考模式，将于 2026/07/24 弃用）
  - `deepseek-reasoner`（=deepseek-v4-flash思考模式，将于 2026/07/24 弃用）
- **Anthropic 兼容地址**：`https://api.deepseek.com/anthropic`
- 此 key 已写入项目 `.env` 文件，后续可直接使用 OpenAI SDK 调用

---

## 12. 腾讯云 ADP 调用规范（HTTP SSE）

### V1 接口

`POST https://wss.lke.cloud.tencent.com/v1/qbot/chat/sse`

- **Content-Type**: `application/json`
- **Body 字段（snake_case）**：`bot_app_key`（必填，AppKey 走 Body 不走 Header）、`session_id`（会话ID，2-64 长度，正则 `^[a-zA-Z0-9_-]{2,64}$`，建议 UUID）、`visitor_biz_id`（必填，访客ID）、`content`（消息内容）、`request_id`、`incremental`（增量）、`stream=enable`、`search_network`、`model_name`、`system_role`、`custom_variables`、`workflow_status`、`file_infos`
- **SSE 事件**：`reply`（payload.content 流式内容、is_final 是否完成、record_id、reply_method 1-19）、`token_stat`（token 消耗）、`reference`（引用来源 type 1=问答 2=文档 4=联网）、`error`（error.code/message）、`thought`（DeepSeek-R1 等思考事件）

### V2 接口

`POST https://wss.lke.cloud.tencent.com/adp/v2/chat`

- **字段为 PascalCase**：`AppKey`、`ConversationId`、`VisitorId`、`Contents`（数组：`{Type:"text"|"image"|"file", Text, Image:{Url}, File:{...}}`）、`RequestId`（32-64位）、`Incremental`、`Stream=enable`、`SystemRole`、`ModelName`、`SearchNetwork`、`StreamingThrottle`
- **SSE 事件**：`request_ack`、`response.created`、`response.processing`、`message.added`、`content.added`、`text.delta`（增量文本）、`text.replace`（替换）、`message.done`、`response.completed`、`quote_info.added`、`reference.added`、`error`、`done`（[DONE] 结束标记）

### 鉴权

AppKey 必须放在 Body 中（V1 字段名 `bot_app_key`，V2 字段名 `AppKey`），不放 Header/Query。AppKey 务必从环境变量读取（如 `ADP_APP_KEY`），不要硬编码。

### 关键错误码

| 错误码 | 说明 |
|--------|------|
| 400 | 参数错误 |
| 460004 | 应用不存在 |
| 460011 | 模型 QPM 超限 |
| 460031 | 应用 QPS 超限 |
| 460034 | 输入过长 |
| 4505004 | APPKEY 无效 |

### 支持模型

- `Hunyuan/hunyuan-turbos`
- `hunyuan-t1`
- `Deepseek/deepseek-v3.1`
- `deepseek-r1-250528`
- `Youtu/youtu-mrc-pro`
- `TCADP/glm-5`
- `TCADP/kimi-k2.5`

### 最佳实践

构建通用 ADP SSE 客户端方法，封装：requests/httpx + `stream=True` 解析 SSE，按 event 名称分发回调（`on_text`、`on_done`、`on_error`、`on_reference`、`on_thought`），支持流式增量与完整文本两种返回模式，自动管理 `session_id`（同一用户复用 UUID 实现多轮）。

---

## 13. StellarQS30 已完成功能清单

1. ✅ **阅读模块**：OpenClaw出题API、AI批改、知识点追踪、`reading_progress`表精确进度跟踪
2. ✅ **知识点掌握系统**：`knowledge_mastery`表、各模块自动记录、错题自动提取词汇知识点
3. ✅ **周报系统**：AI生成周报、知识点掌握统计、易错知识点分组(weak-points API)
4. ✅ **写作模块**：Task1/Task2独立草稿暂存、计时确认弹窗、暂停/继续计时、60分钟时间到提醒、任务状态徽标、语音一句话识别输入
5. ✅ **口语模块**：录音后自动AI评分、AI样例素材生成、腾讯云ASR录音文件识别、识别文本展示+可编辑纠正、纠错后重新评分
6. ✅ **词汇提取**：阅读答错时自动提取关键词汇记录为知识点
7. ✅ **腾讯云语音识别集成**：口语用录音文件识别、写作用一句话识别
8. ✅ **付费资源限流**：AI半小时10次、ASR半小时100次、OCR半小时20次
9. ✅ **AI学习顾问总结**：生成/保存/查看历史总结，五维雷达图
10. ✅ **首页Hero区域替换为每日名言**
11. ✅ **阅读专注度检测**：摄像头录制视频、可下载、同步开启选项
12. ✅ **易错知识页面**：薄弱知识点汇总、按模块/掌握程度筛选、近期错题参考
13. ✅ **每日单词页面**：中心词扩展记忆法、间隔重复复习、AI生成学习计划、四视图（学习/复习/计划/词库）、测试系统
14. ✅ **易错知识AI总结**：`POST /api/student/weak-points/ai-summary`，分析薄弱知识点生成学习建议
15. ✅ **基于易错知识点生成阅读文章**：`POST /api/reading/generate-from-weak-points`，针对性强化练习

### 新增数据库表

- `vocabulary_words`（词汇库）
- `vocabulary_plans`（学习计划）
- `vocabulary_progress`（学习进度/间隔重复）
- `vocabulary_quiz_results`（测试记录）

### 新增 API 端点

- `GET /api/vocabulary/plan` - 获取当前计划
- `POST /api/vocabulary/generate-plan` - AI生成学习计划
- `GET /api/vocabulary/daily` - 获取今日单词（支持date参数导航）
- `POST /api/vocabulary/generate-daily` - AI生成今日单词
- `GET /api/vocabulary/review` - 获取复习单词
- `GET /api/vocabulary/wordbank` - 获取词库
- `POST /api/vocabulary/submit` - 提交练习结果
- `POST /api/student/weak-points/ai-summary` - AI总结易错知识点
- `POST /api/reading/generate-from-weak-points` - 基于薄弱知识点生成阅读文章

---

## 14. ADGraph Agent 聊天界面步骤进度条处理规范

1. 不要在 `startAssistantMessage()` 中折叠进度区域——工具步骤可能还在继续添加
2. 折叠应在 `finishAssistantMessage()` 中执行，确保所有步骤完成
3. `addProgressStep()` 中检测进度区域是否已折叠，若已折叠则动态更新标题计数
4. `collapseProgressIndicator()` 中用实际 DOM 步骤数（`querySelectorAll('.agent-progress-step').length`）而非 `toolStepCount` 变量
5. 展开/折叠点击时动态更新标题文字（折叠显示"已完成N个步骤"，展开显示"智能体处理中"）
6. 这确保"已完成 N 个步骤"始终与实际显示的步骤数量一致

---

## 15. 依赖安装国内镜像规范

用户要求安装依赖包时必须使用国内镜像源：

- **Python**：用清华镜像 `https://pypi.tuna.tsinghua.edu.cn/simple`
- **npm**：用淘宝镜像 `https://registry.npmmirror.com`
- 安装时要有进度显示，不要静默安装（pip 不加 `-q`，npm 不加 `--silent`）

---

## 16. Lighthouse 部署规范（StellarQS30）

StellarQS30 服务器部署必须使用腾讯云 Lighthouse 集成，不要换其他方式（scp/base64/GitHub API等都不可靠）。

### Lighthouse 连接信息

- **地域**：ap-shanghai
- **实例ID**：lhins-567ibr8m
- **实例名**：adpchatclient
- **公网IP**：121.5.164.126
- **系统类型**：Linux (Ubuntu)

### 部署流程

1. 使用 `deploy_project_preparation` 上传本地文件到服务器（FolderPath 指向需要部署的目录，如 `/Users/congkunzhu/CodeBuddy/StellarQS30/apps/web/public`）
2. 文件会传到服务器 `/root/public_XXXXXXXX/` 目录
3. 使用 `execute_command` 执行 docker cp 将文件复制到容器：`docker cp /root/public_XXXXXXXX/文件名 stellarqs30:/app/apps/web/public/文件名`
4. 更新 HTML 缓存版本号：`docker exec stellarqs30 sed -i 's/旧版本/新版本/g' /app/apps/web/public/xxx.html`
5. 重载 nginx：`docker exec stellarqs30 nginx -s reload`
6. 容器名：`stellarqs30`，容器内 web 路径：`/app/apps/web/public/`，API 路径：`/app/apps/api/src/`

### ⚠️ 重要：容器使用 `--network host` 模式运行！

- 端口与宿主机共享，不要在容器内手动启动 tsx 进程（会导致端口冲突）
- 如需重启 API，使用 `docker restart stellarqs30`
- 如遇端口冲突（EADDRINUSE），先在宿主机 `fuser -k 4002/tcp` 再 `docker start stellarqs30`
- env 文件路径：`/root/StellarQS30_20260520000239/.env`（或更新的目录）
- 每次重大变更后执行 `docker commit stellarqs30 stellarqs30:latest` 保存状态

### 访问地址

- **HTTPS 访问地址**：https://121.5.164.126:3443
- **API 地址**：http://121.5.164.126:4002（容器内），nginx 反代到 3443

---

## 附录：记忆 ID 索引

| # | 记忆标题 | 记忆 ID |
|---|---------|---------|
| 1 | 端口分配规则与已注册系统 | 19609979 |
| 2 | Apple Design 风格规范 | 40059181 |
| 3 | CRUD 公共功能规范 | 37746999 |
| 4 | CSS/JS/HTML 代码拆分规范 | 44940766 |
| 5 | PptxGenJS 生成 PPT 规范 | 49794888 |
| 6 | CreativePPT 部署信息 | 55823718 |
| 7 | AutoMind 架构原则 | 57358760 |
| 8 | ADP V2 SSE 前端对接经验 | 76795619 |
| 9 | 报告长期存储方案 | 76795619 |
| 10 | ADPToolkit 部署信息 | 88205361 |
| 11 | DeepSeek API 配置 | 88294402 |
| 12 | 腾讯云 ADP 调用规范 | 93539212 |
| 13 | StellarQS30 已完成功能清单 | 93601414 |
| 14 | ADGraph 进度条处理规范 | 97341272 |
| 15 | 依赖安装国内镜像规范 | 97385723 |
| 16 | Lighthouse 部署规范 | 18875698 |

---

*此文档由 CodeBuddy AI 自动生成，基于用户的记忆系统数据。*
