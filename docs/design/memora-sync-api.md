# Memora 多端数据同步 API 文档 v3

> 版本: 3.0 | 更新: 2026-06-09
> 架构师：ADPToolkit Team
> 服务端: ADPToolkit Config Server | 端口: 3450

---

## 1. 系统架构

### 1.1 三系统定位

```
┌──────────────────┐            ┌─────────────────────┐            ┌──────────────────┐
│   Memora (PC)    │◄──────────►│   ADPToolkit (云端)   │◄──────────►│ MemoraMobile     │
│   Electron       │  双向同步   │   Config Server       │  双向同步   │ Flutter          │
│                  │            │   数据中转枢纽         │            │                  │
│  【主操作端】     │            │  ● 用户鉴权(JWT)      │            │ 【查看+轻操作端】 │
│  ● 全量读写      │            │  ● 数据存储+转发       │            │ ● 任务/笔记读写  │
│  ● 数据采集      │            │  ● revision 乐观锁    │            │ ● 知识只读       │
│  ● 知识沉淀      │            │  ● 权限矩阵控制       │            │ ● 剪贴板只读     │
│  ● AI分析        │            │  ● 操作审计日志       │            │ ● 以阅读为主     │
│  ● 剪贴板采集    │            │  ● 幂等性保障         │            │                  │
└──────────────────┘            └──────────┬──────────┘            └──────────────────┘
                                           │
                                           │ 双向同步
                                           ▼
                                ┌──────────────────┐
                                │ 微信小程序        │
                                │ 【超轻量端】      │
                                │ ● 任务读写       │
                                │ ● 笔记只读       │
                                │ ● 知识只读       │
                                │ ● 无剪贴板       │
                                │ ● OpenID 认证    │
                                └──────────────────┘
```

### 1.2 权限矩阵

| 数据类型 | PC(electron) | 移动端(flutter) | 小程序(miniprogram) | Web |
|----------|:---:|:---:|:---:|:---:|
| **tasks** | 读写✓ 创建✓ | 读写✓ 创建✓ | 读写✓ 创建✓ | 只读 |
| **notes** | 读写✓ 创建✓ | 读写✓ 创建✓ | 只读 | 只读 |
| **knowledge_nodes** | 读写✓ 创建✓ | **只读** | **只读** | 只读 |
| **knowledge_edges** | 读写✓ 创建✓ | **只读** | **只读** | 只读 |
| **clipboard_memories** | 读写✓ 创建✓ | **只读** | ❌不可见 | 只读 |
| **profile** | 读写 | 读写 | 只读 | 只读 |

**设计原则：**
- PC 是数据采集和知识沉淀的核心，全量读写
- 移动端是随身伴侣，可创建待办和记事，但知识图谱和剪贴板只能查看（这些数据由 PC 端产生）
- 小程序更轻量，只能创建任务和查看基础信息
- Web 端纯查看

---

## 2. 核心同步机制

### 2.1 Revision 乐观锁（不依赖时钟）

传统方案用 `updated_at` 时间戳对比检测冲突，但设备时钟可能偏差。v3 采用 **revision 版本号**：

```
每条记录有一个整数 revision 字段，初始为 1
每次更新 revision + 1
客户端 push 时携带 base_revision（它上次看到的版本号）
服务端比较：如果 server.revision > base_revision → 冲突
```

**示例：**

```
1. PC 创建 task_001，revision=1
2. PC push task_001(base_revision=1) → 服务端 revision=1，匹配 → 更新成功，revision=2
3. 手机 pull → 拿到 task_001(revision=2)，存入本地
4. 手机修改 task_001，push(base_revision=2) → 服务端 revision=2，匹配 → 更新成功，revision=3
5. PC 也修改了 task_001（但它的本地版本是 revision=2），push(base_revision=2) → 服务端 revision=3 > 2 → 冲突！
6. 返回冲突，PC 选择保留哪个版本
```

### 2.2 防回声机制

每条记录标记 `origin_device_id`，pull 时自动排除：

```sql
SELECT * FROM user_tasks
WHERE user_id = ? AND updated_at > ?
  AND (origin_device_id != ? OR origin_device_id IS NULL OR origin_device_id = '')
ORDER BY revision ASC LIMIT 500
```

