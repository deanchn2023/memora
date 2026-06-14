# 知识聚类分批处理设计

## 1. 问题分析

### 现状

当前 `autoClusterAtoms()` 函数（`main.js:5012`）的实现：

```
1. 获取所有未归簇原子 → unclustered[]
2. 拼接已有簇信息 + 全部未归簇原子为一个 prompt
3. 一次性发送给 AI
4. 解析 JSON 结果
```

### 问题：Prompt 超出上下文长度

**Token 估算**：

| 部分 | 计算 | 估算 Token |
|------|------|-----------|
| Prompt 模板 | 固定文本 | ~300 |
| 已有簇信息 | 每簇 ≈ `ID: cluster_xxx | 名称: xxx | 领域: xxx | 关键词: a/b/c` ≈ 60 token | N簇 × 60 |
| 未归簇原子 | 每原子 ≈ `ID: atom_xxx | 内容: xxx(50字) | 类型: fact | 领域: 通用` ≈ 80 token | M原子 × 80 |
| 输出 JSON | 每个 assignment ≈ 60 token | M × 60 |

**临界点计算**（以 DeepSeek V4 的 64K 上下文为例）：

| 未归簇原子数 | 已有簇数 | 输入 Token | 输出 Token | 总计 | 是否安全 |
|-------------|---------|-----------|-----------|------|---------|
| 20 | 5 | ~2,100 | ~1,200 | ~3,300 | ✅ |
| 50 | 10 | ~5,300 | ~3,000 | ~8,300 | ✅ |
| 100 | 20 | ~11,300 | ~6,000 | ~17,300 | ⚠️ 接近小模型限制 |
| 200 | 30 | ~22,300 | ~12,000 | ~34,300 | ❌ 超出部分模型限制 |
| 500+ | 50+ | ~55,000+ | ~30,000+ | ~85,000+ | ❌ 严重超出 |

**结论**：当未归簇原子 > 100 或已有簇 > 20 时，单次调用极易失败。

### 其他问题

1. **`max_tokens: 2000` 太小**：200 个原子的 assignment 需要 ~12,000 token 输出，当前 `max_tokens: 2000` 会被截断导致 JSON 不完整
2. **无重试机制**：API 返回截断后直接报"格式异常"
3. **原子内容无截断**：长内容原子（如整段笔记）完整写入 prompt，极大浪费 token
4. **已有簇信息膨胀**：30+ 个簇的描述就占 ~1,800 token

---

## 2. 设计方案：分层分批聚类

### 2.1 核心思路

```
               ┌─────────────────────────────────────┐
               │       Step 1: 内容摘要压缩           │
               │   原子内容截断 + 簇信息精简           │
               └────────────────┬────────────────────┘
                                │
               ┌────────────────▼────────────────────┐
               │     Step 2: 分批聚类（核心）          │
               │   每批 ≤ N 个原子，独立 AI 调用       │
               └────────────────┬────────────────────┘
                                │
               ┌────────────────▼────────────────────┐
               │     Step 3: 批间合并去重              │
               │   不同批可能创建同名簇 → 合并          │
               └────────────────┬────────────────────┘
                                │
               ┌────────────────▼────────────────────┐
               │     Step 4: 结果持久化               │
               │   批量写入簇 + 归属关系               │
               └─────────────────────────────────────┘
```

### 2.2 Step 1: 内容摘要压缩

**问题**：原始原子内容可能是长文本（剪贴板复制的完整段落），直接塞进 prompt 浪费 token。

**方案**：

```javascript
// 原子内容压缩：保留核心语义，截断过长内容
function compressAtomContent(atom) {
  let content = atom.content || '';
  if (content.length > 80) {
    // 截取前 60 字 + "..." + 后 20 字（保留首尾关键信息）
    content = content.substring(0, 60) + '...' + content.substring(content.length - 20);
  }
  return content;
}

// 簇信息精简：只保留 ID + 名称 + 关键词（省略描述）
function compressClusterInfo(cluster) {
  return `ID:${cluster.id} | ${cluster.name} | ${cluster.keywords.slice(0, 3).join('/')}`;
}
```

