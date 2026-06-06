# 忆境 Memora - 知识萃取系统设计

> 设计时间：2026-06-06
> 目标：将记事本中零散的知识碎片，通过 AI 萃取、聚类、合成，形成结构化的知识体系

---

## 一、问题分析

### 现状
- 记事本（Notebook）存储剪贴板自动识别的"有效信息"
- 每条记录是独立的：`content / title / category / tags / analysis`
- 知识零散、碎片化，无法形成体系
- 用户无法快速了解"我在某个领域掌握了哪些知识"

### 目标
```
零散笔记 ──→ 知识原子 ──→ 知识簇 ──→ 知识文章
  (碎片)      (提炼)      (聚类)      (合成)
```

---

## 二、核心概念

### 1. 知识原子（Knowledge Atom）
从一条或多条笔记中提炼出的最小知识单元。

```json
{
  "id": "atom_1717660800000_abc",
  "content": "ADP V2 接口 AppKey 必须放在 Body 中（PascalCase），不放 Header/Query",
  "source_note_ids": ["note_1717660800000_xyz"],  // 来源笔记
  "domain": "技术-ADP",        // 所属领域
  "type": "fact",              // 类型：fact/rule/insight/procedure
  "importance": 0.8,           // 重要度 0-1
  "created_at": "2026-06-05T10:00:00Z",
  "updated_at": "2026-06-05T10:00:00Z"
}
```

**知识原子类型**：
| type | 含义 | 示例 |
|------|------|------|
| `fact` | 事实/参数 | "ADP V2 AppKey 必须在 Body 中" |
| `rule` | 规则/约束 | "端口号不能超过 65535" |
| `insight` | 洞察/经验 | "客户更关注交付速度而非技术细节" |
| `procedure` | 步骤/流程 | "部署流程：1.构建 2.上传 3.docker cp 4.reload" |

### 2. 知识簇（Knowledge Cluster）
同一领域的知识原子聚类，形成主题化的知识集合。

```json
{
  "id": "cluster_adp_integration",
  "name": "ADP 接入与调用",
  "domain": "技术-ADP",
  "description": "ADP 智能体开发平台的接入规范、API调用方式和常见问题",
  "atom_ids": ["atom_001", "atom_002", "atom_003"],
  "keywords": ["ADP", "AppKey", "SSE", "智能体"],
  "status": "growing",     // growing → mature → distilled
  "article_id": null,       // 萃取后的知识文章 ID
  "created_at": "2026-06-05T10:00:00Z",
  "updated_at": "2026-06-05T10:00:00Z"
}
```

**簇状态流转**：
```
growing（积累中，原子数 < 5）
    ↓ 原子数 ≥ 5 或手动触发
mature（成熟，可萃取）
    ↓ AI 萃取
distilled（已萃取，生成知识文章）
    ↓ 新原子加入
growing（继续积累，触发新一轮萃取）
```

### 3. 知识文章（Knowledge Article）
AI 从知识簇中合成的结构化文章，是最终可阅读的知识产物。

```json
{
  "id": "article_adp_integration_v1",
  "cluster_id": "cluster_adp_integration",
  "title": "ADP 智能体平台接入指南",
  "content": "# ADP 智能体平台接入指南\n\n## 1. 认证与鉴权\n...\n## 2. API 调用规范\n...",
  "format": "markdown",
  "version": 1,
  "atom_count": 8,             // 萃取的原子数
  "source_note_count": 5,      // 原始笔记数
  "tags": ["ADP", "API", "SSE"],
  "created_at": "2026-06-05T10:00:00Z",
  "updated_at": "2026-06-05T10:00:00Z"
}
```

---

## 三、萃取流程

### 阶段 1：知识原子提取（实时/近实时）

**触发时机**：每次新笔记保存到记事本时

```
新笔记 → AI 提取知识原子 → 存入知识原子库
                           → 自动匹配/创建知识簇
```

**AI Prompt 核心逻辑**：
```
从以下笔记内容中提取1-3个知识原子：
- 每个原子是一个独立的、可复用的知识点
- 标注类型（fact/rule/insight/procedure）
- 标注所属领域
- 评估重要度（0-1）
```

