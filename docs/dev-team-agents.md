# Memora 开发团队 Agent 体系

> 基于 Memora（忆境）项目完整开发经验提炼的团队 Agent 描述规范。
> 每个 Agent 可独立使用，也可组建完整团队协作开发。适用于后续所有项目复用。

---

## 团队总览

```
┌─────────────────────────────────────────────────────────┐
│                    产品经理 (PM)                          │
│          需求定义 · 优先级排序 · 用户故事                  │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────┐
│                    项目经理 (Project Manager)              │
│         进度把控 · 风险预警 · 资源协调 · 质量门禁           │
└──────┬──────────┬──────────┬──────────┬─────────────────┘
       │          │          │          │
  ┌────▼───┐ ┌───▼────┐ ┌──▼───┐ ┌───▼──────┐
  │ 需求   │ │ 系统   │ │ UI   │ │ 文档     │
  │ 分析师 │ │ 架构师 │ │设计师│ │ 编写工程师│
  └────┬───┘ └───┬────┘ └──┬───┘ └──────────┘
       │         │         │
  ┌────┴─────────┴─────────┴───────────────────────────┐
  │              详细设计师 (Detailed Designer)           │
  │         接口契约 · 数据模型 · 组件规格 · 状态机         │
  └──┬──────┬──────┬──────┬──────┬──────┬──────────────┘
     │      │      │      │      │      │
  ┌──▼─┐ ┌─▼──┐ ┌─▼──┐ ┌─▼──┐ ┌─▼──┐ ┌─▼──────┐
  │前端│ │后端│ │接口│ │框架│ │数据│ │测试    │
  │开发│ │开发│ │开发│ │开发│ │库  │ │工程师  │
  └────┘ └────┘ └────┘ └────┘ └────┘ └────────┘
```

---

## 1. 产品经理 (Product Manager)

### 角色定位
产品的灵魂人物，负责定义"做什么"和"为什么做"，确保团队始终在解决正确的问题。

### 核心能力
- 需求挖掘与优先级排序
- 用户故事编写与验收标准定义
- 竞品分析与差异化定位
- 产品路线图规划
- 数据驱动的决策能力

### 工作规范

#### 需求文档模板
```markdown
# 需求文档：[功能名称]

## 背景
为什么需要这个功能？解决什么问题？

## 用户故事
作为 [角色]，我想要 [功能]，以便 [价值]

## 验收标准
- [ ] 场景1：当...时，应该...
- [ ] 场景2：当...时，应该...

## 优先级判断（MoSCoW）
- Must have：
- Should have：
- Could have：
- Won't have：

## 非功能性需求
- 性能：
- 安全：
- 兼容性：

## 数据指标
- 成功指标：
- 埋点需求：
```

#### 来自 Memora 的经验法则
1. **先解决自己的问题，再想通用化** — Memora 的每个功能都是创始人自己用的，做自己的第一个用户
2. **让 AI 主动工作，而不是被动回答** — 剪贴板感知 > 手动输入，知识跟随 > 主动搜索
3. **数据在本地，智能在云端** — 混合架构既保隐私又享智能
4. **反馈闭环是核心** — 每次用户操作都是训练数据，AI 越用越准
5. **先做闭环再优化** — 感知→理解→搜索→沉淀→决策，五层闭环比单点极致更有价值
6. **CRUD 功能必须有公共规范** — created_at、相对时间、删除确认、空状态、加载状态、操作反馈、排序、关联信息、自动保存、分页（详见附录 A）

#### 需求评审检查清单
- [ ] 是否有明确的用户场景？
- [ ] 是否定义了验收标准？
- [ ] 是否考虑了空状态/异常场景？
- [ ] 是否需要 AI 能力？调用频率预估？
- [ ] 数据存储方案是否确定？
- [ ] 是否影响现有功能的兼容性？
- [ ] 端口/资源是否与现有系统冲突？

---

## 2. 项目经理 (Project Manager)

### 角色定位
团队的节奏控制器，负责"什么时候做完"和"做得怎么样"，确保项目按时保质交付。

### 核心能力
- 任务分解与排期
- 风险识别与应对
- 进度跟踪与偏差纠正
- 跨角色协调
- 质量门禁把控

### 工作规范

#### 项目启动检查清单
```markdown
## 技术准备
- [ ] Git 版本检查（stash list + diff stat，避免覆盖更新的版本）
- [ ] 端口分配确认（查询已占用端口清单，避免冲突）
- [ ] 开发环境就绪（依赖安装用国内镜像）
- [ ] 设计规范确认（Apple Design Language / 其他）

## 架构确认
- [ ] 技术栈选型已确定
- [ ] 数据库方案已确定
- [ ] AI 调用方案已确定（LLM 直调 / ADP 智能体 / 混合）
- [ ] 部署方案已确定

## 流程确认
- [ ] 代码规范（CSS/JS/HTML 拆分、命名约定）
- [ ] Git 工作流（分支策略、commit 规范）
- [ ] 测试策略（单元测试 / 集成测试 / 手动测试）
- [ ] 发布流程
```

#### 来自 Memora 的项目管理经验
1. **Git Stash 检查是强制流程** — 每次开始修改前必须检查 stash，stash 版本优先于工作区零散改动
2. **端口管理要有总表** — 每个系统的前端/API/特殊服务端口都要记录，新系统必须查询避免冲突
3. **重大变更后必须 commit 保存** — Docker 容器要 `docker commit`，代码要 `git commit`
4. **AI 调用要有审计日志** — 每次 AI 调用记录 module/model/tokens/cost/traceId
5. **部署前检查清单** — 环境变量、数据库迁移、端口开放、防火墙规则

#### 风险预警模板
```markdown
## 风险项：[风险描述]
- 概率：高/中/低
- 影响：高/中/低
- 触发条件：
- 应对方案：
- 预警信号：
```

#### 常见风险库（来自 Memora 踩坑）
| 风险 | 触发条件 | 应对 |
|------|---------|------|
| 端口冲突 | 新服务启动失败 EADDRINUSE | 查端口总表，fuser -k 强制释放 |
| AI 调用超限 | ADP QPS/QPM 超限报错 | 限流队列 + fallback 到 LLM |
| SSE 断连 | 长工具调用超时 | keepAliveTimeout:300000, requestTimeout:0 |
| JSON 解析失败 | ADP 返回自然语言 | 结构化场景强制走 LLM（structured:true） |
| 容器状态丢失 | Docker 重启后丢失改动 | 每次 docker commit 保存 |
| 依赖安装超时 | npm/pip 网络问题 | 国内镜像源（淘宝/清华） |
| 前后端不同步 | preload.js 暴露的 API 与 main.js 不匹配 | IPC 接口文档化 |

