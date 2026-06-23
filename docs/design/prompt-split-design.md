# Prompt 拆分设计方案 — 剪贴板分析高频场景优化

> 目标：将当前 5000+ token 的单体 Prompt 拆分为多级流水线，降低 80%+ Token 消耗，提升响应速度。

---

## 一、现状分析

### 1.1 当前 Prompt 结构

| 文件 | `prompts/task_recognition_v2.0.md` |
|------|------|
| 总行数 | 375 行 |
| 估算 Token | ~5000 tokens（含变量注入后） |
| 调用频率 | 每次剪贴板检测（高频） |
| 职责 | 同时做 4 件事：待办识别 + 有效信息判定 + 推荐判定 + SMART 评估 |

### 1.2 问题

1. **Token 浪费严重**：80% 的剪贴板内容是闲聊/碎片/URL，不需要完整分析，但每次都发送 5000 token 的完整 Prompt
2. **延迟高**：大 Prompt = AI 思考时间长，用户体验差（每次复制后等待 2-5 秒）
3. **错误率叠加**：一个 Prompt 同时做 4 件事，任务越复杂出错率越高
4. **成本高**：高频 × 大 Prompt = API 费用高
5. **难以独立优化**：修改时间解析规则会影响整个 Prompt 的行为

### 1.3 数据流分析

```
实际剪贴板内容分布（估算）：
  闲聊/应答/问候    → 40%  → 当前浪费 100% token
  纯 URL/代码/JSON  → 20%  → preClassify 已过滤（0 token）
  有效信息/笔记     → 20%  → 只需信息提取，不需要待办/推荐逻辑
  待办任务          → 10%  → 需要完整的时间/SMART/优先级分析
  疑问/推荐         → 10%  → 只需要推荐意图分类
```

---

## 二、拆分架构设计

### 2.1 三级流水线

```
剪贴板文本
    │
    ▼
Level 0: 正则预过滤（0 token，已有 preClassify）
    │  纯代码/URL/JSON/超长文本 → 直接跳过
    │
    ▼
Level 1: 轻量意图分类（~400 token）
    │  Prompt: clipboard_classify.md
    │  输出: { intent: "chat|task|info|question", confidence, quick_tags }
    │
    ├── intent=chat, confidence>0.85 → 直接丢弃，不调后续 AI（省 90%+ token）
    │
    ├── intent=task → Level 2a: 任务创建 Prompt
    ├── intent=info → Level 2b: 信息提取 Prompt
    ├── intent=question → Level 2c: 推荐分类 Prompt
    └── intent=task+info → Level 2a + Level 2b 并行
         intent=info+question → Level 2b + Level 2c 并行
```

### 2.2 Token 对比

| 场景 | 占比 | 当前 token | 拆分后 token | 节省 |
|------|------|-----------|-------------|------|
| 闲聊/应答 | 40% | ~5000 | ~400 | **92%** |
| URL/代码（已过滤） | 20% | 0 | 0 | — |
| 有效信息 | 20% | ~5000 | ~400 + ~1200 = ~1600 | **68%** |
| 待办任务 | 10% | ~5000 | ~400 + ~1800 = ~2200 | **56%** |
| 疑问推荐 | 10% | ~5000 | ~400 + ~600 = ~1000 | **80%** |
| **加权平均** | | **~5000** | **~1400** | **72%** |

### 2.3 延迟对比

| 场景 | 当前延迟 | 拆分后延迟 | 提升 |
|------|---------|-----------|------|
| 闲聊 | ~2-3s | ~0.3s | **90%** |
| 有效信息 | ~2-3s | ~0.3s + ~1s = ~1.3s | **50%** |
| 待办任务 | ~3-5s | ~0.3s + ~1.5s = ~1.8s | **60%** |

---

## 三、拆分后的 Prompt 文件设计

### 3.1 `clipboard_classify.md` — Level 1 轻量意图分类

**职责**：快速判断剪贴板内容的意图类别，决定后续路由

**Token 目标**：~400 token（含变量注入后 ~600 token）

**注入变量**：
- `current_time`（当前时间，用于时间词检测）
- `user_name`（用户名，用于 @提及 检测）
- `frequent_persons`（高频人物名列表，简化版——只名字）

**不注入**（节省 token）：
- ~~完整用户画像~~
- ~~活跃项目详情~~
- ~~优先级信号~~
- ~~正负样本~~
- ~~自定义分类~~

**输出格式**：
```json
{
  "intent": "chat|task|info|question",
  "confidence": 0.0~1.0,
  "is_task": true/false,
  "is_valid_info": true/false,
  "needs_recommendation": true/false,
  "quick_reason": "≤30字原因"
}
```

**核心规则**（精简版）：
- @提及 + 行动 → task
- 疑问词 + 问号 → question
- 包含具体信息（数字/日期/人名/项目名）→ info
- 问候/应答/情绪/碎片 → chat

---

### 3.2 `clipboard_task_create.md` — Level 2a 任务创建

