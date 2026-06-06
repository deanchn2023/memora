# Memora 通知 API

Memora 客户端对接通知系统的完整接口文档。

**基础地址**：`http://<host>:3450/memora`

**鉴权方式**：除 `check` 接口外，所有接口需在请求头携带 JWT Token：
```
Authorization: Bearer <token>
```

Token 通过 ADPToolkit 登录接口获取（`POST /api/auth/login`），Memora 服务会回调 ADPToolkit 验证 Token 有效性。

---

## 1. 获取通知列表

获取当前用户可见的通知，自动按用户所属组织和 ID 匹配。

```
GET /memora/notifications
```

**鉴权**：必须登录

**匹配规则**（满足任一即可收到通知）：
- `target_all = 1`（全员通知）
- `target_organization = 用户所属组织`（组织通知）
- `target_user_id = 用户ID`（定向通知）

**响应**：

```json
{
  "notifications": [
    {
      "id": "n-a1b2c3d4e5f6",
      "title": "系统维护通知",
      "content": "计划于 6月10日凌晨2:00-4:00进行系统维护",
      "type": "system",
      "priority": "high",
      "read": false,
      "created_at": "2026-06-05T10:30:00.000Z",
      "target_organization": "",
      "target_user_id": "",
      "target_all": true,
      "created_by": "u-admin-001"
    }
  ],
  "unread_count": 3
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 通知唯一 ID |
| title | string | 通知标题 |
| content | string | 通知正文（支持换行符 `\n`） |
| type | string | 通知类型：`system` 系统通知、`update` 更新通知、`feature` 功能通知、`warning` 警告通知 |
| priority | string | 优先级：`normal` 普通、`high` 重要、`urgent` 紧急 |
| read | boolean | 当前用户是否已读 |
| created_at | string | 创建时间（ISO 8601） |
| target_all | boolean | 是否全员通知 |
| target_organization | string | 目标组织（空字符串表示不限） |
| target_user_id | string | 目标用户ID（空字符串表示不限） |
| created_by | string | 创建者用户ID |

**客户端对接建议**：
- 启动时调用一次，展示未读数量角标
- 定时轮询（建议间隔 5 分钟）检查新通知
- `unread_count > 0` 时在 UI 展示红点/角标
- 按 `priority` 排序展示，`urgent` 置顶并可弹窗提醒

---

## 2. 标记通知已读

将指定通知标记为当前用户已读。

```
PUT /memora/notifications/:id/read
```

**鉴权**：必须登录

**路径参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| id | string | 通知 ID |

**响应**：

```json
{
  "success": true
}
```

**错误码**：

| 状态码 | 说明 |
|--------|------|
| 404 | 通知不存在 |
| 401 | 未登录 |

**客户端对接建议**：
- 用户点击/打开通知详情时自动调用
- 批量标记可循环调用此接口
- 调用成功后更新本地 `unread_count`

---

## 3. 管理员接口

以下接口需要管理员权限（`super_admin` 或 `regional_admin`）。

### 3.1 创建通知

```
POST /memora/admin/notifications
```

**请求体**：

```json
{
  "title": "版本更新 v2.2.0",
  "content": "新增 AI 对话功能，优化性能表现",
  "type": "update",
  "priority": "normal",
  "target_all": true,
  "target_organization": "",
  "target_user_id": ""
}
```

**字段说明**：

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| title | ✅ | string | 通知标题 |
| content | ❌ | string | 通知正文 |
| type | ❌ | string | `system` / `update` / `feature` / `warning`，默认 `system` |
| priority | ❌ | string | `normal` / `high` / `urgent`，默认 `normal` |
| target_all | ❌ | boolean | 是否全员，默认 false |
| target_organization | ❌ | string | 目标组织名 |
| target_user_id | ❌ | string | 目标用户ID |

**响应**：

```json
{
  "success": true,
  "id": "n-a1b2c3d4e5f6"
}
```

### 3.2 获取通知列表（管理）

```
GET /memora/admin/notifications?type=system&page=1&page_size=50
```

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| type | string | 按类型筛选 |
| page | number | 页码，默认 1 |
| page_size | number | 每页条数，默认 50 |

**响应**：通知数组

```json
[
  {
    "id": "n-a1b2c3d4e5f6",
    "title": "系统维护通知",
    "content": "...",
    "type": "system",
    "priority": "high",
    "target_all": 1,
    "target_organization": "",
    "target_user_id": "",
    "created_by": "u-admin-001",
    "created_at": "2026-06-05T10:30:00.000Z"
  }
]
```

### 3.3 删除通知

```
DELETE /memora/admin/notifications/:id
```

**响应**：

```json
{
  "success": true
}
```

---

## 客户端对接示例（JavaScript）

```javascript
const MEMORA_API = 'http://21.91.29.59:3450/memora';

class MemoraNotification {
  constructor() {
    this.token = localStorage.getItem('adp_token');
  }

  async fetchHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.token}`
    };
  }

  /** 获取通知列表 */
  async getNotifications() {
    const res = await fetch(`${MEMORA_API}/notifications`, {
      headers: await this.fetchHeaders()
    });
    if (!res.ok) throw new Error(`获取通知失败: ${res.status}`);
    return res.json();
  }

  /** 标记已读 */
  async markAsRead(notificationId) {
    const res = await fetch(`${MEMORA_API}/notifications/${notificationId}/read`, {
      method: 'PUT',
      headers: await this.fetchHeaders()
    });
    if (!res.ok) throw new Error(`标记已读失败: ${res.status}`);
    return res.json();
  }

  /** 启动轮询 */
  startPolling(intervalMs = 5 * 60 * 1000) {
    this.pollTimer = setInterval(() => this.getNotifications(), intervalMs);
    // 立即拉取一次
    return this.getNotifications();
  }

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }
}
```

## 数据库表结构（参考）

```sql
-- 通知表
CREATE TABLE memora_notifications (
  id TEXT PRIMARY KEY,           -- 通知ID (n-xxxxxxxxxxxx)
  title TEXT NOT NULL,           -- 标题
  content TEXT NOT NULL,         -- 正文
  type TEXT,                     -- system | update | feature | warning
  priority TEXT,                 -- normal | high | urgent
  target_all INTEGER,            -- 1=全员通知
  target_organization TEXT,      -- 目标组织
  target_user_id TEXT,           -- 目标用户
  created_by TEXT NOT NULL,      -- 创建者
  created_at TEXT                -- 创建时间
);

-- 已读记录表
CREATE TABLE notification_reads (
  notification_id TEXT NOT NULL, -- 通知ID
  user_id TEXT NOT NULL,         -- 用户ID
  read_at TEXT,                  -- 已读时间
  PRIMARY KEY (notification_id, user_id)
);
```