**效果**：每个原子从 ~80 token 降到 ~40 token，每个簇从 ~60 token 降到 ~25 token。

---

### 2.3 Step 2: 分批聚类

**批次大小计算**：

目标：每批 prompt 总 token ≤ 8,000（为输出留充足空间）。

```
批次 token 预算 = 8,000
- 模板固定开销: ~300
- 已有簇信息: min(clusterCount, 30) × 25 ≈ 750
- 输出预留: ~3,000
= 可用于原子: ~4,000
= 每批原子数: 4000 / 40 ≈ 100
```

**安全上限**：每批 **80 个原子**（含冗余），超出则分批。

**分批策略**：

```javascript
function splitIntoBatches(atoms, batchSize = 80) {
  const batches = [];
  for (let i = 0; i < atoms.length; i += batchSize) {
    batches.push(atoms.slice(i, i + batchSize));
  }
  return batches;
}
```

**每批独立调用 AI**：

```javascript
for (const batch of batches) {
  const prompt = buildClusteringPrompt(existingClusters, batch);
  const result = await callAIClustering(prompt);
  // 收集结果
  allAssignments.push(...result.assignments);
}
```

---

### 2.4 Step 3: 批间合并去重

**问题**：不同批次可能创建同名或高度相似的簇。

**方案**：所有批次完成后，统一做一次合并。

```
Batch 1 创建: "ADP 开发" → cluster_001
Batch 2 创建: "ADP 开发实践" → cluster_002   ← 应合并
Batch 3 创建: "智能体开发" → cluster_003      ← 应合并
```

**合并逻辑**：

```javascript
function mergeBatchResults(allAssignments) {
  // 1. 收集所有新建簇的名称
  // 2. 对新簇名称做相似度检查（规则 + AI）
  // 3. 相似度 > 阈值的簇合并，原子归属到合并后的簇
  // 4. 使用现有的 knowledgeStore.mergeSimilarClusters() 
}
```

**轻量合并策略**（避免再调 AI）：

- 完全同名 → 直接合并
- 名称包含关系（"ADP 开发" ⊂ "ADP 开发实践"）→ 合并
- 名称差异大 → 保留独立

这步可以复用 `knowledgeStore.mergeSimilarClusters()` 的现有逻辑。

---

### 2.5 Step 4: 结果持久化

与现有逻辑一致，逐个执行 `knowledgeStore.clusterAtom()`。

新增：**进度回调**，让前端知道"第 X/Y 批完成"。

---

## 3. 完整流程

```
用户点击"智能聚类"
        │
        ▼
获取未归簇原子 (unclustered[])
        │
        ├── 数量 < 3 → 提示"原子不足"
        │
        ├── 数量 ≤ 80 → 单次调用（现有逻辑，优化 prompt）
        │
        └── 数量 > 80 → 分批模式
                │
                ├── Step 1: 压缩内容
                ├── Step 2: 分成 N 批（每批 ≤ 80）
                │      │
                │      ├── Batch 1 → AI 调用 → 收集结果 → 通知前端 "1/N"
                │      ├── Batch 2 → AI 调用 → 收集结果 → 通知前端 "2/N"
                │      └── ...
                │
                ├── Step 3: 合并去重
                └── Step 4: 持久化 → 通知前端完成
```

---

## 4. 配置参数

```javascript
const CLUSTERING_CONFIG = {
  // 批次大小
  BATCH_SIZE: 80,                    // 每批最大原子数
  SINGLE_CALL_THRESHOLD: 80,         // 单次调用阈值

  // 内容压缩
  ATOM_CONTENT_MAX_LENGTH: 80,       // 原子内容截断长度
  CLUSTER_INFO_MAX_COUNT: 30,        // 已有簇最大展示数（超出只展示前30）

  // AI 调用
  MAX_TOKENS_BATCH: 4000,            // 分批模式输出 token 上限
  MAX_TOKENS_SINGLE: 2000,           // 单次模式输出 token 上限
  TEMPERATURE: 0.3,                  // 聚类温度（低 = 更确定）

  // 批间间隔
  BATCH_DELAY_MS: 500,               // 批次间隔（避免 QPS 限制）

  // 重试
  MAX_RETRIES: 2,                    // 单批最大重试次数
};
```

