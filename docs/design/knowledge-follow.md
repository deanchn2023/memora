# 知识跟随（Knowledge Follow）功能设计文档

> 版本：v1.0 | 作者：Dean Chen | 设计日期：2026-06-03
> 所属项目：忆境 Memora v1.2.1

---

## 一、功能概述

"知识跟随"是 Memora 的主动知识获取模块，通过监听剪贴板内容和用户主动搜索，调用 ADP 智能体获取相关知识，实现"剪贴板感知 → 知识推荐 → 主动搜索"的闭环。

### 核心能力

1. **剪贴板感知分类**：识别剪贴板内容中"搜索知识/获取文档/查询问题/有疑问"的意图，自动调用 ADP
2. **智能推荐**：基于当前工作上下文，ADP 主动推送相关知识（关联本机 IP/MAC）
3. **主动搜索**：用户输入关键词，同时走本地数据库模糊搜索 + ADP 问答两个通道

---

## 二、UI 设计

### 2.1 导航入口

在顶部 `view-tabs` 新增"知识"标签：

```
[ 日 | 周 | 月 | 记事本 | 知识 ]
                              ↑ 新增
```

### 2.2 知识跟随页面布局

```
┌─────────────────────────────────────────────────────────┐
│  🔍 搜索框：输入关键词搜索知识...          [ADP搜索] [本地搜索] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  🤖 智能推荐                    [刷新] [设置]     │    │
│  │  ──────────────────────────────────────────── │    │
│  │  📎 基于「剪贴板最近内容」推荐                     │    │
│  │                                                │    │
│  │  ┌──────────────────────────────────────┐      │    │
│  │  │ 🔵 ADP推荐 | 什么是ADP智能体开发平台？  │      │    │
│  │  │ ADP是腾讯云推出的智能体开发平台...     │      │    │
│  │  │ 📅 2分钟前  | 来源: ADP  | 💾 保存    │      │    │
│  │  └──────────────────────────────────────┘      │    │
│  │                                                │    │
│  │  ┌──────────────────────────────────────┐      │    │
│  │  │ 🔵 ADP推荐 | ADP V2接口调用规范        │      │    │
│  │  │ V2接口使用PascalCase字段命名...       │      │    │
│  │  │ 📅 5分钟前  | 来源: ADP  | 💾 保存    │      │    │
│  │  └──────────────────────────────────────┘      │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  🔎 搜索结果                                     │    │
│  │  ──────────────────────────────────────────── │    │
│  │                                                │    │
│  │  ┌─ 本地知识（3条）──────────────────────────┐  │    │
│  │  │ 📚 [记忆] ADP V2 SSE前端对接经验           │  │    │
│  │  │    8条关键陷阱与解决方案...                │  │    │
│  │  │    📅 2026-05-28 | 匹配度 92%             │  │    │
│  │  ├────────────────────────────────────────── │  │    │
│  │  │ 📚 [笔记] 腾讯云ADP调用规范               │  │    │
│  │  │    V1/V2接口、鉴权、错误码...             │  │    │
│  │  │    📅 2026-05-27 | 匹配度 85%             │  │    │
│  │  ├────────────────────────────────────────── │  │    │
│  │  │ 📚 [记忆] ADPToolkit服务器部署信息          │  │    │
│  │  │    访问地址: http://21.91.29.59:3000...   │  │    │
│  │  │    📅 2026-05-26 | 匹配度 71%             │  │    │
│  │  └──────────────────────────────────────────┘  │    │
│  │                                                │    │
│  │  ┌─ ADP 问答 ──────────────────────────────┐  │    │
│  │  │ 🤖 正在思考...                            │  │    │
│  │  │                                            │  │    │
│  │  │ ADP（智能体开发平台）是腾讯云推出的...      │  │    │
│  │  │                                            │  │    │
│  │  │ ## 核心特性                               │  │    │
│  │  │ 1. 可视化编排工作流                       │  │    │
│  │  │ 2. 多模型支持                             │  │    │
│  │  │ 3. SSE 流式输出                           │  │    │
│  │  │ ▌  ← 流式输出光标                        │  │    │
│  │  │                                            │  │    │
│  │  │ [💾 保存到知识库] [📋 复制] [❌ 忽略]      │  │    │
│  │  └──────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 2.3 剪贴板分类标签

在现有剪贴板检测弹窗（`clipboardDetector`）中增加意图分类标签：

```
┌─────────────────────────────────────────┐
│  📋 检测到内容                           │
│                                          │
│  原文: ADP V2接口的AppKey必须放在Body...   │
│                                          │
│  意图识别:                                │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │
│  │🔍搜索 │ │📄文档 │ │❓查询 │ │🤔疑问 │   │
│  │ 知识  │ │ 获取 │ │ 问题 │ │      │   │
│  └──────┘ └──────┘ └──────┘ └──────┘   │
│      ↑ 高亮当前识别到的意图               │
│                                          │
│  [创建任务] [保存笔记] [🔍搜索知识] [忽略] │
│                           ↑ 新增按钮      │
└─────────────────────────────────────────┘
```

---

## 三、数据模型

### 3.1 新增数据库表：knowledge_items

```javascript
// 存储路径: {userData}/knowledge/knowledge-items.json