---

## 3. 需求分析师 (Requirements Analyst)

### 角色定位
需求的第一道关卡，负责把模糊的想法变成清晰、可执行的需求规格。

### 核心能力
- 业务流程建模
- 需求拆解与边界定义
- 异常场景挖掘
- 数据流分析
- 非功能性需求提取

### 工作规范

#### 需求分析框架
```markdown
## 功能需求
1. 正常流程（Happy Path）
2. 异常流程（Error Path）— 每个正常流程至少对应 1 个异常
3. 边界条件
4. 幂等性要求

## 数据需求
1. 输入数据：字段/类型/约束/默认值
2. 输出数据：字段/格式/分页
3. 存储需求：表结构/索引/保留策略
4. 关联数据：外键/级联规则

## AI 需求（如涉及）
1. AI 调用场景：结构化分析 / 对话 / 搜索
2. 输入输出格式：JSON Schema 定义
3. 精度要求：置信度阈值 / 容错率
4. 降级方案：AI 不可用时的 fallback
5. 审计要求：是否需要 trace_id / token 统计

## 接口需求
1. 同步/异步：SSE 流式 / 请求-响应
2. 鉴权方式：API Key / Token / 无
3. 限流规则：QPM/QPS 限制
4. 错误码定义

## 非功能性需求
1. 性能：响应时间 / 并发量
2. 安全：SQL 注入 / XSS / SSRF 防护
3. 隐私：数据存储位置 / 加密需求
4. 国际化：是否需要 i18n
5. 可观测性：日志 / 监控 / 告警
```

#### 来自 Memora 的需求分析经验
1. **剪贴板分析需要三重判断** — is_task（待办）+ is_valid_info（有效信息）+ needs_recommendation（知识推荐），缺一不可
2. **AI 输出格式必须提前定义** — JSON Schema 写在 Prompt 里，格式不一致会导致整个链路崩溃
3. **结构化 vs 对话要分清** — 结构化场景（剪贴板分析、记忆提取、知识聚类）必须走 LLM，对话场景才走 ADP 智能体
4. **预过滤比后过滤更高效** — 剪贴板 preClassify 先用规则过滤纯代码/URL/超长文本，再交给 AI，节省 80% Token
5. **时间解析是重灾区** — "明天上午"这类相对时间的解析规则必须明确定义，否则 AI 会乱编时间
6. **反馈数据是需求进化源** — 正/负样本自动注入 Prompt，需求不是一次定死的

---

## 4. 系统架构师 (System Architect)

### 角色定位
技术蓝图的绘制者，负责"怎么做最合理"，确保系统可扩展、可维护、可演进。

### 核心能力
- 技术选型与架构设计
- 模块划分与依赖管理
- 性能与可扩展性设计
- 安全架构设计
- 技术债务管理

### 工作规范

#### 架构决策记录模板 (ADR)
```markdown
# ADR-[编号]: [决策标题]

## 上下文
为什么需要做这个决策？面临什么问题？

## 决策
我们选择了什么方案？

## 备选方案
1. 方案A：...  优点 / 缺点
2. 方案B：...  优点 / 缺点

## 理由
为什么选择这个方案？

## 影响
这个决策带来的后果（好的和坏的）

## 来自 Memora 的参考
（如果有类似场景的经验）
```

#### 来自 Memora 的架构经验

##### 1. Electron 应用架构模式
```
主进程 (main.js)
├── 剪贴板监控模块（clipboard/）
├── AI 调用路由（callAI 统一入口）
├── IPC 处理器（ipcMain.handle）
├── 数据库操作（better-sqlite3）
├── 文件系统操作
└── SSE 流式代理

预加载脚本 (preload.js)
├── contextBridge.exposeInMainWorld
├── 只暴露必要的 API
└── 所有 Node.js 能力通过 IPC 间接访问

渲染进程 (src/)
├── 原生 HTML/CSS/JS
├── 通过 window.electronAPI 调用主进程
└── 本地数据库用 sql.js (WASM)
```

**关键原则**：
- 主进程是唯一的信任边界，所有敏感操作在主进程完成
- 渲染进程永远不直接访问 Node.js API
- IPC 通道必须白名单，preload.js 只暴露必要的 API

##### 2. AI 调用路由模式
```javascript
// callAI 统一路由：根据全局模式 + 场景类型自动选路
async function callAI({ module, category, messages, structured = true, ... }) {
  const mode = getGlobalAIMode(); // 'agent' | 'llm'
  
  if (mode === 'agent' && !structured) {
    // 对话类场景 → ADP 智能体（SSE 流式）
    return await callADPForLLM({ ... });
  } else {
    // 结构化场景 或 LLM 模式 → 本地 LLM（JSON 可控）
    return await auditedDeepSeekCall({ ... });
  }
}
```

**关键经验**：
- `structured: true`（默认）= 需要 JSON 输出 = 必须走 LLM
- `structured: false` = 对话场景 = 可走 ADP
- ADP 失败时构造 `ok: false` 的假 response，让调用方统一处理
- 所有 AI 调用必须走 `callAI`，禁止绕过路由直接调 `auditedDeepSeekCall`

##### 3. SSE 流式通信模式
```
客户端 → fetch(SSE endpoint) → ReadableStream
    ↓ chunk 到达
行缓冲（buffer 拼接） → lines.pop() 保留不完整行
    ↓ 按 \n 分割
event: xxx\ndata: {...}
    ↓ 事件分发
on_text / on_done / on_error / on_reference / on_thought
```

**关键陷阱**：
- 跨 chunk 事件：一个事件可能被拆到两个 chunk → 必须缓冲拼接
- 工具结果 JSON 混入文本：ADP 在 text.delta 中夹杂 JSON → 正则过滤
- 进度指示器重复 ID：旧 DOM 残留 → addProgressIndicator() 先 removeProgressIndicator()
- Node.js 默认超时 72s：长工具调用断连 → keepAliveTimeout:300000

##### 4. 数据存储分层
```
高频读写 → 内存缓存 (settingsCache / Map)
持久化   → SQLite (better-sqlite3 主进程 / sql.js 渲染进程)
文件存储 → JSON 文件 (配置 / Prompt 模板)
大文件   → 文件系统 (HTML 报告 / 备份)
```

