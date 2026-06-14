一、整体设计理念
核心思想：让 AI 从「一次性识别工具」进化为「会学习的个人认知伙伴」

维度	现状	目标
被动 → 主动	AI 只在剪贴板触发时工作	AI 定时主动总结、提醒、洞察
离散 → 关联	任务、记忆、笔记三个孤岛	三者交叉关联，形成知识图谱
静态 → 进化	Prompt 写死，不会自我优化	用户反馈 → Prompt 自动迭代
识别 → 理解	仅做单条信息分类	理解你的工作模式、人际、目标
三大原则：

数据闭环：每次用户操作（删除/转待办/修改）都是反馈信号
分级智能：轻量分类用本地规则 + 小模型，深度理解用 DeepSeek
可解释：AI 决策可追溯（为什么是这个优先级、为什么提取这条记忆）
二、五层智能架构
下面这个架构图清晰展示了模块之间的调用路径：



三、各层详细设计
🔹 L1 感知层（Perception）—— 信息进入
升级点：

预分类器（本地正则/规则） 先过滤 90% 无效内容，只让有价值的进 AI（省 API 钱、提速）
任务识别 AI 和 记忆提取 AI 改为并行调用（你目前可能是串行）
引入 "输入源元数据"：从哪里复制的（IDE/微信/邮箱/网页），AI 用这个上下文判断更准
调用路径：

剪贴板触发 → 预分类器(本地, 0ms) 
            → [并行] 任务识别 AI + 记忆提取 AI
            → 实体抽取 + 历史去重
            → 写入 L2 沉淀层
🔹 L2 沉淀层（Storage）—— 关键升级
新增 4 个核心数据结构：

① 用户画像档案（profile.json）—— L5 反哺过来
json
复制
{
  "user": {
    "name": "朱从坤",
    "english_name": "Dean",
    "role": "腾讯云ADP产品负责人",
    "industries": ["制造业", "能源行业"]
  },
  "frequent_persons": [
    {"name": "强总", "relation": "老板", "freq": 47},
    {"name": "康院", "relation": "客户", "company": "北汽福田", "freq": 12}
  ],
  "active_projects": [
    {"name": "BizDeck", "alias": ["必得PPT"], "status": "开发中"},
    {"name": "AutoMind", "alias": [], "status": "迭代中"}
  ],
  "work_patterns": {
    "peak_hours": "09:00-11:00, 14:00-17:00",
    "task_completion_rate": 0.78,
    "avg_task_duration_min": 45
  },
  "preferences": {
    "priority_signals": ["强总", "客户演示", "deadline"],
    "low_priority_signals": ["FYI", "可选", "有空"]
  }
}
② 实体关联图（entity_graph.json）
json
复制
{
  "entities": [
    {
      "id": "person_001",
      "name": "康院",
      "type": "person",
      "linked_entities": ["北汽福田", "FMEA智能体", "X实验室"],
      "linked_tasks": ["task_id_xxx"],
      "linked_memories": ["mem_id_xxx"],
      "linked_notes": ["note_id_xxx"]
    }
  ]
}
👉 这是「越用越聪明」的核心：未来出现"康院"两字，AI 自动知道是北汽福田的客户。

③ 反馈日志（feedback_log.jsonl）—— 每行一条
json
复制
{"ts":"2026-05-28T10:00","action":"reject","ai_output":{"is_task":true,"title":"..."},"reason":"实际是聊天"}
{"ts":"2026-05-28T10:05","action":"edit","ai_output":{"title":"开会"},"user_final":{"title":"和强总开北汽福田周会"}}
{"ts":"2026-05-28T11:00","action":"convert_note_to_task","note_id":"...","task_id":"..."}
{"ts":"2026-05-28T15:00","action":"delete_memory","mem_id":"...","reason":"重复"}
④ Prompt 版本库（prompts/）
prompts/
├── task_recognition_v1.0.md      # 初始版本
├── task_recognition_v1.1.md      # 优化版本
├── task_recognition_active.md    # 软链接到当前生效版本
└── changelog.md                  # 优化记录
🔹 L3 理解层（小助手核心）—— 关键升级
理念：把小助手从"聊天机器人"升级为"个人 CKO（首席知识官）"

4 个 Agent 各司其职：

Agent	职责	输入	输出
优先级规划 Agent	综合 deadline / 重要人物 / 用户工作时段，动态排程	全部任务 + 用户画像	今日 Top 5 + 排程时间
知识梳理 Agent	把碎片笔记按主题/项目自动归档，发现重复	笔记库 + 实体图	主题分组 + 重复合并建议
记忆整理 Agent	瞬时→短期→长期晋升，过期淘汰	全部记忆 + 时间戳	晋升列表 + 淘汰列表
日报/周报 Agent	自动生成工作总结 + 洞察	任务完成情况 + 反馈日志	Markdown 报告
统一调用入口（在 main.js 增加）：

