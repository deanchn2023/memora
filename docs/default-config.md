# Memora 默认配置文档

> 自动生成于 2026-06-05，基于 main.js / store.js / calendar.js 等源码

---

## 1. API 配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `DEFAULT_API_KEY` | `sk-b4116cb788d64e3fb20e8e5bd1333168` | 内置 DeepSeek API Key |
| `DEFAULT_BASE_URL` | `https://api.deepseek.com` | API 基础地址 |
| `DEFAULT_MODEL` | `deepseek-v4-flash` | 默认模型 |
| `DEFAULT_DAILY_LIMIT_FOR_BUILTIN_KEY` | `10` | 内置 Key 每日调用限额 |
| `AI_DAILY_LIMIT` | `1000` | 自定义 Key 每日调用限额 |

### 远程配置优先级

登录后组织配置优先于本地设置，`getAPIConfig()` 返回逻辑：
1. 已登录 → 使用 `remoteConfig.api`（apiKey / baseUrl / model / dailyLimit）
2. 未登录 + 用户自定义 → 使用用户设置
3. 未登录 + 无自定义 → 使用上述默认值

---

## 2. ADP（智能体开发平台）配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `adp_app_key` | `''` (空) | 主 ADP AppKey |
| `adp_url` | `https://wss.lke.cloud.tencent.com/adp/v2/chat` | ADP V2 接口地址 |
| `adp_agent_name` | `我的AI助手` | 助手显示名称 |
| `adp_knowledge_app_key` | `''` (空) | 知识跟随专用 AppKey |
| `adp_search_app_key` | `''` (空) | 搜索问答专用 AppKey |
| 知识跟随默认 AppKey | `VnIvLv...oqZN...` (长 Base64) | 硬编码在 main.js:3907 |

---

## 3. 认证服务器配置

### Beta 环境

| 配置项 | 值 |
|--------|-----|
| 名称 | Beta 版本（测试） |
| 认证 URL | `http://121.5.164.126:3450` |
| 配置 URL | `http://121.5.164.126:3450` |
| 登录路径 | `/auth/login` |
| 登录字段 | `email` |
| 配置路径 | `/config` |
| 验证路径 | `/auth/validate` |

### Production 环境

| 配置项 | 值 |
|--------|-----|
| 名称 | 正式版本 |
| 认证 URL | `http://21.91.29.59:3000` |
| 配置 URL | `http://121.5.164.126:3450` |
| 登录路径 | `/api/auth/login` |
| 登录字段 | `username` |
| 配置路径 | `/memora/config` |
| 验证路径 | `/api/auth/me` |

### 认证状态默认值

| 字段 | 默认值 |
|------|--------|
| `authState.isLoggedIn` | `false` |
| `authState.token` | `null` |
| `authState.user` | `null` |
| `authState.env` | `'beta'` |
| `remoteConfig` | `null` |

---

## 4. 用户画像默认值

```json
{
  "user": {
    "name": "朱从坤",
    "english_name": "Dean",
    "role": "产品经理 & 全栈开发者",
    "industries": ["AI", "SaaS", "企业服务"]
  },
  "frequent_persons": [],
  "active_projects": [],
  "preferences": {
    "priority_signals": ["老板", "紧急", "ASAP", "立即", "今天", "务必"],
    "low_priority_signals": ["FYI", "有空", "可选", "参考", "随意"]
  },
  "work_patterns": {
    "peak_hours": ["09:00-12:00", "14:00-17:00"],
    "task_completion_rate": 0.7
  }
}
```

---