**频率控制**：与剪贴板 AI 分析共享每日额度，不额外消耗。

### 阶段 2：知识聚类（每日/手动触发）

**触发时机**：
- 每日自动检查一次
- 用户手动点击"整理知识"
- 新原子数累积超过 10 个

```
全部知识原子 → AI 识别主题 → 合并/创建知识簇
                           → 标记成熟簇
```

**AI Prompt 核心逻辑**：
```
以下是所有知识原子列表，请：
1. 识别主题分组（按领域/项目/概念）
2. 每个分组给出名称和描述
3. 标记哪些分组已经"成熟"（原子数≥5，覆盖了该主题的关键方面）
4. 建议哪些成熟分组可以合成知识文章
```

### 阶段 3：知识合成（手动触发为主）

**触发时机**：
- 用户在知识簇上点击"生成文章"
- 自动检查成熟的簇，推送"可生成文章"提醒

```
成熟知识簇 → AI 合成文章 → 知识文章库
                          → 更新簇状态为 distilled
                          → 保留原始原子（可追溯）
```

**AI Prompt 核心逻辑**：
```
以下是关于「{cluster_name}」的所有知识原子，请合成一篇结构化的知识文章：
- 使用 Markdown 格式
- 按逻辑顺序组织（概念 → 规则 → 实践 → 常见问题）
- 合并重复内容
- 补充必要的过渡和衔接
- 标注每个知识点来源的原子ID（便于追溯）
```

---

## 四、数据存储

### 新增文件

```
~/Library/Application Support/memora/
├── notebook/
│   ├── notes.json              # [已有] 笔记
│   └── categories.json         # [已有] 分类
├── knowledge/                  # [新增] 知识体系
│   ├── atoms.json              # 知识原子库
│   ├── clusters.json           # 知识簇库
│   └── articles/               # 知识文章目录
│       ├── article_xxx.md      # Markdown 文章文件
│       └── articles.json       # 文章元数据索引
```

### atoms.json 示例

```json
[
  {
    "id": "atom_1717660800000_abc",
    "content": "ADP V2 接口 AppKey 必须放在 Body 中",
    "source_note_ids": ["note_1717660800000_xyz"],
    "domain": "技术-ADP",
    "type": "rule",
    "importance": 0.9,
    "cluster_id": "cluster_adp_integration",
    "created_at": "2026-06-05T10:00:00Z"
  }
]
```

### clusters.json 示例

```json
[
  {
    "id": "cluster_adp_integration",
    "name": "ADP 接入与调用",
    "domain": "技术-ADP",
    "description": "ADP 智能体开发平台的接入规范与API调用",
    "atom_ids": ["atom_001", "atom_002"],
    "keywords": ["ADP", "AppKey", "SSE"],
    "status": "growing",
    "article_id": null,
    "created_at": "2026-06-05T10:00:00Z",
    "updated_at": "2026-06-05T10:00:00Z"
  }
]
```

### articles.json 示例

```json
[
  {
    "id": "article_adp_integration_v1",
    "cluster_id": "cluster_adp_integration",
    "title": "ADP 智能体平台接入指南",
    "file_path": "articles/article_adp_integration_v1.md",
    "version": 1,
    "atom_count": 8,
    "source_note_count": 5,
    "tags": ["ADP", "API", "SSE"],
    "created_at": "2026-06-05T10:00:00Z",
    "updated_at": "2026-06-05T10:00:00Z"
  }
]
```

---

## 五、UI 设计

### 在现有"知识"Tab 下新增两个子视图

```
知识 Tab
├── 智能推荐（已有）
├── 知识图谱（新增）← 默认子视图
└── 知识文章（新增）
```

### 5.1 知识图谱视图

**布局**：左侧领域树 + 右侧知识簇卡片