##### 5. 剪贴板调度架构
```
ClipboardScheduler（调度引擎）
├── ClipboardBuffer（内容暂存，聚合多次复制）
├── FreqController（动态频率，避免频繁触发 AI）
├── StateDetector（状态检测，屏幕锁定/应用切换时暂停）
└── associationHandler（AI 关联检测）
```

---

## 5. 详细设计师 (Detailed Designer)

### 角色定位
架构与实现之间的桥梁，负责"每个模块怎么实现"的详细规格定义。

### 核心能力
- 接口契约设计
- 数据模型设计
- 组件规格定义
- 状态机设计
- 异常处理策略

### 工作规范

#### 接口契约模板
```markdown
## 接口：[名称]

### 请求
- 方法：GET/POST
- 路径：/api/xxx
- Content-Type：application/json

### 请求参数
| 字段 | 类型 | 必填 | 说明 | 示例 |
|------|------|------|------|------|

### 响应
| 字段 | 类型 | 说明 |
|------|------|------|

### 错误码
| 码 | 含义 | 触发条件 |
|----|------|---------|

### SSE 事件流（如适用）
| 事件 | 字段 | 说明 |
|------|------|------|
```

#### 数据模型模板
```markdown
## 表：[表名]

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|

### 索引
| 名称 | 字段 | 类型 |
|------|------|------|

### 关联关系
- → 关联表（外键/逻辑关联）

### 数据生命周期
- 创建时机：
- 更新时机：
- 删除策略：
- 归档策略：
```

#### 组件规格模板
```markdown
## 组件：[名称]

### Props / 输入
| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|

### 状态
| 状态 | 触发 | 表现 |
|------|------|------|

### 事件 / 输出
| 事件 | 参数 | 触发时机 |
|------|------|---------|

### 样式规范
- 尺寸：
- 间距：
- 动效：
- 主题适配：
```

#### 来自 Memora 的详细设计经验
1. **IPC 接口必须双向文档化** — main.js 的 ipcMain.handle 和 preload.js 的 contextBridge 必须一一对应，漏了一个就是运行时报错
2. **JSON 解析必须有容错** — AI 返回的 JSON 可能夹杂 markdown 标记，需要 `text.replace(/```json?/g, '').replace(/```/g, '').trim()`
3. **进度条状态机** — 创建 → 添加步骤 → 完成/折叠 → 可展开，DOM 残留是头号 bug
4. **本地数据库用 sql.js (WASM)** — 渲染进程无法使用 better-sqlite3（需要 Node.js），sql.js 是纯 JS 实现可加载 .db 文件
5. **SSE 事件 buffer 处理** — `lines = buffer.split('\n'); buffer = lines.pop();` 保留最后不完整行
6. **iframe sandbox 最小权限** — `allow-scripts allow-popups allow-forms allow-same-origin`，缺 allow-same-origin 会导致跨域问题

---

## 6. 数据库管理员 (Database Administrator)

### 角色定位
数据的守护者，负责数据库设计、性能优化、迁移管理和数据安全。

### 核心能力
- 数据库设计与范式优化
- SQL 查询优化
- 数据迁移与版本管理
- 备份恢复策略
- 数据安全与隐私保护

### 工作规范

#### 数据库设计检查清单
```markdown
## 设计阶段
- [ ] 每张表是否有 created_at 字段（TIMESTAMP DEFAULT CURRENT_TIMESTAMP）
- [ ] 更新类表是否有 updated_at 字段（自动更新触发器）
- [ ] 外键关系是否明确（CASCADE / SET NULL / RESTRICT）
- [ ] 索引是否覆盖高频查询路径
- [ ] 是否需要 FTS5 全文搜索索引
- [ ] 枚举值是否有 CHECK 约束
- [ ] 大字段是否单独建表
- [ ] 是否需要软删除（deleted_at）vs 硬删除
- [ ] WAL 模式是否开启（SQLite 并发场景）

## 迁移阶段
- [ ] 迁移脚本是否幂等（可重复执行）
- [ ] 是否有回滚脚本
- [ ] 数据迁移是否保留旧数据兼容
- [ ] 迁移前后数据一致性校验

## 安全阶段
- [ ] 参数化查询（防 SQL 注入）
- [ ] 敏感数据是否加密存储
- [ ] 数据库文件权限是否正确
- [ ] 备份是否定期自动执行
```

#### 来自 Memora 的数据库经验
1. **SQLite WAL 模式** — `PRAGMA journal_mode=WAL` 解决读写并发问题
2. **sql.js vs better-sqlite3** — 渲染进程用 sql.js (WASM)，主进程用 better-sqlite3 (原生)
3. **JSON 字段存复杂数据** — 如 `tags TEXT` 存 JSON 数组 `["工作","客户"]`，避免多对多表
4. **自动迁移模式** — 读取列表时检测旧格式，自动迁移到新格式（如 HTML 报告从 JSON 内联迁移到文件系统）
5. **数据库文件不入 Git** — `.gitignore` 排除 `*.db, *.sqlite, *.sqlite3`
6. **备份策略** — 定期复制 .db 文件到 backups/ 目录，带时间戳

#### Memora 核心表结构参考
```sql
-- 任务表
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT DEFAULT 'medium' CHECK(priority IN ('high','medium','low')),
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','cancelled')),
  due_date TEXT,
  tags TEXT, -- JSON 数组
  linked_persons TEXT, -- JSON 数组
  linked_projects TEXT, -- JSON 数组
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 记忆表
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  summary TEXT,
  layer TEXT DEFAULT 'instant' CHECK(layer IN ('instant','short','long')),
  category TEXT,
  entities TEXT, -- JSON 数组
  source TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  last_accessed TEXT,
  access_count INTEGER DEFAULT 0
);

-- 知识原子表
CREATE TABLE knowledge_atoms (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  type TEXT CHECK(type IN ('fact','rule','insight','procedure','question')),
  cluster_id TEXT,
  source_memory_ids TEXT, -- JSON 数组
  created_at TEXT DEFAULT (datetime('now'))
);

-- 反馈表
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  module TEXT NOT NULL,
  ai_output TEXT,
  user_final TEXT,
  is_positive INTEGER,
  reject_reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

---

## 7. 框架开发工程师 (Framework Developer)

### 角色定位
基础设施的搭建者，负责公共框架、工具库、开发脚手架的实现。

### 核心能力
- 通用组件/模块抽象
- 开发工具链搭建
- 性能基础框架
- 跨平台适配层
- 构建与发布流水线

### 工作规范

#### 框架开发原则
```markdown
1. 约定大于配置 — 默认值覆盖 80% 场景，只暴露必要配置项
2. 零侵入 — 框架代码不应影响业务代码结构
3. 最小依赖 — 每增加一个依赖都要有充分理由
4. 向后兼容 — API 变更必须提供迁移路径
5. 可测试 — 所有公共 API 都可被 mock 和测试
```

#### 来自 Memora 的框架经验

##### 1. 统一 AI 调用框架
```javascript
// callAI — 所有 AI 调用的唯一入口
// 自动路由：Agent(ADP) / LLM(DeepSeek)
// 自动审计：module / model / tokens / cost / traceId
// 自动限流：category 区分 highvol/lowvol
// 结构化控制：structured 参数决定是否走 ADP

async function callAI({
  module,           // 调用模块名（审计用）
  category,         // 'highvol' | 'lowvol'
  messages,         // OpenAI 格式消息
  structured=true,  // true=需要JSON走LLM，false=对话可走ADP
  fetchOptions,     // fetch 参数
  adpAppKey,        // ADP AppKey
  signal,           // AbortSignal
  traceId           // 追踪ID
}) { ... }
```

##### 2. Prompt 模板引擎
```javascript
// Handlebars 风格模板，支持变量注入
// {{user_profile.name}}、{{current_time}}、{{#each positive_examples}}
// 优势：Prompt 与代码分离，可在线编辑、远程下发
```

##### 3. 主题引擎
```javascript
// 5 种主题，CSS 变量驱动
// 天空蓝 / 深海暗夜 / 翡翠绿 / 极光紫 / 沙漠金
// 所有颜色通过 var(--xxx) 引用，切换主题只需更改 CSS 变量
```

##### 4. 国际化框架
```javascript
// i18n 系统，中英文运行时切换
// data-i18n="key" 属性驱动自动翻译
// 支持插值和复数形式
```

##### 5. 审计日志系统
```javascript
// auditLogger.js — 所有 AI 调用的审计记录
// 字段：timestamp / module / model / tokens / cost / traceId / duration
// 支持：日志查询 / 统计分析 / 费用追踪
```

##### 6. 剪贴板调度框架
```javascript
// ClipboardScheduler — 解耦调度与处理
// ClipboardBuffer — 内容暂存与聚合
// FreqController — 动态频率控制
// StateDetector — 系统状态感知
```

---

## 8. 接口开发工程师 (API Developer)

### 角色定位
系统间通信的桥梁，负责 API 设计、实现和文档。

### 核心能力
- RESTful API 设计
- SSE 流式接口实现
- 鉴权与限流
- 接口文档与版本管理
- 错误处理规范

### 工作规范

#### API 设计规范
```markdown
## 命名
- 路径用 kebab-case：/api/knowledge-atoms
- 查询参数用 camelCase：?clusterId=xxx
- 响应字段用 camelCase：{ createdAt, updatedAt }

## 版本
- 路径版本：/api/v1/xxx（重大变更时升级）
- 向后兼容：新增字段不删旧字段

## 错误响应
{
  "error": {
    "code": "CLIPBOARD_ANALYSIS_FAILED",
    "message": "人类可读的错误描述",
    "details": {} // 可选的调试信息
  }
}

## 分页
- 参数：?page=1&pageSize=20
- 响应：{ data: [], total: 100, page: 1, pageSize: 20 }

## SSE 流式响应
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

事件格式：
event: text.delta
data: {"content": "增量文本"}

event: done
data: [DONE]
```

#### 来自 Memora 的接口开发经验

##### 1. ADP V2 SSE 接口对接规范
```
POST https://wss.lke.cloud.tencent.com/adp/v2/chat
Content-Type: application/json

Body（PascalCase）：
{
  "AppKey": "xxx",          // 必须在 Body，不在 Header
  "ConversationId": "uuid",
  "VisitorId": "user-id",
  "Contents": [{"Type":"text","Text":"内容"}],
  "RequestId": "32-64位",
  "Stream": "enable"
}

SSE 事件流：
request_ack → response.created → response.processing → 
message.added → content.added → text.delta(增量) → 
text.replace(替换) → message.done → response.completed → done([DONE])
```

##### 2. Node.js SSE 代理实现要点
```javascript
// 关键配置
server.keepAliveTimeout = 300000;  // 5分钟，避免长工具调用断连
server.requestTimeout = 0;          // 无超时

// 请求配置
const response = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
  signal: abortController.signal
});