**职责**：当 Level 1 判定为 task 时，提取任务详情

**Token 目标**：~1800 token

**注入变量**：
- `current_time`（含完整时间推断规则）
- `user_profile`（完整画像）
- `frequent_persons` / `active_projects`
- `custom_categories`
- 正负样本（仅 task 相关）

**输出格式**：
```json
{
  "trace_id": "__TRACE_ID__",
  "title": "≤20字提炼标题",
  "description": "SMART优化后的描述",
  "time": { "raw": "...", "normalized": "YYYY-MM-DD HH:MM:SS|null", "is_all_day": bool },
  "priority": "high|medium|low",
  "task_type": "manual|ai_scheduled",
  "recurrence": { "type": "..." } | null,
  "tags": [...],
  "linked_persons": [...],
  "linked_projects": [...],
  "category": "...|null",
  "smart_level": "smart_full|smart_partial|smart_insufficient",
  "smart_missing": [...],
  "smart_optimized": bool,
  "reasoning_steps": [...]
}
```

**包含**（从原 Prompt 提取）：
- 待办任务判定规则
- 优先级判定
- 时间推断规则（完整版）
- SMART 评估与优化
- 标题提炼规则
- 任务类型识别
- 周期性识别
- 硬性规则（task 相关）

---

### 3.3 `clipboard_info_extract.md` — Level 2b 信息提取

**职责**：当 Level 1 判定为 info 时，提取笔记信息

**Token 目标**：~1200 token

**注入变量**：
- `user_profile`（简化版——只 name/role）
- `frequent_persons` / `active_projects`（简化版）
- `custom_categories`

**不注入**（info 不需要）：
- ~~时间推断规则~~（信息保存不需要计算时间）
- ~~优先级判定~~
- ~~周期性识别~~
- ~~任务类型识别~~

**输出格式**：
```json
{
  "trace_id": "__TRACE_ID__",
  "title": "≤20字提炼标题",
  "description": "优化后的描述",
  "content": "原始内容（优化后）",
  "tags": [...],
  "linked_persons": [...],
  "linked_projects": [...],
  "category": "...|null",
  "smart_level": "smart_full|smart_partial|smart_insufficient",
  "smart_missing": [...],
  "smart_optimized": bool,
  "reasoning_steps": [...]
}
```

**包含**（从原 Prompt 提取）：
- 有效信息判定规则
- 闲聊排除规则
- 标题提炼规则
- SMART 评估（简化版，去掉时间相关）
- 硬性规则（info 相关）

---

### 3.4 `clipboard_recommend.md` — Level 2c 推荐分类

**职责**：当 Level 1 判定为 question 时，分类推荐意图

**Token 目标**：~600 token

**注入变量**：
- 无（纯文本分析，不需要用户画像）

**输出格式**：
```json
{
  "trace_id": "__TRACE_ID__",
  "needs_recommendation": true,
  "recommendation_intent": "query_question|search_knowledge|get_document|doubt",
  "recommendation_query": "≤100字核心问题",
  "reason": "≤30字原因"
}
```

**包含**（从原 Prompt 提取）：
- 智能推荐判定规则
- 推荐意图分类
- 推荐查询提取规则

---

### 3.5 现有 Prompt 保留

| 现有文件 | 状态 | 说明 |
|---------|------|------|
| `memory_extraction_v2.0.md` | 保留不变 | 记忆提取，已有独立 Prompt |
| `task_recognition_v2.0.md` | 保留作为 fallback | 拆分后如果 Level 1 失败，降级为单体 Prompt |

---

## 四、路由逻辑设计

### 4.1 Level 1 → Level 2 路由规则

```javascript
async function analyzeClipboard(text, traceId) {
  // Level 0: 正则预过滤（已有 preClassify）
  const preResult = preClassify(text);
  if (preResult.skip) return { skipped: true, reason: preResult.reason };

  // Level 1: 轻量意图分类
  const classifyResult = await callAI({
    module: 'clipboard_classify',
    category: 'highvol',          // 用低延迟模型
    messages: [
      { role: 'system', content: classifyPrompt },
      { role: 'user', content: text }
    ],
    fetchOptions: { temperature: 0.1, max_tokens: 200 },  // 限制输出 token
    structured: true,
  });

  const classification = parseJSON(classifyResult);

  // 高置信度闲聊 → 直接丢弃
  if (classification.intent === 'chat' && classification.confidence > 0.85) {
    return { skipped: true, reason: 'chat', classification };
  }

  // Level 2: 根据意图并行调用
  const tasks = [];

  if (classification.is_task) {
    tasks.push(callTaskCreatePrompt(text, traceId));
  }
  if (classification.is_valid_info) {
    tasks.push(callInfoExtractPrompt(text, traceId));
  }
  if (classification.needs_recommendation) {
    tasks.push(callRecommendPrompt(text, traceId));
  }

  // 如果 Level 1 判断全为 false 但 confidence < 0.85，降级为完整 Prompt
  if (tasks.length === 0 && classification.confidence < 0.85) {
    return await callFullPrompt(text, traceId);  // 降级
  }

  // 并行执行
  const results = await Promise.all(tasks);

  // 合并结果
  return mergeResults(classification, results);
}
```