```
┌─────────────────────────────────────────────┐
│ 🔍 搜索知识...           [整理知识] [全屏]   │
├──────────┬──────────────────────────────────┤
│ 领域     │  知识簇卡片网格                    │
│          │                                    │
│ 📂 技术  │  ┌──────────┐  ┌──────────┐      │
│   ├ ADP  │  │ ADP 接入  │  │ 部署规范  │      │
│   ├ 部署 │  │ 8 原子    │  │ 5 原子    │      │
│   └ 数据 │  │ 🟢 已萃取  │  │ 🟡 成熟   │      │
│ 📂 产品  │  │ [查看文章] │  │ [生成文章] │      │
│   ├ 智能体│  └──────────┘  └──────────┘      │
│   └ 客户  │                                    │
│ 📂 项目  │  ┌──────────┐  ┌──────────┐      │
│   ├ AutoM │  │ 客户需求  │  │ 竞品分析  │      │
│   └ Cogni │  │ 3 原子    │  │ 2 原子    │      │
│          │  │ 🔵 积累中  │  │ 🔵 积累中  │      │
│          │  └──────────┘  └──────────┘      │
├──────────┴──────────────────────────────────┤
│ 📊 总计 18 个知识原子 · 5 个知识簇 · 1 篇文章 │
└─────────────────────────────────────────────┘
```

**知识簇卡片状态色**：
- 🔵 积累中（growing, < 5 原子）
- 🟡 成熟（mature, ≥ 5 原子，可萃取）
- 🟢 已萃取（distilled，有文章）

### 5.2 知识簇详情（点击卡片展开）

```
┌─────────────────────────────────────────────┐
│ ← 返回    ADP 接入与调用                      │
│ 领域：技术-ADP · 8 个知识原子 · 状态：已萃取    │
├─────────────────────────────────────────────┤
│ 📝 知识原子列表                               │
│                                               │
│ 🔴 [rule]  AppKey 必须放在 Body 中       0.9  │
│ 🟠 [fact]  V1 用 snake_case, V2 用 Pascal 0.7│
│ 🔵 [procedure] 部署流程：构建→上传→cp→reload 0.8│
│ 🟢 [insight] 客户更关注交付速度           0.6  │
│                                               │
│ 📄 知识文章                                   │
│ [ADP 智能体平台接入指南 v1]  ← 点击阅读/编辑   │
│                                               │
│ 📎 原始笔记（5条）                             │
│ [6/3 14:20] V1 接口 AppKey...                 │
│ [6/4 09:15] ADP V2 调用规范...                 │
│ [6/5 16:30] 端口冲突问题...                    │
├─────────────────────────────────────────────┤
│ [🔄 重新萃取]  [➕ 手动添加原子]  [🗑 删除簇]  │
└─────────────────────────────────────────────┘
```

### 5.3 知识文章视图

```
┌─────────────────────────────────────────────┐
│ 📚 知识文章                    [按领域筛选▼]  │
├─────────────────────────────────────────────┤
│                                               │
│ ┌────────────────────────────────────────┐   │
│ │ ADP 智能体平台接入指南                   │   │
│ │ 技术-ADP · v1 · 8 原子 · 2026-06-05    │   │
│ │ [阅读] [编辑] [导出]                    │   │
│ └────────────────────────────────────────┘   │
│                                               │
│ ┌────────────────────────────────────────┐   │
│ │ 腾讯云 Lighthouse 部署规范              │   │
│ │ 技术-部署 · v2 · 12 原子 · 2026-06-03  │   │
│ │ [阅读] [编辑] [导出]                    │   │
│ └────────────────────────────────────────┘   │
│                                               │
└─────────────────────────────────────────────┘
```

**文章阅读模式**：全屏 Markdown 渲染，左侧目录导航，右侧原子溯源面板

---

## 六、IPC 接口设计

### 知识原子

```
knowledge:get-atoms          → 获取所有原子（支持 domain/filter）
knowledge:get-atom-by-id     → 获取单个原子
knowledge:add-atom           → 手动添加原子
knowledge:delete-atom        → 删除原子
knowledge:extract-atoms      → AI 从笔记中提取原子
```

### 知识簇

```
knowledge:get-clusters       → 获取所有簇（支持 status filter）
knowledge:get-cluster-by-id  → 获取簇详情（含原子列表）
knowledge:create-cluster     → 手动创建簇
knowledge:update-cluster     → 更新簇
knowledge:delete-cluster     → 删除簇（含原子处理选项）
knowledge:cluster-atom       → 将原子归入簇
knowledge:auto-cluster       → AI 自动聚类
```