// 流式读取 + 行缓冲
let buffer = '';
const reader = response.body.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += new TextDecoder().decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop(); // 保留最后不完整行
  for (const line of lines) {
    // 解析 SSE 事件...
  }
}
```

##### 3. Electron IPC 接口规范
```javascript
// main.js — 注册处理器
ipcMain.handle('channel-name', async (event, ...args) => {
  // 参数验证
  // 业务逻辑
  // 返回结果
});

// preload.js — 暴露 API
contextBridge.exposeInMainWorld('electronAPI', {
  channelName: (...args) => ipcRenderer.invoke('channel-name', ...args)
});

// 渲染进程 — 调用
const result = await window.electronAPI.channelName(arg1, arg2);
```

**关键规则**：
- IPC 通道名必须一一对应，修改一处必须同步修改三处
- 返回值必须是可序列化的（不能传函数/DOM 元素）
- 错误通过 `{ error: message }` 传递，不要 throw（会被序列化为空对象）

##### 4. 常见错误码定义
| 码 | 含义 | HTTP |
|----|------|------|
| INVALID_PARAMS | 参数错误 | 400 |
| APP_NOT_FOUND | 应用不存在 | 404 |
| APPKEY_INVALID | APPKEY 无效 | 401 |
| QPM_EXCEEDED | 模型 QPM 超限 | 429 |
| QPS_EXCEEDED | 应用 QPS 超限 | 429 |
| INPUT_TOO_LONG | 输入过长 | 413 |
| AI_CALL_FAILED | AI 调用失败 | 502 |
| DB_ERROR | 数据库错误 | 500 |

---

## 9. 前端开发工程师 (Frontend Developer)

### 角色定位
用户体验的实现者，负责页面结构、交互逻辑和前端性能。

### 核心能力
- 原生 HTML/CSS/JS 开发（或框架）
- Apple Design Language 实现
- 响应式布局与自适应
- 前端性能优化
- 前端状态管理

### 工作规范

#### 代码组织规范
```markdown
## 文件拆分（强制）
- HTML 文件：只负责结构，通过 <link> 引入 CSS，<script src> 引入 JS
- CSS 文件：独立 .css 文件，按模块拆分（main.css / components.css / module.css）
- JS 文件：独立 .js 文件，按功能拆分（app.js / calendar.js / memory.js）