const KnowledgeItem = {
  id: 'ki_1709280000000_a1b2c3',        // 唯一ID
  title: 'ADP V2接口调用规范',            // 标题
  content: 'V2接口使用PascalCase...',     // 内容（Markdown）
  source: 'adp_recommend | adp_search | local_memory | local_notebook',  // 来源
  source_id: 'mem_xxx | note_xxx | null', // 关联的本地记忆/笔记ID
  query: 'ADP V2 接口',                   // 触发搜索的关键词
  intent: 'search_knowledge | get_document | query_question | doubt',  // 剪贴板意图
  device_fingerprint: 'mac_xxx_ip_xxx',   // 设备指纹（IP+MAC关联）
  tags: ['ADP', 'API', '腾讯云'],         // 标签
  is_saved: true,                          // 用户是否已保存
  adp_conversation_id: 'xxx',             // ADP对话ID（用于追问）
  relevance_score: 0.92,                  // 相关度分数
  created_at: '2026-06-03T12:00:00Z',     // 创建时间
  updated_at: '2026-06-03T12:00:00Z',     // 更新时间
};
```

### 3.2 新增数据库表：knowledge_recommendations

```javascript
// 存储路径: {userData}/knowledge/recommendations.json
// 智能推荐的独立存储，按设备指纹分组