### 知识文章

```
knowledge:get-articles       → 获取所有文章元数据
knowledge:get-article        → 获取文章内容（从文件读取）
knowledge:generate-article   → AI 从簇生成文章
knowledge:update-article     → 更新文章内容
knowledge:delete-article     → 删除文章
knowledge:export-article     → 导出为 MD 文件
```

### 触发操作

```
knowledge:distill-all        → 一键萃取（提取+聚类+合成）
knowledge:distill-notes      → 从指定笔记中提取原子
```

---

## 七、AI 调用方案

### 使用 DeepSeek API（已有配置）

```javascript
// 阶段1：原子提取（每次新笔记时调用，轻量）
const ATOM_EXTRACTION_PROMPT = `
从以下笔记内容中提取1-3个知识原子。
每个原子是一个独立的、可复用的知识点，要求：
- 用一句话精确描述
- 标注类型：fact(事实)/rule(规则)/insight(洞察)/procedure(步骤)
- 标注所属领域
- 评估重要度(0-1)

笔记内容：
{note_content}
`;

// 阶段2：聚类（每日或手动，中等）
const CLUSTERING_PROMPT = `
以下是所有未归簇的知识原子，请：
1. 按主题分组，每组给名称和描述
2. 尝试匹配已有知识簇（如果主题相近则归入）
3. 新建簇给出建议名称
4. 标记成熟簇（原子数≥5）

已有知识簇：{existing_clusters}
待聚类原子：{unclustered_atoms}
`;

// 阶段3：文章合成（手动触发，重量级）
const ARTICLE_SYNTHESIS_PROMPT = `
以下是关于「{cluster_name}」的所有知识原子，请合成一篇结构化的知识文章。

要求：
- Markdown 格式，含标题层级
- 按逻辑组织：概述 → 核心规则 → 操作步骤 → 常见问题
- 合并重复、补充过渡
- 每段末尾标注 [atom:xxx] 便于溯源
- 末尾列出所有原子来源的原始笔记摘要

知识原子列表：
{atoms}
`;
```

### 调用频率控制

| 阶段 | 频率 | Token 消耗 | 模型建议 |
|------|------|-----------|---------|
| 原子提取 | 每次新笔记 | ~500 tokens | deepseek-v4-flash |
| 聚类 | 每日/手动 | ~2000 tokens | deepseek-v4-flash |
| 文章合成 | 手动 | ~3000 tokens | deepseek-v4-pro |

---

## 八、实现优先级

### Phase 1（MVP - 核心闭环）
1. ✅ 知识原子数据模型 + 存储
2. ✅ 笔记保存时自动提取原子
3. ✅ 知识簇数据模型 + 手动创建
4. ✅ 手动将原子归入簇
5. ✅ 知识图谱基础 UI（簇卡片 + 原子列表）

### Phase 2（AI 自动化）
6. ✅ AI 自动聚类
7. ✅ AI 文章合成
8. ✅ 知识文章阅读/编辑 UI
9. ✅ 簇状态自动流转

### Phase 3（增强体验）
10. ✅ 领域树自动构建
11. ✅ 文章版本管理（新原子加入后可重新萃取）
12. ✅ 知识文章导出（MD 文件）
13. ✅ 原子溯源（从文章跳转到原始笔记）
14. ✅ 知识图谱可视化（节点连线图）

---

## 九、与现有系统的集成点

```
剪贴板监听 → AI 分析 → is_valid_info=true
                          ↓
                     保存到记事本（已有）
                          ↓
                   自动提取知识原子（新增）
                          ↓
                   匹配/创建知识簇（新增）
                          ↓
               簇成熟 → 推送"可生成文章"提醒
                          ↓
                   用户点击 → AI 合成文章
                          ↓
                   知识文章库（新增 Tab）
```

### 快捷问题胶囊更新

```
📚 整理笔记 → 触发知识萃取流程（提取+聚类）
🧠 整理记忆 → 触发完整萃取（含文章合成）
```