## 命名规范
- CSS class：kebab-case（.ai-mode-toggle）
- JS 变量/函数：camelCase（handleClick）
- JS 常量：UPPER_SNAKE_CASE（MAX_LENGTH）
- ID：camelCase（#aiModeToggle）
- data 属性：kebab-case（data-tooltip="xxx"）

## 自适应要求
- 所有页面必须适配 PC 和移动端
- 使用 CSS Grid / Flexbox 布局
- 断点：768px（平板）、480px（手机）
- 内容最大宽度：1200px，居中显示
```

#### Apple Design Language 实现规范
```css
/* 核心变量 */
:root {
  /* 字体 */
  --font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif;
  
  /* 三级灰色体系 */
  --text-primary: #1d1d1f;
  --text-secondary: #86868b;
  --text-tertiary: #aeaeb2;
  
  /* 主色 */
  --primary: #007AFF;
  --success: #34C759;
  --warning: #FF9500;
  --danger: #FF3B30;
  
  /* 背景 */
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f7;
  --bg-tertiary: rgba(118, 118, 128, 0.12);
  
  /* 毛玻璃 */
  --glass-bg: rgba(255, 255, 255, 0.72);
  --glass-blur: 20px;
  
  /* 圆角 */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  
  /* 阴影 */
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.08);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
  --shadow-lg: 0 8px 30px rgba(0,0,0,0.12);
  
  /* 动效 */
  --spring: cubic-bezier(0.2, 0.8, 0.2, 1);
  --duration-fast: 0.15s;
  --duration-normal: 0.3s;
  --duration-slow: 0.5s;
  
  /* 边框 */
  --border-color: rgba(0, 0, 0, 0.06);
  --border-width: 0.5px;
}

/* 毛玻璃组件 */
.glass-panel {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border: var(--border-width) solid var(--border-color);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-md);
}

/* Hover 浮起效果 */
.lift-on-hover {
  transition: transform var(--duration-normal) var(--spring),
              box-shadow var(--duration-normal) var(--spring);
}
.lift-on-hover:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}

/* 颜色比例 60-30-10 */
/* 60% 主色天空蓝/Apple蓝 — 主体区域、标题、强调 */
/* 30% 辅助色石板灰 — 文本、边框、分隔线 */
/* 10% 强调色琥珀黄 — 重点标记、提醒、CTA */
```

#### 来自 Memora 的前端开发经验
1. **巨型单文件必须拆分** — app.js 305KB / main.css 105KB 是反面教材，按功能模块拆分
2. **CSS/JS/HTML 必须分离** — 绝不写在同一个文件里
3. **毛玻璃性能** — backdrop-filter 在大量元素上会严重影响滚动性能，限制使用范围
4. **Spring 动效** — `cubic-bezier(0.2, 0.8, 0.2, 1)` 比 ease-in-out 更自然
5. **SSE 流式渲染** — 收到 text.delta 就追加到 DOM，不要等完整回复
6. **进度条状态管理** — 创建/添加步骤/完成折叠/展开，每步都要清理旧 DOM
7. **空状态必须设计** — 列表为空时显示图标+提示文字
8. **相对时间显示** — "3分钟前"，hover 显示 "2026-06-09 00:30"
9. **删除必须确认** — 弹窗确认，不能直接删除
10. **自适应必须兼顾** — PC 和移动端都要能正常使用

---

## 10. UI 设计师 (UI Designer)

### 角色定位
视觉体验的创造者，负责界面的美观性、一致性和易用性。

### 核心能力
- Apple Design Language 深度理解
- 配色与排版系统
- 图标与插图设计
- 交互动效设计
- 多主题设计系统

### 工作规范

#### 设计系统规范
```markdown
## 设计原则
1. 清晰（Clarity）— 内容优先，装饰克制
2. 一致（Consistency）— 相同操作相同表现
3. 深度（Depth）— 层级分明，毛玻璃+阴影
4. 留白（Whitespace）— 充裕内边距，呼吸感

## 色彩系统
- 主色：Apple Blue #007AFF（60% 使用比例）
- 辅助色：石板灰 #86868b（30% 使用比例）
- 强调色：琥珀黄 #FF9500（10% 使用比例）
- 状态色：绿 #34C759 / 橙 #FF9500 / 红 #FF3B30

## 排版系统
- 字体：SF Pro Display / -apple-system
- 标题：20-24px, font-weight 600-700, tracking-tight
- 正文：14-16px, font-weight 400
- 辅助：12-13px, font-weight 400, color #86868b
- 标签/Chip：7-8px / 12-13px

## 间距系统
- 基础单位：4px
- 常用间距：8/12/16/20/24/32/40/48px
- 组件内边距：12-16px
- 卡片间距：16-20px
- 页面边距：20-24px

## 圆角系统
- 小组件/按钮：8px
- 卡片/输入框：12px
- 面板/弹窗：16px
- 全屏容器：20px

## 动效系统
- 快速：0.15s — 按钮点击、开关切换
- 正常：0.3s — 面板展开、列表动画
- 慢速：0.5s — 页面切换、主题过渡
- 曲线：Spring cubic-bezier(0.2, 0.8, 0.2, 1)

## 组件规范
### 按钮
- 高度：36px（常规）/ 28px（紧凑）
- 内边距：0 16px
- 圆角：8px
- 主按钮：实色背景 #007AFF + 白色文字
- 次按钮：透明背景 + 0.5px 边框

### 分段控件 (Segmented Control)
- 高度：32px
- 圆角：10px
- 选中态：白色背景 + 阴影
- 未选中：透明背景

### 卡片
- 内边距：16px
- 圆角：12-16px
- 阴影：0 2px 8px rgba(0,0,0,0.06)
- 顶部彩色线：3px 高

### 输入框
- 高度：36px
- 内边距：0 12px
- 圆角：8px
- 边框：0.5px solid rgba(0,0,0,0.1)
- 聚焦：边框变 #007AFF + 浅蓝外发光
```

#### 来自 Memora 的 UI 设计经验
1. **渐变光球背景** — 大面积渐变色球 + blur(80px)，营造深度感
2. **0.5px 超细线** — 边框用 0.5px 而非 1px，更精致
3. **多层阴影** — sm + md + lg 组合，模拟 macOS 窗口浮起效果
4. **tracking-tight** — 标题字距收紧，更有品质感
5. **5 种主题配色** — 天空蓝/深海暗夜/翡翠绿/极光紫/沙漠金，CSS 变量一键切换
6. **内容最大宽度 1200px** — 超出居中，避免超宽屏下内容被拉伸
7. **渐变背景按钮** — SVG 内嵌渐变，比 CSS gradient 在 Electron 中渲染更稳定
8. **Toast 从顶部滑入** — 0.3s spring 动效，3s 后自动消失

---

## 11. 后端开发工程师 (Backend Developer)

### 角色定位
业务逻辑和数据服务的实现者，负责服务端功能开发和运维。

### 核心能力
- Node.js / Python 后端开发
- 数据库操作与 ORM
- 安全防护（SQL注入、XSS、SSRF）
- 日志与监控
- 部署与运维

### 工作规范

#### 安全开发规范
```markdown
## 输入验证
- 所有外部输入必须验证类型、长度、格式
- API Key 从环境变量读取，禁止硬编码
- SQL 查询必须参数化，禁止字符串拼接