### 2.3 幂等性保障

每次请求携带 `request_id`（UUID），服务端 24 小时内去重：
- 相同 `request_id` 的重复请求直接返回缓存结果
- 网络重试不会产生副作用

### 2.4 设备注册

首次同步前必须注册设备，获取 capabilities：
- 停用设备后无法同步（返回 403）
- 可查看所有活跃设备、踢出设备
- 服务端追踪每台设备的最后活跃时间

### 2.5 操作审计日志

每次数据变更记录到 `sync_operations` 表：
- 谁（device_id）、什么时间、对哪条记录、做了什么操作
- 支持审计、冲突根因分析、数据回滚

---

## 3. 同步流程

### 3.1 完整生命周期

```
Step 1: 注册设备
  POST /memora/sync/device/register
  → 返回平台权限 + 服务端信息

Step 2: 首次同步（全量上传 + 全量拉取）
  POST /memora/sync/full
  { since: "1970-01-01T00:00:00.000Z", changes: { 全部本地数据 } }
  → 上传所有数据 + 拉取其他设备的数据

Step 3: 增量同步（定时或触发）
  POST /memora/sync/full
  { since: "上次同步时间", changes: { 本地变更 } }
  → 只传输增量

Step 4: 处理冲突（如有）
  POST /memora/sync/resolve
  { resolutions: [...] }
  → 选择保留版本
```

### 3.2 多端并发场景

```
时间轴：
  T1: PC 修改 task_A (本地 revision=2)
  T2: 手机修改 task_A (本地 revision=2)
  T3: PC push task_A(base_revision=2) → 成功，服务端 revision=3
  T4: 手机 push task_A(base_revision=2) → 冲突！服务端 revision=3 > base_revision=2
  T5: 手机收到冲突，展示给用户选择
  T6: 用户选择"手机版本" → POST resolve(strategy=client_wins)
  T7: 服务端用手机版本覆盖，revision=4
  T8: PC 下次 pull → 拿到 task_A(revision=4)，更新本地
```

---

## 4. API 端点

### 4.1 设备管理

#### POST /memora/sync/device/register

注册设备（首次同步前必须调用）。

**请求：**
```json
{
  "device_id": "pc_macbook_zhangsan",
  "platform": "electron",
  "device_name": "张三的 MacBook Pro",
  "app_version": "2.1.0"
}
```

**响应：**
```json
{
  "registered": true,
  "platform": "electron",
  "capabilities": {
    "tasks": { "read": true, "write": true, "own": true },
    "notes": { "read": true, "write": true, "own": true },
    "knowledge_nodes": { "read": true, "write": true, "own": true },
    "knowledge_edges": { "read": true, "write": true, "own": true },
    "clipboard_memories": { "read": true, "write": true, "own": true },
    "profile": { "read": true, "write": true }
  },
  "active_devices": 2,
  "server_time": "2026-06-09T10:00:00.000Z"
}
```

#### GET /memora/sync/device/list

获取用户所有已注册设备。

**响应：**
```json
{
  "devices": [
    {
      "device_id": "pc_macbook_zhangsan",
      "platform": "electron",
      "device_name": "张三的 MacBook Pro",
      "app_version": "2.1.0",
      "last_active_at": "2026-06-09T10:00:00.000Z",
      "registered_at": "2026-05-01T08:00:00.000Z",
      "status": "active"
    },
    {
      "device_id": "mobile_iphone_zhangsan",
      "platform": "flutter",
      "device_name": "张三的 iPhone 16",
      "last_active_at": "2026-06-09T09:30:00.000Z",
      "status": "active"
    }
  ]
}
```

#### POST /memora/sync/device/deactivate

停用设备（踢出）。

**请求：** `{ "device_id": "pc_macbook_zhangsan" }`

---

### 4.2 数据同步

#### POST /memora/sync/push

推送本地变更到云端。