javascript
复制
// 小助手任意复杂请求都走这个入口
async function assistantInvoke(userQuery) {
  // 1. 意图识别（小模型，本地或 DeepSeek）
  const intent = await classifyIntent(userQuery);
  // → "priority" | "knowledge" | "memory" | "report" | "chat"
  
  // 2. RAG 检索：从 L2 沉淀层捞相关数据
  const context = await ragRetrieve(userQuery, {
    tasks: 20,      // 召回 20 条相关任务
    memories: 10,   // 召回 10 条相关记忆
    notes: 5,       // 召回 5 条相关笔记
    profile: true   // 用户画像必带
  });
  
  // 3. 路由到对应 Agent（ADP 或 DeepSeek）
  return await dispatch(intent, context, userQuery);
}
🔹 L4 反馈层（关键创新点）—— 让 AI 学会自我修正
核心：用户每个动作都是免费的标注数据

5 类反馈信号：

用户操作	反馈含义	写入字段
AI 建议任务 → 用户接受	✅ 正样本	action: accept
AI 建议任务 → 用户拒绝	❌ 负样本	action: reject, reason: ...
AI 提取记忆 → 用户删除	❌ 噪声样本	action: delete_memory
AI 生成 title → 用户修改	📝 修正样本（最值钱）	action: edit, diff: ...
笔记 → 转待办	🔄 类型纠错样本	action: convert, from: note, to: task
实现关键：每一次 AI 调用都带一个 trace_id，反馈时通过这个 ID 反向关联回原始 prompt 和原始输出。

🔹 L5 进化层（让它越用越聪明）—— 重头戏
A. Prompt 自动优化器（每周/每月触发）
工作流：

1. 收集本周所有反馈日志
2. 筛选出"reject"和"edit"的 Bad Case（10-30 条）
3. 调用 DeepSeek（用强模型，比如 deepseek-reasoner）执行：
   ┌─────────────────────────────────────────┐
   │  这是当前 Prompt：[v1.0]                  │
   │  这是 20 条 Bad Case：[原文 + AI 输出 + 用户实际答案] │
   │  请分析失败模式，提出 Prompt 优化建议      │
   │  输出新版 Prompt 和优化理由               │
   └─────────────────────────────────────────┘
4. 用新 Prompt 在历史 Bad Case 上重跑（A/B 测试）
5. 通过率 > 旧版本 → 推送给用户「是否启用 v1.1？」
6. 用户确认 → 切换 active.md 软链
这就是 DSPy / TextGrad 的轻量实现，叫 Prompt Self-Improvement。

B. Few-shot 动态注入
每次调用 AI 时，从历史正样本中挑 3-5 条最相关的 Bad Case 修正版塞进 prompt：

javascript
复制
const dynamicFewShots = await selectTopK(input, positiveExamples, 3);
const prompt = `
${SYSTEM_PROMPT}

## 你过去做对的相似案例（参考）：
${dynamicFewShots.map(formatExample).join('\n')}

## 当前需要分析：
${input}
`;
C. 用户画像构建器（每月触发）
聚合一个月数据，让 AI 自动生成画像更新建议：

"本月你提到'强总'47 次，建议加入 frequent_persons"
"本月你完成的任务平均耗时 45 分钟，更新 work_patterns"
"你拒绝了 12 条带'FYI'的任务，建议加入 low_priority_signals"
四、Prompt 优化建议（针对你现在的两个）
🎯 任务识别 Prompt v2.0 改进点
当前问题	改进方案
Prompt 写死，所有人通用	注入用户画像：你正在为朱从坤(Dean)服务，他关注 BizDeck/AutoMind 项目，常合作的人有强总、康院...
没有动态 few-shot	每次调用前从反馈库选 Top 3 相似案例
拒绝原因信号是固定的	从 reject 日志统计高频拒绝原因，加入 prompt
没有置信度校准	要求模型输出 reasoning_steps（思考链）
优化后核心结构：

[SYSTEM: 角色定义 + 硬性规则]
[USER_PROFILE: 动态注入用户画像]
[CURRENT_PROJECTS: 当前活跃项目（让 AI 优先识别这些项目相关任务）]
[POSITIVE_EXAMPLES: 3 条历史 Bad Case 修正样本（动态选择）]
[NEGATIVE_EXAMPLES: 2 条历史 reject 案例（避免重复犯错）]
[INPUT: 用户复制的文本]
[OUTPUT_FORMAT: JSON 格式 + reasoning 字段]
🎯 记忆提取 Prompt v2.0 改进点
当前问题	改进方案
记忆类型判定缺乏依据	输入用户画像 + 实体图，让 AI 判断"康院"是已知客户 → 长期记忆而非短期
实体没有去重	预先注入"已知实体列表"，AI 直接复用 ID 而非新建
importance 主观	基于用户画像中的 priority_signals 做判定
五、推荐落地路径（三阶段）
阶段	周期	核心交付
Phase 1：闭环搭建	2-3 周	feedback_log + 用户画像静态版 + Prompt 版本管理
Phase 2：小助手能力	3-4 周	4 个 Agent + RAG 检索 + 统一入口
Phase 3：自我进化	4-6 周	Prompt 自动优化器 + 动态 Few-shot + 月度画像更新
六、关键技术建议
向量化方案：本地用 bge-small-zh-v1.5（仅 100MB，离线可跑），无需上传到云
数据持久化：从 localStorage 升级到 lowdb 或 better-sqlite3，以支持复杂查询
Prompt 模板化：用 Handlebars 或自己写一个轻量模板引擎，支持 {{user_profile}} {{few_shots}} 变量注入
A/B 测试基建：所有 Prompt 调用走 promptRouter，按版本号路由，方便回滚