## 5. 番茄钟 & 提醒 & 剪贴板设置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `pomodoro.workDuration` | `25` 分钟 | 工作时长 |
| `pomodoro.shortBreakDuration` | `5` 分钟 | 短休息 |
| `pomodoro.longBreakDuration` | `15` 分钟 | 长休息 |
| `pomodoro.sessionsBeforeLongBreak` | `4` 次 | 长休息前完成数 |
| `reminder.enoughTimeBeforeDue` | `120` 分钟 | 充裕提醒时间 |
| `reminder.nearDeadlineTime` | `30` 分钟 | 临期提醒时间 |
| `reminder.soundEnabled` | `true` | 声音提醒 |
| `reminder.notificationEnabled` | `true` | 通知提醒 |
| `clipboard.watchEnabled` | `true` | 剪贴板监听 |
| `clipboard.watchInterval` | `2000` ms | 监听间隔（前端） |
| `clipboard.autoAnalyze` | `true` | 自动分析 |
| `calendar.syncEnabled` | `true` | 日历同步 |
| `calendar.calendarName` | `TaskFlow` | 日历名称 |

---

## 6. 智能过滤配置 (FILTER_CONFIG)

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `maxLength` | `1000` | 最大文本字数 |
| `confidenceThreshold` | `0.9` | 自动弹出置信度阈值 |
| `lowConfidenceThreshold` | `0.7` | 静默候选置信度阈值 |

### 黑名单模式（优先过滤）

URL、SQL、JSON、函数定义、常量定义、导入/导出语句、注释、代码块、长数字、十六进制、域名

### 白名单模式（更可能是任务）

- **行动动词**：提醒、记得、需要、应该、必须、完成、发送、回复、处理、联系、预约、安排、准备、整理、编写、修改、提交、审核、审批、跟进、汇报、开会、会议、收集、反馈、简化、评审、确认、讨论、沟通、梳理、优化、推动、落实、执行、部署、上线、推进、协调、汇总、统计、分析、调研
- **时间词**：周五之前、明天、今天、下周、月底、年底、之前、尽快、尽早
- **标签**：【工作流】【任务】【待办】
- **@提及**

---

## 7. 窗口配置

| 配置项 | 默认值 |
|--------|--------|
| 宽度 | `1200` |
| 高度 | `800` |
| 最小宽度 | `900` |
| 最小高度 | `600` |
| 背景色 | `#f5f5f7` |

---

## 8. 定时器 & 系统参数

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `MAX_CLIPBOARD_HASHES` | `500` | 剪贴板最大哈希缓存 |
| 剪贴板监听间隔（主进程） | `10000` ms (10秒) | 主进程轮询间隔 |
| 自动备份 | 每天凌晨3点 | 30分钟间隔检查 |
| 优化器检查间隔 | `3600000` ms (1小时) | |
| 优化器触发条件 | 每周日3点 或 上次运行超7天 | |
| `tracesCacheLimit` | `200` | 反馈日志追踪缓存上限 |
| `queryFeedback.limit` | `100` | 查询反馈上限 |
| `getRecentBadCases.limit` | `30` | 近期坏案例上限 |

---

## 9. 新任务默认字段

| 字段 | 默认值 |
|------|--------|
| `id` | `task_{timestamp}` |
| `title` | 用户输入 |
| `description` | `''` |
| `estimatedDuration` | `60` 分钟 |
| `actualDuration` | `0` |
| `priority` | `'medium'` |
| `status` | `'pending'` |
| `dueDate` | `null` |
| `reminderSettings.enoughTime` | `120` 分钟 |
| `reminderSettings.nearDeadline` | `30` 分钟 |
| `reminders` | `[]` |
| `pomodoroSessions` | `[]` |
| `calendarEventId` | `null` |
| `source` | `'manual'` |
| `rawText` | `''` |
| `completedAt` | `null` |

---

## 10. Store 存储键名

| 键名 | 值 |
|------|-----|
| `TASKS_KEY` | `taskflow_tasks` |
| `SETTINGS_KEY` | `taskflow_settings` |
| `POMODORO_KEY` | `taskflow_pomodoro` |
| `AI_CALLS_KEY` | `taskflow_ai_calls_count` |
| `AI_CALLS_DATE_KEY` | `taskflow_ai_calls_date` |