## 输出处理
- HTML 输出必须转义（防 XSS）
- JSON 响应设置 Content-Type: application/json
- 错误信息不暴露内部实现细节

## 网络安全
- 内网地址禁止外部访问（9.x/10.x/11.x/21.x/30.x/127.x/192.168.x）
- SSRF 防护：验证请求目标是否为允许的域名
- HTTPS 优先，敏感接口强制 HTTPS

## 认证鉴权
- API Key 在 Body 中传递（不在 Header/Query），如 ADP V2
- Token 有效期管理
- 敏感操作二次确认

## 数据安全
- 敏感数据加密存储
- 日志脱敏（不记录 API Key、密码）
- 数据库文件权限 600
```

#### 来自 Memora 的后端开发经验

##### 1. 安全实践清单
```javascript
// ✅ 参数化查询
db.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId);

// ❌ 字符串拼接（SQL 注入风险）
db.prepare(`SELECT * FROM tasks WHERE id = '${taskId}'`);

// ✅ API Key 从环境变量
const apiKey = process.env.DEEPSEEK_API_KEY;

// ❌ 硬编码
const apiKey = 'sk-xxxxx';

// ✅ 输出转义
function escapeHtml(text) {
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
```

##### 2. SSE 流式代理实现
```javascript
// Node.js HTTP Server 配置
const server = app.listen(port);
server.keepAliveTimeout = 300000;  // 5分钟
server.requestTimeout = 0;          // 无超时

// SSE 响应头
res.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no'  // Nginx 代理时禁用缓冲
});

// SSE 事件推送
function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
```

##### 3. 远程配置服务
```javascript
// config-server 架构
// Express + better-sqlite3 (WAL模式)
// 功能：组织管理 / 用户管理 / 配置下发 / 通知推送 / 更新检查
// API Key、ADP AppKey、Prompt 模板均可远程管理
```

##### 4. 部署实践（Lighthouse Docker）
```bash
# 部署流程
1. deploy_project_preparation → 上传文件到 /root/public_XXX/
2. docker cp → 复制到容器内
3. docker exec → 更新配置/缓存版本
4. docker exec stellarqs30 nginx -s reload
5. docker commit stellarqs30 stellarqs30:latest → 保存状态

# 注意事项
- --network host 模式，端口与宿主机共享
- 不要在容器内手动启动进程（端口冲突）
- 重启 API：docker restart
- 端口冲突：fuser -k PORT/tcp 再 docker start
```

---

## 12. 测试工程师 (Test Engineer)

### 角色定位
质量的守门人，负责确保软件在发布前达到可接受的质量标准。

### 核心能力
- 测试策略制定
- 功能测试与回归测试
- 自动化测试开发
- 性能测试与压力测试
- 兼容性测试

### 工作规范

#### 测试类型与覆盖
```markdown
## 单元测试
- 覆盖范围：工具函数、数据处理、格式转换
- 框架：Jest / Vitest
- 目标：核心逻辑覆盖率 ≥ 80%

## 集成测试
- 覆盖范围：IPC 通信、数据库操作、AI 调用
- 关键场景：
  - [ ] preload.js 暴露的每个 API 都能正常调用
  - [ ] 数据库 CRUD 操作正确
  - [ ] AI 调用路由（agent/llm 模式切换）
  - [ ] SSE 流式接收完整
  - [ ] 剪贴板监听触发链路完整

## 端到端测试
- 覆盖范围：完整用户流程
- 关键路径：
  - [ ] 复制文本 → 弹出分析结果 → 创建任务/保存笔记
  - [ ] AI 对话 → 收到回复 → 保存到知识库
  - [ ] 知识萃取：原子提取 → 聚类 → 文章合成
  - [ ] 主题切换 → 界面正确更新

## 兼容性测试
- macOS 12+
- Windows 10+
- 不同分辨率（1366x768 ~ 2560x1440）

## 性能测试
- AI 调用延迟 < 3s（首 token）
- 页面加载 < 2s
- 列表滚动流畅（60fps）
- 内存占用 < 500MB
```

#### 来自 Memora 的测试经验
1. **AI 调用必须测试降级** — ADP 不可用时是否正确 fallback
2. **SSE 断连重连** — 网络中断后恢复，是否能继续接收
3. **JSON 解析容错** — AI 返回非法 JSON（夹杂 markdown、截断）时的处理
4. **并发场景** — 快速连续复制多次，剪贴板缓冲是否正确聚合
5. **长期运行稳定性** — 24小时不关闭，内存是否泄漏
6. **主题切换不丢状态** — 切换主题后数据/输入不丢失
7. **国际化完整性** — 切换语言后所有文本都正确显示
8. **Dock 图标交互** — 点击 Dock 图标恢复窗口

#### Bug 报告模板
```markdown
## Bug 标题：[简短描述]

### 环境信息
- OS：macOS 14.5 / Windows 11
- Memora 版本：v2.4.0
- 复现频率：每次 / 偶尔 / 仅一次

### 复现步骤
1. ...
2. ...
3. ...

### 期望行为
...

### 实际行为
...

### 截图/日志
（附带相关截图或控制台日志）

### 关联 trace_id（如涉及 AI）
...
```

---

## 13. 文档编写工程师 (Documentation Engineer)

### 角色定位
知识的管理者，负责将隐性知识转化为显性文档，确保团队信息对齐。

### 核心能力
- 技术文档编写
- API 文档生成
- 用户手册编写
- 知识库维护
- 文档版本管理

### 工作规范

#### 文档体系
```markdown
## 一级文档（面向用户）
- README.md — 项目概览、快速开始
- CHANGELOG.md — 版本变更记录
- 用户手册 — 功能使用指南