### 4.2 降级策略

```
Level 1 超时(>2s) 或 解析失败
    → 降级为完整 task_recognition_v2.0.md（单体 Prompt）
    → 保证功能不中断

Level 2a/2b/2c 任一失败
    → 该分支降级为单体 Prompt 处理
    → 其他分支正常执行
```

### 4.3 缓存策略

Level 1 的分类结果可缓存（相同文本 + 相同时间窗口内不重复调用）。

---

## 五、Prompt 文件清单

| 文件 | Level | 职责 | 目标 Token | 调用频率 |
|------|-------|------|-----------|---------|
| `clipboard_classify.md` | L1 | 意图分类 | ~400 | 每次剪贴板 |
| `clipboard_task_create.md` | L2a | 任务创建 | ~1800 | ~10% 流量 |
| `clipboard_info_extract.md` | L2b | 信息提取 | ~1200 | ~20% 流量 |
| `clipboard_recommend.md` | L2c | 推荐分类 | ~600 | ~10% 流量 |
| `task_recognition_v2.0.md` | Fallback | 降级完整版 | ~5000 | <5% 流量 |
| `memory_extraction_v2.0.md` | 独立 | 记忆提取 | ~1500 | 独立触发 |

**设置页面 Prompt 管理**：在 设置 → Prompt Tab 中新增以上 4 个文件的编辑入口。

---

## 六、实施计划

### Phase 1：创建拆分 Prompt 文件（2h）

| 任务 | 说明 |
|------|------|
| 创建 `clipboard_classify.md` | 从原 Prompt 提取分类规则，精简到 ~400 token |
| 创建 `clipboard_task_create.md` | 提取任务/时间/SMART/优先级规则 |
| 创建 `clipboard_info_extract.md` | 提取信息判定/标题提炼规则 |
| 创建 `clipboard_recommend.md` | 提取推荐判定/意图分类规则 |

### Phase 2：改造调用链（3h）

| 任务 | 说明 |
|------|------|
| 修改 `buildClipboardAnalysisPrompt` | 改为构建 Level 1 Prompt |
| 新增 `buildTaskCreatePrompt` | 构建 Level 2a |
| 新增 `buildInfoExtractPrompt` | 构建 Level 2b |
| 新增 `buildRecommendPrompt` | 构建 Level 2c |
| 修改剪贴板分析主流程 | Level 1 → 路由 → Level 2 并行 |
| 降级逻辑 | Level 1 失败时回退单体 Prompt |

### Phase 3：设置页面 + 测试（2h）

| 任务 | 说明 |
|------|------|
| 设置页面新增 4 个 Prompt 编辑入口 | 在 Prompt Tab 中展示 |
| 审计日志增加 level 字段 | 记录 L1/L2/fallback |
| 端到端测试 | 验证各类输入的路由正确性 |

**总工时：~7h**

---

## 七、预期收益

| 指标 | 当前 | 拆分后 | 提升 |
|------|------|--------|------|
| **加权平均 Token** | ~5000/次 | ~1400/次 | **-72%** |
| **闲聊场景延迟** | ~2-3s | ~0.3s | **-90%** |
| **待办场景延迟** | ~3-5s | ~1.8s | **-60%** |
| **API 月费用** | 100% | ~28% | **-72%** |
| **Prompt 可维护性** | 单体 375 行 | 4 个独立文件，各 50-150 行 | 大幅提升 |
| **独立优化能力** | 修改影响全局 | 各 Prompt 独立迭代 | 质变 |

---

## 八、风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| Level 1 分类错误导致路由错误 | 可能遗漏任务/信息 | confidence < 0.85 时降级为完整 Prompt |
| 两次 AI 调用增加总延迟（task 场景） | L1+L2 = 2 次调用 | L1 用 highvol 低延迟模型，L1+L2 总延迟仍 < 单体 |
| Prompt 文件增多增加管理复杂度 | 4 个文件 vs 1 个 | 设置页面统一管理 + 版本控制 |
| 并行调用 Level 2 的错误处理 | 某分支失败 | 各分支独立 try-catch + 降级 |

---

## 九、与现有反馈闭环的整合

```
Level 1 分类 → 用户操作（接受/拒绝/编辑）
    │
    ├── Level 1 分类正确 + Level 2 内容正确 → 正样本
    ├── Level 1 分类正确 + Level 2 内容错误 → Level 2 负样本（注入对应 L2 Prompt）
    ├── Level 1 分类错误 → Level 1 负样本（注入 classify.md）
    └── Level 1 降级为单体 → 降级负样本（注入 task_recognition_v2.0.md）
```

正负样本注入更精准：不再混在一起，而是按 Level 分别注入对应 Prompt。