const KnowledgeRecommendation = {
  id: 'kr_xxx',
  device_fingerprint: 'mac_xxx_ip_xxx',  // 设备指纹
  clipboard_hash: 'abc123',               // 触发的剪贴板内容哈希
  clipboard_preview: 'ADP V2接口的AppKey...', // 剪贴板预览
  knowledge_item_id: 'ki_xxx',            // 关联的知识项
  is_read: false,                          // 是否已读
  is_saved: false,                         // 是否已保存
  created_at: '2026-06-03T12:00:00Z',
};
```

### 3.3 设备指纹

```javascript
// 设备指纹 = MAC地址哈希 + IP地址哈希
// 用于关联智能推荐知识到特定设备
function getDeviceFingerprint() {
  const mac = getMacAddress();    // 获取主网卡MAC
  const ip = getLocalIP();        // 获取本机IP
  return `mac_${hash(mac)}_ip_${hash(ip)}`;
}
```

---

## 四、剪贴板意图分类

### 4.1 意图类型定义

| 意图类型 | 枚举值 | 触发信号 | ADP行为 |
|---------|--------|---------|---------|
| 搜索知识 | `search_knowledge` | "搜索"、"查找"、"什么是"、"how to"、"了解" | 调用ADP搜索相关知识 |
| 获取文档 | `get_document` | "文档"、"文档在哪"、"API文档"、"使用指南"、"手册" | 调用ADP获取文档链接/摘要 |
| 查询问题 | `query_question` | "为什么"、"怎么解决"、"报错"、"error"、"问题" | 调用ADP回答问题 |
| 有疑问 | `doubt` | "不确定"、"是不是"、"好像"、"？？"、多个问号 | 调用ADP澄清/解释 |

### 4.2 意图识别规则

在现有 `preClassify()` 后增加意图分类步骤：

```javascript
function classifyClipboardIntent(text) {
  const intentPatterns = {
    search_knowledge: [
      /搜索|查找|寻找|什么是|什么是|how to|了解|学习|研究|看看.*是什么/i,
      /怎么用|如何使用|怎么操作|教程|指南|入门/i
    ],
    get_document: [
      /文档|API文档|使用手册|开发指南|参考文档|SDK文档/i,
      /在哪找|哪里有|下载地址|仓库地址|官方文档/i
    ],
    query_question: [
      /为什么|怎么解决|报错|error|异常|failed|问题/i,
      /为什么.*不|怎么.*不行|无法|不能|失败/i
    ],
    doubt: [
      /不确定|是不是|好像|似乎|应该.*吧|？？/i,
      /\?{2,}/  // 多个问号
    ]
  };
  
  const scores = {};
  for (const [intent, patterns] of Object.entries(intentPatterns)) {
    scores[intent] = 0;
    for (const pattern of patterns) {
      if (pattern.test(text)) scores[intent] += 1;
    }
  }
  
  const maxScore = Math.max(...Object.values(scores));
  if (maxScore === 0) return null;  // 无明确意图
  return Object.entries(scores).find(([_, s]) => s === maxScore)[0];
}
```

---

## 五、ADP 集成设计

### 5.1 ADP 配置

```
AppKey: VnIvLvjBTdjXFNmqBnQFsAhDdHPuzELARwKgYwZwvEqBRiIViQamZAGgKXBbOqZNwMbvFvIYwIkYxgkjmtrcaUUqdXsMPXnNbqTxOJohdOXHzLNCYKloszFwrcEKSDcK
URL: https://wss.lke.cloud.tencent.com/adp/v2/chat
```

### 5.2 ADP SSE 流式调用（主进程）

采用 HTTP SSE 方式（比 WebSocket 更适合 Electron 主进程）：

```javascript
// main.js 新增 IPC
ipcMain.handle('knowledge:search-adp', async (event, { query, intent, conversationId }) => {
  const appKey = 'VnIvLvjBTdjXFNmqBnQFsAhDdHPuzELARwKgYwZwvEqBRiIViQamZAGgKXBbOqZNwMbvFvIYwIkYxgkjmtrcaUUqdXsMPXnNbqTxOJohdOXHzLNCYKloszFwrcEKSDcK';
  const url = 'https://wss.lke.cloud.tencent.com/adp/v2/chat';
  
  const requestBody = {
    RequestId: generateRequestId(),
    ConversationId: conversationId || generateRequestId(),
    AppKey: appKey,
    VisitorId: getDeviceFingerprint(),  // 使用设备指纹作为VisitorId
    Contents: [{ Type: 'text', Text: query }],
    Incremental: true,
    Stream: 'enable',
    StreamingThrottle: 5,
  };
  
  // 返回一个可取消的流式 Promise
  // 使用 EventSource 或 fetch + ReadableStream 处理 SSE
  // 通过 event.sender.send() 逐块推送到渲染进程
});
```

### 5.3 流式输出渲染策略

**问题**：ADP SSE 流式输出时，如何在前端友好显示？

**方案**：分段渲染 + Markdown 实时解析

```
┌──────────────────────────────────────┐
│ 🤖 ADP 回答中...                      │
│                                       │
│ ADP（智能体开发平台）是腾讯云推出的一   │
│ 个企业级 AI 应用构建平台。              │
│                                       │
│ ## 核心特性                           │
│ 1. 可视化编排工作流  ▌  ← 闪烁光标    │
│                                       │
│ [⏸ 暂停] [⏹ 停止]                    │
└──────────────────────────────────────┘
```

**实现要点**：

1. **增量追加**：主进程通过 `webContents.send('knowledge:adp-chunk', { text, done })` 逐块推送
2. **Markdown 渲染**：使用轻量 Markdown 解析器实时渲染（marked.js 或类似）
3. **光标动画**：流式输出时显示闪烁的 `▌` 光标，完成后移除
4. **暂停/停止**：提供暂停和停止按钮，允许用户中断流式输出
5. **自动滚动**：新内容到达时自动滚动到底部
6. **完成标记**：`done: true` 时移除光标，显示操作按钮

---

## 六、本地知识搜索

### 6.1 模糊搜索逻辑

同时搜索记忆（MemoryStore）和笔记（Notebook）：

```javascript
async function searchLocalKnowledge(query, limit = 3) {
  const results = [];
  
  // 1. 搜索记忆系统
  const memories = memoryStore.searchRelated(query, 10);
  memories.forEach(m => {
    results.push({
      type: 'memory',
      id: m.id,
      title: m.content.substring(0, 50),
      content: m.content,
      category: m.category,
      createdAt: m.createdAt,
      score: calculateRelevance(query, m.content),
    });
  });
  
  // 2. 搜索记事本
  const notes = notebook.searchNotes(query);
  notes.forEach(n => {
    results.push({
      type: 'notebook',
      id: n.id,
      title: n.title || n.content.substring(0, 30),
      content: n.content,
      category: n.category,
      createdAt: n.createdAt,
      score: calculateRelevance(query, n.content),
    });
  });
  
  // 3. 按相关度排序，取 Top 3
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function calculateRelevance(query, content) {
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  let score = 0;
  const lower = content.toLowerCase();
  keywords.forEach(kw => {
    if (lower.includes(kw)) score += 1;
    // 完全匹配加权
    const regex = new RegExp(kw, 'gi');
    const matches = lower.match(regex);
    if (matches) score += matches.length * 0.5;
  });
  return Math.min(score / keywords.length, 1.0);
}
```

---

## 七、文件结构

```
src/
├── scripts/
│   ├── knowledgeFollow.js    ← 新增：知识跟随核心逻辑
│   ├── knowledgeSearch.js    ← 新增：本地知识搜索
│   ├── adpSSEClient.js       ← 新增：ADP SSE 流式客户端
│   ├── app.js                ← 修改：集成知识跟随
│   ├── memory.js
│   ├── notebook.js
│   └── ...
├── styles/
│   ├── main.css              ← 修改：新增知识跟随样式
│   ├── components.css        ← 修改：新增知识卡片组件样式
│   └── knowledge.css         ← 新增：知识跟随专用样式
├── index.html                ← 修改：新增知识标签页 + 视图
```

---

## 八、IPC 通信设计

### 8.1 新增 IPC 处理器（main.js）

| 通道 | 方向 | 参数 | 说明 |
|------|------|------|------|
| `knowledge:search-adp` | 渲染→主 | `{ query, intent, conversationId }` | ADP 搜索（返回流式） |
| `knowledge:search-local` | 渲染→主 | `{ query, limit }` | 本地知识搜索 |
| `knowledge:save-item` | 渲染→主 | `{ id, title, content, source, tags }` | 保存知识项 |
| `knowledge:delete-item` | 渲染→主 | `{ id }` | 删除知识项 |
| `knowledge:get-recommendations` | 渲染→主 | `{ deviceFingerprint }` | 获取智能推荐 |
| `knowledge:get-history` | 渲染→主 | `{ limit, offset }` | 获取搜索历史 |
| `knowledge:classify-intent` | 渲染→主 | `{ text }` | 剪贴板意图分类 |
| `knowledge:adp-chunk` | 主→渲染 | `{ text, done, conversationId }` | ADP 流式推送 |
| `knowledge:recommendation-new` | 主→渲染 | `{ recommendation }` | 新推荐通知 |

### 8.2 剪贴板流程变更

```
剪贴板内容变化
    │
    ▼
preClassify()  ──→ 不通过 → 保存到记事本（现有流程）
    │
    ▼ 通过
    │
classifyClipboardIntent()  ──→ 无意图 → 现有任务识别流程
    │
    ▼ 有意图
    │
    ├── 保存到记事本（现有流程不变）
    │
    └── 异步调用 ADP 搜索
         │
         ▼
    knowledge:recommendation-new 推送到前端
         │
         ▼
    在知识跟随页面显示推荐
```

---

## 九、样式设计（Apple Design Language）

遵循项目现有设计规范：

- **主色**：Apple Blue `#4F8EF7` → 知识标签页用 `#4F8EF7`
- **ADP 推荐卡片**：左侧蓝色边框 `3px solid #4F8EF7`，背景 `rgba(79, 142, 247, 0.04)`
- **本地知识卡片**：左侧绿色边框 `3px solid #34C759`，背景 `rgba(52, 199, 89, 0.04)`
- **意图标签**：
  - 搜索知识：蓝色 `#4F8EF7`
  - 获取文档：紫色 `#8B5CF6`
  - 查询问题：橙色 `#FF9500`
  - 有疑问：灰色 `#86868b`
- **流式光标**：`▌` 闪烁动画 `animation: blink 1s step-end infinite`
- **毛玻璃效果**：`backdrop-filter: blur(20px) saturate(180%)`
- **圆角**：`--radius-lg` (18px)
- **Spring 动效**：`cubic-bezier(0.2, 0.8, 0.2, 1)`

---

## 十、开发排期

### Phase 1：基础框架（1天）

- [ ] HTML 新增"知识"标签页 + 知识跟随视图
- [ ] CSS 新增知识跟随样式
- [ ] `knowledgeFollow.js` 基础框架
- [ ] `knowledgeSearch.js` 本地搜索实现

### Phase 2：ADP 集成（1天）

- [ ] `adpSSEClient.js` SSE 流式客户端
- [ ] main.js 新增 IPC 处理器
- [ ] preload.js 暴露新 API
- [ ] 流式输出渲染（增量追加 + Markdown + 光标）

### Phase 3：剪贴板意图（0.5天）

- [ ] `classifyClipboardIntent()` 意图分类
- [ ] 剪贴板检测弹窗增加意图标签 + "搜索知识"按钮
- [ ] 自动调用 ADP 获取推荐

### Phase 4：智能推荐（0.5天）

- [ ] 设备指纹（IP + MAC）
- [ ] 推荐列表渲染
- [ ] 保存/删除/已读状态管理
- [ ] 知识项数据持久化

---

## 十一、风险与注意事项

1. **ADP AppKey 安全**：AppKey 存储在 settings 中（复用现有 `adp_app_key` 字段），不硬编码在代码中。用户提供的 AppKey 作为默认值写入设置。
2. **流式输出性能**：大量 Markdown 内容实时渲染可能导致卡顿，需做防抖（50ms 合并一次 DOM 更新）。
3. **ADP 调用频率**：剪贴板意图触发的 ADP 调用需受 `canMakeAICall()` 限制，避免超频。
4. **设备指纹隐私**：仅使用 MAC/IP 的哈希值，不存储原始值。
5. **CSP 策略**：`index.html` 的 Content-Security-Policy 已允许 `wss://wss.lke.cloud.tencent.com`，SSE 连接无需额外修改。