---

## 5. 前端交互

### 5.1 进度展示

分批模式下，通过 IPC 事件推送进度：

```javascript
// main.js → renderer
mainWindow.webContents.send('knowledge:clustering-progress', {
  currentBatch: 2,
  totalBatches: 5,
  atomsAssigned: 85,
  message: '正在聚类第 2/5 批...'
});
```

### 5.2 前端 UI 状态

```
┌─────────────────────────────────────┐
│  ⏳ 智能聚类中...                     │
│  ████████░░░░░░  2/5 批完成          │
│  已归类 85 个知识原子                  │
│                                      │
│  [取消]                              │
└─────────────────────────────────────┘
```

### 5.3 取消支持

```javascript
let clusteringAborted = false;

// IPC: 取消聚类
ipcMain.handle('knowledge:cancel-clustering', () => {
  clusteringAborted = true;
});

// 每批开始前检查
for (const batch of batches) {
  if (clusteringAborted) break;
  // ...
}
```

---

## 6. 边缘情况

| 场景 | 处理策略 |
|------|----------|
| 某批 AI 返回截断的 JSON | 该批重试（最多 2 次），仍失败则跳过，其他批次继续 |
| 某批 API 限流 (429) | 等待 5s 后重试 |
| 批次间创建了重复簇 | Step 3 统一合并 |
| 全部批次失败 | 返回错误信息 + 已成功的部分结果 |
| 用户中途取消 | 保留已完成的批次结果，未执行的丢弃 |
| 已有簇 > 30 个 | 只展示最相关的 30 个（按原子数排序取前 30） |
| 原子内容包含特殊字符 | escape 处理，不影响 JSON 解析 |

---

## 7. 代码改动清单

### 7.1 main.js

| 改动点 | 说明 |
|--------|------|
| `autoClusterAtoms()` | 重构为分批模式，增加内容压缩、分批、合并逻辑 |
| 新增 `compressAtomContent()` | 原子内容截断 |
| 新增 `compressClusterInfo()` | 簇信息精简 |
| 新增 `splitIntoBatches()` | 分批逻辑 |
| 新增 `processClusteringBatch()` | 单批 AI 调用 + 解析 |
| 新增 `mergeBatchResults()` | 批间合并去重 |
| 新增 `knowledge:cancel-clustering` IPC | 取消聚类 |
| 新增 `knowledge:clustering-progress` 事件 | 进度推送 |
| `max_tokens` 参数 | 根据批次大小动态调整 |

### 7.2 preload.js

| 改动点 | 说明 |
|--------|------|
| 新增 `onKnowledgeClusteringProgress` | 监听进度事件 |
| 新增 `knowledgeCancelClustering` | 取消聚类 IPC |

### 7.3 knowledgeDistillation.js

| 改动点 | 说明 |
|--------|------|
| `autoCluster()` 方法 | 增加进度展示 UI |
| 新增 `cancelClustering()` 方法 | 取消聚类 |
| 进度条/状态 UI | 分批进度展示 |

### 7.4 prompts/knowledge_clustering.md

| 改动点 | 说明 |
|--------|------|
| 无需修改 | 分批模式下每批的 prompt 结构相同，只是原子数量减少 |

---

## 8. 实现优先级

| 优先级 | 改动 | 预估工作量 |
|--------|------|-----------|
| P0 | 内容压缩 + max_tokens 动态调整 | 0.5h |
| P0 | 分批逻辑 + 批间合并 | 1.5h |
| P1 | 进度推送 + 前端进度 UI | 1h |
| P2 | 取消支持 | 0.5h |
| P2 | 重试 + 限流处理 | 0.5h |

**建议先实现 P0**，即可解决"内容太多超出上下文"的核心问题。