**请求：**
```json
{
  "device_id": "pc_macbook_zhangsan",
  "platform": "electron",
  "request_id": "req_uuid_xxx",
  "changes": {
    "tasks": [
      {
        "id": "task_001",
        "base_revision": 3,
        "title": "更新后的标题",
        "status": "in_progress",
        "priority": "high"
      }
    ],
    "notes": [
      {
        "id": "note_001",
        "base_revision": 0,
        "title": "新笔记",
        "content": "内容..."
      }
    ]
  },
  "profile": { "base_revision": 2, "name": "张三", "role": "PM" }
}
```

**关键字段：**
- `base_revision`：客户端上次看到的 revision，0 表示新记录
- `request_id`：幂等性标识（推荐每次请求生成 UUID）

**响应：**
```json
{
  "pushed": { "tasks": 1, "notes": 1, "profile": 1 },
  "conflicts": [
    {
      "type": "tasks",
      "id": "task_002",
      "reason": "revision_mismatch",
      "server_revision": 5,
      "client_base_revision": 3,
      "server_version": { "id": "task_002", "title": "服务端标题", "revision": 5, ... },
      "client_version": { "id": "task_002", "title": "客户端标题", "revision": 3, ... }
    }
  ],
  "permission_denied": [],
  "server_time": "2026-06-09T10:05:00.000Z"
}
```

---

#### POST /memora/sync/pull

拉取服务端变更（自动防回声）。

**请求：**
```json
{
  "device_id": "mobile_iphone_zhangsan",
  "platform": "flutter",
  "since": "2026-06-08T12:00:00.000Z",
  "data_types": ["tasks", "notes", "knowledge_nodes"]
}
```

**响应：**
```json
{
  "pulled": {
    "tasks": [
      {
        "id": "task_001",
        "revision": 4,
        "origin_device_id": "pc_macbook_zhangsan",
        "title": "PC端采集的任务",
        ...
      }
    ],
    "knowledge_nodes": [
      {
        "id": "knode_001",
        "revision": 2,
        "name": "React Hooks",
        "origin_device_id": "pc_macbook_zhangsan",
        ...
      }
    ]
  },
  "profile": { "_revision": 3, "name": "张三", ... },
  "has_more": false,
  "server_time": "2026-06-09T10:05:00.000Z"
}
```

> 注：移动端拉取时，`clipboard_memories` 虽然服务端有数据，但根据权限矩阵会被过滤掉（小程序端完全不可见）。

---

#### POST /memora/sync/full ⭐推荐

全量双向同步（push + pull 一步完成）。

**请求：**
```json
{
  "device_id": "mobile_iphone_zhangsan",
  "platform": "flutter",
  "request_id": "req_uuid_yyy",
  "since": "2026-06-08T12:00:00.000Z",
  "changes": {
    "tasks": [{ "id": "task_new", "base_revision": 0, "title": "手机创建的任务" }],
    "notes": [{ "id": "note_new", "base_revision": 0, "title": "快速记事" }]
  },
  "profile": null
}
```

**响应：**
```json
{
  "pushed": { "tasks": 1, "notes": 1 },
  "pulled": {
    "tasks": [...],
    "notes": [...],
    "knowledge_nodes": [...]
  },
  "conflicts": [],
  "permission_denied": [],
  "profile": { ... },
  "has_more": false,
  "server_time": "2026-06-09T10:05:00.000Z"
}
```

---

#### POST /memora/sync/resolve

解决同步冲突。

**请求：**
```json
{
  "device_id": "pc_macbook_zhangsan",
  "platform": "electron",
  "request_id": "req_resolve_zzz",
  "resolutions": [
    {
      "type": "tasks",
      "id": "task_002",
      "strategy": "client_wins",
      "base_revision": 5,
      "data": { "title": "PC修改的标题", "status": "in_progress", ... }
    }
  ]
}
```

**策略说明：**

| 策略 | 行为 | 适用场景 |
|------|------|---------|
| `client_wins` | 用客户端 data 覆盖服务端，revision+1 | 确定客户端版本更准确 |
| `server_wins` | 保留服务端版本，客户端下次 pull 更新 | 服务端版本更准确 |
| `merge` | 用客户端提供的合并数据覆盖，revision+1 | 手动合并了两端修改 |

> ⚠️ 安全机制：如果冲突解决期间又有新写入（revision 已超过 base_revision），解决操作会失败，需要重新冲突检测。

---

#### GET /memora/sync/status