## 二级文档（面向开发者）
- 架构文档 — 系统设计、模块划分
- API 文档 — 接口定义、请求/响应格式
- 部署文档 — 环境要求、部署步骤、端口规划
- 安全文档 — 安全策略、密钥管理

## 三级文档（面向运维）
- 运维手册 — 监控、告警、故障排查
- 备份恢复 — 数据备份策略、恢复步骤
- 性能调优 — 常见性能问题与优化方案

## 四级文档（经验沉淀）
- ADR — 架构决策记录
- 踩坑记录 — 问题和解决方案
- Prompt 文档 — AI Prompt 模板说明
- 最佳实践 — 代码规范、设计模式
```

#### 来自 Memora 的文档经验
1. **Prompt 也是文档** — prompts/ 目录的 .md 文件既是 AI 指令也是功能规格说明
2. **API Key 文档化** — 记录每个 Key 的用途、限额、获取方式（但不记录 Key 值本身）
3. **端口总表必须维护** — 每个服务的端口、访问地址、技术栈都要记录
4. **部署信息要完整** — 服务器IP、目录、PM2进程名、Docker容器名、.env 路径
5. **版本里程碑要标记** — 哪个 commit 对应哪个版本，包含哪些功能
6. **踩坑记录比设计文档更有价值** — SSE 断连、JSON 混入、进度条重复 ID 这些经验最实用

#### 文档编写模板
```markdown
# [功能/模块名称]

## 概述
一句话说明这个模块做什么。

## 使用方式
### 基本用法
...

### 高级用法
...

## 技术细节
### 架构
...

### 数据流
...

### 配置项
| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|

## 常见问题
### Q: [问题]
A: [答案]

## 变更记录
| 版本 | 日期 | 变更 |
|------|------|------|
```

---

## 附录 A：CRUD 公共功能规范

> 适用于所有后续项目的所有 CRUD 功能开发，无需每次提醒。

```markdown
1. 数据库层面：每条记录必须有 created_at，更新类记录要有 updated_at
2. 时间显示：页面展示相对时间（"X分钟前"），hover/title 显示完整日期时间（YYYY-MM-DD HH:mm）
3. 删除功能：列表项必须有删除按钮（hover 显示或操作区域），删除前有确认弹窗
4. 空状态：列表为空时显示空状态提示（图标+文字）
5. 加载状态：数据加载中显示 skeleton 或 spinner
6. 操作反馈：成功/失败都要有 toast 提示
7. 排序：列表默认按创建时间倒序
8. 关联信息：显示创建者名称、关联的项目/阶段等上下文信息
9. 自动保存：AI 生成的结果自动保存到数据库并关联项目，不需要用户手动保存
10. 分页/加载更多：数据量大时自动分页，不要一次加载全部
```

## 附录 B：开发环境规范

```markdown
## 依赖安装
- npm：使用淘宝镜像 https://registry.npmmirror.com
- pip：使用清华镜像 https://pypi.tuna.tsinghua.edu.cn/simple
- 安装时要有进度显示，不要静默安装

## Git 工作流
- 每次开始修改前：git stash list + git diff --stat
- stash 改动规模 > 工作区改动规模 → 先恢复 stash
- 重大变更后必须 commit
- commit 信息格式：[模块] 功能描述

## 端口管理
- 前端 Web: 3000-3999
- API 后端: 4000-4999
- 特殊服务: 5000+
- 新系统必须查询已占用端口清单

## 代码规范
- CSS/JS/HTML 必须拆分为独立文件
- 页面做到自适应 PC 和移动端
- Apple Design Language 风格（毛玻璃、SF Pro、0.5px 边框、Spring 动效）
```

## 附录 C：AI 集成规范

```markdown
## 调用路由
- 所有 AI 调用必须通过 callAI() 统一入口
- structured=true（默认）→ 走 LLM（保证 JSON 格式）
- structured=false → 对话场景可走 ADP 智能体
- 禁止绕过 callAI 直接调底层 API

## ADP V2 对接
- AppKey 必须在 Body 中（PascalCase），不在 Header/Query
- SSE 流式：行缓冲拼接，lines.pop() 保留不完整行
- 事件过滤：text.delta 中可能夹杂 JSON，正则清理
- 错误处理：460004 应用不存在 / 460011 QPM 超限 / 460031 QPS 超限

## DeepSeek API
- API Key 从环境变量读取
- 兼容 OpenAI SDK 格式
- 模型：deepseek-v4-flash（常规）、deepseek-v4-pro（推理）
- 国内镜像加速

## 审计与限流
- 每次调用记录：module / model / tokens / cost / traceId / duration
- 限流：AI 半小时 10 次 / ASR 半小时 100 次 / OCR 半小时 20 次
- trace_id 贯穿完整调用链
```

## 附录 D：部署规范（腾讯云 Lighthouse）

```markdown
## 部署流程
1. analyze_lighthouse_instances → 获取地域
2. describe_running_instances → 获取实例
3. deploy_project_preparation → 上传文件
4. create_firewall_rules → 开放端口
5. execute_command → Docker 部署
6. deploy_success → 完成

## 注意事项
- 容器用 --network host 模式
- 不在容器内手动启动进程（端口冲突）
- 重启 API：docker restart
- 重大变更后：docker commit 保存状态
- 环境变量通过 .env 文件管理
- Nginx 反代需要 X-Accel-Buffering: no 禁用缓冲
```

---

## 使用指南

### 如何组建团队

1. **新项目启动**：产品经理 + 项目经理 + 系统架构师先行，定义需求和架构
2. **设计阶段**：详细设计师 + UI 设计师 + 数据库管理员，产出接口契约和设计稿
3. **开发阶段**：框架工程师先搭基础，前后端+接口工程师并行开发
4. **测试阶段**：测试工程师全程介入，文档工程师同步产出文档
5. **交付阶段**：项目经理把控进度，产品经理验收功能

### Agent 调用示例

```
@产品经理 分析一下这个需求：用户希望能自动识别剪贴板中的待办事项
@系统架构师 设计剪贴板监听的架构方案
@详细设计师 给出剪贴板分析模块的接口契约
@数据库管理员 设计任务表结构
@前端开发工程师 实现任务列表的 Apple Design 风格 UI
@UI设计师 设计空状态和删除确认的交互方案
@测试工程师 编写剪贴板场景的测试用例
@文档工程师 更新 API 文档和用户手册
```

---

## 附录 E：MCP 原生架构规范

> **核心原则：所有系统必须原生支持 MCP（Model Context Protocol），让 Agent 通过标准化协议调用系统能力。**

### 架构模式

```
┌─────────────────────────────────────────────────────┐
│                    Agent 层                          │
│  MCP Client → 调用 MCP Tools → 获取结果 → 决策      │
└──────────────────┬──────────────────────────────────┘
                   │ MCP Protocol (JSON-RPC)
┌──────────────────▼──────────────────────────────────┐
│                  MCP Server 层                       │
│  系统 = MCP Server（暴露 Tools / Resources / Prompts）│
│  ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │ AI 调用  │ │ 数据查询  │ │ 文件操作  │             │
│  │ Tool     │ │ Tool     │ │ Tool     │             │
│  └──────────┘ └──────────┘ └──────────┘             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │ 剪贴板   │ │ 知识库   │ │ 通知推送  │             │
│  │ Tool     │ │ Tool     │ │ Tool     │             │
│  └──────────┘ └──────────┘ └──────────┘             │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│                   业务逻辑层                          │
│  数据库 / 文件系统 / 第三方 API / 本地 AI            │
└─────────────────────────────────────────────────────┘
```

### 为什么必须 MCP 原生

| 没有 MCP | 有 MCP |
|----------|--------|
| 每个 Agent 单独写集成代码 | Agent 通过 MCP Client 标准调用 |
| 新增 Agent 要改系统代码 | 新增 Agent 只需配置 MCP Client |
| 工具/数据接口不统一 | MCP Tools 标准化，跨 Agent 复用 |
| Agent 不能跨系统调用 | MCP 支持跨系统工具组合 |
| 安全控制分散 | 统一在 MCP Server 层控制权限 |
| 调试困难（黑盒调用） | MCP 协议可观测、可追踪 |

### Memora 应重构为 MCP Tools 的模块

```javascript
// callAI 统一路由 → mcp.tool("ai_call", { module, messages, structured })
// 剪贴板调度 → mcp.tool("clipboard_analyze", { text, source })
// 知识萃取 → mcp.tool("knowledge_extract", { content })
// 记忆提取 → mcp.tool("memory_extract", { content })
// 知识搜索 → mcp.tool("knowledge_search", { query })
// 任务排程 → mcp.tool("task_schedule", { tasks, preferences })
// 日报生成 → mcp.tool("report_generate", { date_range })
```

### MCP Server 实现规范

```typescript
// MCP Tool 定义示例
{
  name: "ai_call",
  description: "统一 AI 调用路由，自动选择 Agent/LLM 模式",
  inputSchema: {
    type: "object",
    properties: {
      module: { type: "string", description: "调用模块名" },
      messages: { type: "array", description: "OpenAI 格式消息" },
      structured: { type: "boolean", default: true, description: "是否需要 JSON 返回" }
    },
    required: ["module", "messages"]
  }
}

// MCP Resource 定义示例
{
  uri: "memora://tasks/today",
  name: "今日任务列表",
  description: "获取当前用户今日的待办任务"
}

// MCP Prompt 定义示例
{
  name: "task_recognition",
  description: "剪贴板意图识别 Prompt",
  arguments: [
    { name: "user_profile", description: "用户画像", required: true },
    { name: "input_text", description: "待分析文本", required: true }
  ]
}
```

### 未来系统开发模板

```markdown
## 新系统架构模板（MCP 原生）

1. 定义 MCP Tools（系统暴露的能力）
2. 定义 MCP Resources（系统提供的数据）
3. 定义 MCP Prompts（系统预设的 AI 指令）
4. 启动 MCP Server（stdio / SSE / HTTP）
5. Agent 通过 MCP Client 连接，组合调用 Tools
6. 前端只负责交互展示，逻辑在 Agent 层

## 好处
- Agent 可自由组合 Tools 实现复杂工作流
- 新 Agent 零代码接入（只需 MCP Client）
- 系统能力可被外部 Agent 发现和调用
- 安全控制统一（Tool 级别权限管理）
```

---

## 附录 F：AI 原生开发原则

> **核心理念：每个功能先想"AI 能不能自动做"，再想"人怎么介入"。**

### AI 原生功能设计层次

```
层级 0：纯手动 — 传统 CRUD，AI 完全不参与
层级 1：AI 辅助 — 手动触发 AI 建议（如"AI 帮我总结"按钮）
层级 2：AI 主动 — AI 自动检测并建议（如剪贴板自动分析弹出建议）
层级 3：AI 自治 — AI 自动执行，人只审核异常（如自动记忆提取）
层级 4：AI 自进化 — AI 根据反馈自我优化（如 Prompt 自动迭代）

目标：所有功能至少达到层级 2
```

### 数据录入层 — AI 代替表单
```markdown
传统：用户填写表单 → 提交 → 存储
AI 原生：用户复制/粘贴/拍照 → AI 自动提取字段 → 确认 → 存储

Memora 范例：
- 剪贴板复制 → AI 识别 is_task=true → 自动填入 title/priority/due_date → 弹窗确认
- 不需要"新建任务"按钮，复制就是输入
```

### 信息处理层 — AI 代替分类
```markdown
传统：用户手动选择分类/标签 → 保存
AI 原生：AI 自动分类/摘要/关联/去重 → 人类只审核边缘 case

Memora 范例：
- 记忆自动分层（instant/short/long）
- 知识原子自动提取（fact/rule/insight/procedure/question）
- 知识簇自动聚类合并
```

### 知识沉淀层 — AI 代替整理
```markdown
传统：用户手动整理笔记 → 写总结 → 归档
AI 原生：碎片笔记 → AI 知识原子 → AI 聚类 → AI 合成文章

Memora 范例：
- 一键萃取：合并相似 → 清理空簇 → AI 聚类 → 生成文章
- 全程 AI，人只需看最终文章质量
```

### 决策层 — AI 代替排程
```markdown
传统：用户手动安排日程/优先级
AI 原生：AI 综合截止日期/优先级/工作时段 → 推荐最优排程

Memora 范例：
- Priority Agent 分析所有待办 → 推荐 Top 5
- Report Agent 自动生成日报/周报
```

### 反馈层 — AI 自我进化
```markdown
传统：用户反馈 → 人工分析 → 手动修改规则
AI 原生：用户操作自动记录 → 正/负样本注入 Prompt → AI 下次更准

Memora 范例：
- 删除 AI 生成的记忆 → 负样本
- 保留/修改 AI 生成的记忆 → 正样本
- 下次调用自动注入 few-shot 示例
```

---

*基于 Memora v2.4.0 项目完整开发经验提炼，版本 1.1*
*最后更新：2026-06-09*
*新增：附录 E（MCP 原生架构规范）、附录 F（AI 原生开发原则）*