获取同步状态，含各数据类型统计、设备列表。

**响应：**
```json
{
  "counts": {
    "tasks": { "active": 45, "deleted": 3, "max_revision": 127 },
    "notes": { "active": 12, "deleted": 1, "max_revision": 38 }
  },
  "device_breakdown": {
    "tasks": [
      { "origin_device_id": "pc_macbook_zhangsan", "count": 30 },
      { "origin_device_id": "mobile_iphone_zhangsan", "count": 15 }
    ]
  },
  "profile": { "revision": 3, "updated_at": "2026-06-09T08:00:00.000Z" },
  "devices": [
    { "device_id": "pc_macbook_zhangsan", "platform": "electron", "device_name": "...", "last_active_at": "...", "status": "active" },
    { "device_id": "mobile_iphone_zhangsan", "platform": "flutter", "device_name": "...", "last_active_at": "...", "status": "active" }
  ],
  "recent_syncs": [...],
  "server_time": "2026-06-09T10:05:00.000Z"
}
```

---

#### DELETE /memora/sync/data

清除云端数据（软删除时 revision+1，确保其他设备感知）。

#### GET /memora/sync/capabilities?platform=flutter

查询平台权限矩阵。

---

## 5. 数据模型

### 5.1 通用字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | TEXT PK | 客户端生成唯一 ID |
| `user_id` | TEXT NOT NULL | 用户 ID |
| `revision` | INTEGER NOT NULL | **乐观锁版本号**，初始 1，每次更新 +1 |
| `origin_device_id` | TEXT | 来源设备标识 |
| `created_at` | TEXT | 创建时间 |
| `updated_at` | TEXT | 更新时间 |
| `deleted_at` | TEXT | 软删除时间 |

### 5.2 推送时必带字段

| 场景 | 必带字段 |
|------|---------|
| 新建记录 | `id`, `base_revision=0`, 业务字段 |
| 更新记录 | `id`, `base_revision=上次看到的revision`, 需更新的字段 |
| 删除记录 | `id`, `base_revision`, `deleted_at=当前时间` |

### 5.3 各数据类型字段

与 v2 相同，参见原文档。核心新增：所有表都有 `revision` 字段。

---

## 6. 错误码

| HTTP | code 字段 | 说明 |
|------|-----------|------|
| 400 | — | 参数缺失（device_id、resolutions 等） |
| 401 | — | Token 无效或过期 |
| 403 | `DEVICE_DEACTIVATED` | 设备已停用，需重新注册 |
| 404 | — | 记录不存在 |
| 500 | — | 服务端内部错误 |

**冲突类型：**

| reason | 说明 |
|--------|------|
| `revision_mismatch` | 服务端 revision > 客户端 base_revision，有其他设备修改 |
| `revision_changed_during_conflict` | 冲突解决期间又有新写入 |

**权限拒绝：**

| 类型 | 说明 |
|------|------|
| `permission_denied` | 平台无权写入/创建该数据类型 |

---

## 7. 小程序端对接指南

### 7.1 认证差异

| 维度 | PC/移动端 | 小程序 |
|------|-----------|--------|
| 认证方式 | ADPToolkit JWT Token | 微信 OpenID → 换 JWT |
| Token 获取 | `POST /api/auth/login` | `POST /api/auth/wechat-login` |
| 存储 | localStorage / Keychain | wx.setStorageSync |
| 有效期 | 7天 | 2小时(需refresh) |

### 7.2 小程序端限制

- **无本地 SQLite**：使用 wx.setStorageSync 存储（上限 10MB）
- **无后台运行**：只能 onShow 时同步
- **网络限制**：必须配置合法域名
- **数据量限制**：单次 sync 请求 body 不超 1MB

### 7.3 小程序推荐流程

```javascript
// 1. 登录获取 token
wx.login() → code → 服务端换 openid → JWT token

// 2. 注册设备
POST /memora/sync/device/register
{ device_id: "wx_${openid}", platform: "miniprogram" }

// 3. 每次打开小程序时同步
onShow() {
  POST /memora/sync/full
  { device_id, platform: "miniprogram", since: lastSyncTime, changes: { 本地新建任务 } }
}

// 4. 创建任务（唯一的写操作）
本地创建 → 标记待同步 → 下次 sync/full 时推送
```

---

## 8. 同步时机建议

| 场景 | PC (electron) | 移动端 (flutter) | 小程序 |
|------|---------------|------------------|--------|
| 启动/打开 | pull 最新 | pull 最新 | pull 最新 |
| 定时 | 每 5 分钟 | 每 10 分钟 | — |
| 操作后 | 创建/修改后立即 push | 创建后立即 push | — |
| 切回前台 | — | 从后台返回时 pull | onShow 时 pull |
| 关闭前 | 全量同步 | — | — |

---

## 9. device_id 命名规范

| 平台 | 格式 | 示例 |
|------|------|------|
| PC (electron) | `pc_{hostname}_{userId}` | `pc_macbook-zhangsan_user_001` |
| Mobile (flutter) | `mobile_{platform}_{uniqueId}` | `mobile_ios_abc123` |
| 小程序 | `wx_{openid_hash}` | `wx_o6bma3k8x2n1` |
| Web | `web_{browserHash}` | `web_chrome_x7f2a` |

规则：2-64 字符，只含 `[a-zA-Z0-9_-]`，全局唯一且稳定不变。

---

## 10. 数据库 SQL（服务端完整版）

```sql
-- 设备注册
CREATE TABLE registered_devices (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  device_name TEXT DEFAULT '',
  app_version TEXT DEFAULT '',
  capabilities TEXT DEFAULT '{}',
  last_active_at TEXT DEFAULT (datetime('now')),
  registered_at TEXT DEFAULT (datetime('now')),
  deactivated_at TEXT,
  status TEXT DEFAULT 'active'
);

-- 设备同步游标
CREATE TABLE device_sync_cursors (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  data_type TEXT NOT NULL,
  last_sync_revision INTEGER DEFAULT 0,
  last_sync_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, device_id, data_type)
);

-- 用户任务（带 revision）
CREATE TABLE user_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  priority TEXT DEFAULT 'medium',
  due_date TEXT,
  source TEXT DEFAULT 'manual',
  raw_text TEXT DEFAULT '',
  estimated_duration INTEGER DEFAULT 60,
  actual_duration INTEGER DEFAULT 0,
  pomodoro_sessions TEXT DEFAULT '[]',
  reminders TEXT DEFAULT '[]',
  calendar_event_id TEXT,
  completed_at TEXT,
  extra TEXT DEFAULT '{}',
  origin_device_id TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  deleted_at TEXT
);

-- 用户笔记、知识节点、知识边、剪贴板记忆 结构类似，均含 revision + origin_device_id
-- （见 database.js 完整定义）

-- 操作审计日志
CREATE TABLE sync_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  data_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  operation TEXT NOT NULL DEFAULT 'update',  -- insert / update / delete / resolve
  base_revision INTEGER DEFAULT 0,
  new_revision INTEGER DEFAULT 1,
  request_id TEXT DEFAULT '',
  delta TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

-- 请求去重（幂等性）
CREATE TABLE idempotent_requests (
  request_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  response_data TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- 同步会话日志
CREATE TABLE sync_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  platform TEXT DEFAULT '',
  request_id TEXT DEFAULT '',
  last_sync_at TEXT DEFAULT (datetime('now')),
  pushed_count INTEGER DEFAULT 0,
  pulled_count INTEGER DEFAULT 0,
  conflict_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

---

## 11. v2 → v3 迁移指南

| 变更 | 客户端需要做的 |
|------|---------------|
| 新增 `revision` 字段 | 本地数据加 `revision` 列，初始值 1；pull 时记录每条数据的 revision |
| push 需带 `base_revision` | 发送 `base_revision = 本地存储的该记录 revision` |
| 首次需注册设备 | 启动时调用 `/sync/device/register` |
| 请求带 `request_id` | 每次请求生成 UUID，网络重试时复用同一 request_id |
| 冲突检测改为 revision | 不再依赖 `updated_at` 时间戳对比 |
| 新增 `permission_denied` 响应字段 | 处理权限拒绝（如移动端写知识图谱会被拒绝） |
| 新增设备管理 | 实现"我的设备"页面，支持踢出设备 |
