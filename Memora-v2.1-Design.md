# Memora v2.1 设计文档：对接 ADPToolkit 认证 + 组织配置 + 通知 + 提示更新

> 日期：2026-06-04 | 版本：v2.1 | 基于 ADPToolkit (http://21.91.29.59:3000) 认证体系
> 更新：新增 organization 字段替代 industry；自动更新改为提示下载模式（无签名证书）

---

## 一、背景与目标

### 现状问题

Memora v2.0 自建了一套独立的认证系统（config-server），存在以下问题：
- 用户需要在 Memora 中单独注册账号，与公司内部系统（ADPToolkit）账号不互通
- ADPToolkit 的 `industry` 字段语义为行业，不适合直接作为组织标识
- 管理员需要维护两套用户体系

### 目标

1. **统一认证**：Memora 直接使用 ADPToolkit 的登录/注册，无需自建用户表
2. **组织字段**：ADPToolkit users 表新增 `organization` 字段作为 Memora 的组织标识，同组织用户共享配置
3. **配置管理**：管理员按组织管理 Memora 配置（API/ADP/Prompts/策略），仅管理员可见
4. **通知推送**：管理员可向指定用户/组织发送通知，Memora 登录后在设置页查看
5. **提示更新**：无代码签名证书，采用「提示下载」模式，客户端检测新版本后引导用户手动下载 DMG

---

## 二、架构设计

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────┐
│                    Memora Electron App                    │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ 设置页面  │  │ 通知面板  │  │ 提示更新  │  │ AI引擎  │ │
│  │ 登录/配置 │  │ 设置页内  │  │ 引导下载  │  │ 配置优先 │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘ │
│       │              │              │              │      │
│       └──────────────┴──────────────┴──────────────┘      │
│                          │ IPC                            │
│  ┌───────────────────────┴────────────────────────────┐  │
│  │              main.js (主进程)                        │  │
│  │  - authState / remoteConfig (内存)                  │  │
│  │  - 统一 API Client                                  │  │
│  └───────────────────────┬────────────────────────────┘  │
└──────────────────────────┼───────────────────────────────┘
                           │
           ┌───────────────┴───────────────┐
           │                               │
           ▼                               ▼
┌─────────────────────┐      ┌─────────────────────────┐
│   ADPToolkit 服务    │      │   Memora 扩展服务        │
│  21.91.29.59:3000   │      │  121.5.164.126:3450     │
│                     │      │                         │
│  /api/auth/login    │      │  /memora/config         │
│  /api/auth/register │      │  /memora/notifications  │
│  /api/auth/me       │      │  /memora/updates        │
│  /api/users         │      │  /memora/admin/*        │
│  (organization=组织) │      │  (配置+通知+更新管理)    │
└─────────────────────┘      └─────────────────────────┘
```

### 2.2 认证流程

```
用户在 Memora 设置页输入用户名+密码
         │
         ▼
main.js → POST http://21.91.29.59:3000/api/auth/login
         │  { username, password }
         │
         ▼
ADPToolkit 返回 { token, user: { id, username, name, role, organization, ... } }
         │
         ▼
main.js 保存 token 到内存 + localStorage
         │
         ├──→ 用 user.organization 请求 Memora 配置
         │    GET http://121.5.164.126:3450/memora/config?organization=腾讯云
         │    Header: Authorization: Bearer <adptoolkit_token>
         │
         └──→ 拉取通知
              GET http://121.5.164.126:3450/memora/notifications
              Header: Authorization: Bearer <adptoolkit_token>
```

### 2.3 Token 验证链路

Memora 扩展服务收到请求后，需要验证 ADPToolkit 的 Token：

```
Memora 扩展服务收到 Bearer Token
         │
         ▼
调用 ADPToolkit 验证接口
GET http://21.91.29.59:3000/api/auth/me
Header: Authorization: Bearer <token>
         │
         ▼
ADPToolkit 返回 user 信息 → Memora 服务信任该用户身份
```

> **优化**：Memora 服务可缓存验证结果（TTL 5分钟），避免每次请求都回调 ADPToolkit。

---

## 三、ADPToolkit 改动

### 3.1 必须改动：users 表新增 organization 字段

ADPToolkit 需要在 users 表新增 `organization` 字段，用于 Memora 的组织标识：

```sql
ALTER TABLE users ADD COLUMN organization TEXT DEFAULT '';
```

**注册接口改动**（`POST /api/auth/register`）：

Request Body 新增字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| organization | string | 否 | 所属组织/公司名 |

**用户信息返回改动**：

登录/获取用户信息接口返回的 `user` 对象新增 `organization` 字段：

```json
{
  "id": "u-abc123def4",
  "username": "zhangsan",
  "name": "张三",
  "email": "zhangsan@example.com",
  "role": "architect",
  "region": "",
  "industry": "互联网",
  "organization": "腾讯云",
  "avatar": null
}
```

**更新用户接口**（`PUT /api/users/:id`）：支持更新 `organization` 字段。

### 3.2 字段映射关系

| ADPToolkit 字段 | Memora 用途 | 说明 |
|---------|------------|------|
| `username` / `password` | 登录凭据 | 不变 |
| `role` | 判断管理员 | super_admin / regional_admin 可管理配置 |
| `industry` | 行业标签 | 保留，仅作分类展示 |
| **`organization`** | **组织标识** | **新增**，同 organization 共享 Memora 配置 |
| `id` | 用户唯一标识 | 不变 |
| `name` | 显示名称 | 不变 |

> **为什么不直接用 `industry`？** `industry` 语义是「行业」（如互联网、金融），粒度太粗；`organization` 语义是「组织/公司」（如腾讯云、招商银行），更精确地划分配置边界。同一行业的不同公司可能需要不同的 API Key、ADP AppKey 等配置。

---

## 四、Memora 扩展服务 API 设计

> 服务地址：`http://121.5.164.126:3450`
> 所有受保护接口需携带 ADPToolkit 的 JWT Token

### 4.1 配置管理

#### 获取当前用户配置

```
GET /memora/config
Authorization: Bearer <adptoolkit_token>
```

**逻辑**：
1. 验证 Token → 获取 user.organization
2. 查询 `org_configs` 表，返回该组织的 Memora 配置
3. 如果该组织无配置，返回默认配置

**响应**：
```json
{
  "api": { "api_key": "sk-xxx", "base_url": "...", "model": "...", "daily_limit": 500 },
  "adp": { "app_key": "...", "knowledge_app_key": "...", "search_app_key": "...", "url": "...", "agent_name": "..." },
  "prompts": { "ai_prompt": "...", "memory_prompt": "...", "clipboard_prompt": "..." },
  "policies": { "lock_config": false, "allow_local_override": true },
  "_meta": { "organization": "腾讯云", "updated_at": "2026-06-04T12:00:00" }
}
```

#### 管理员：获取所有组织配置

```
GET /memora/admin/configs
Authorization: Bearer <adptoolkit_token>
```

**权限**：仅 super_admin / regional_admin

#### 管理员：更新组织配置

```
PUT /memora/admin/configs/:organization
Authorization: Bearer <adptoolkit_token>
Body: { "api": { ... }, "adp": { ... }, ... }
```

**权限**：仅 super_admin / regional_admin

### 4.2 通知系统

#### 获取当前用户通知

```
GET /memora/notifications
Authorization: Bearer <adptoolkit_token>
```

**逻辑**：
1. 验证 Token → 获取 user.id 和 user.organization
2. 查询通知表，匹配条件：`target_user_id = user.id` OR `target_organization = user.organization` OR `target_all = true`
3. 返回未读 + 已读通知，按时间倒序

**响应**：
```json
{
  "notifications": [
    {
      "id": "n-xxx",
      "title": "系统维护通知",
      "content": "6月5日凌晨2点将进行系统维护...",
      "type": "system",
      "priority": "high",
      "read": false,
      "created_at": "2026-06-04T10:00:00",
      "target_organization": "腾讯云",
      "target_user_id": null,
      "target_all": false
    }
  ],
  "unread_count": 3
}
```

#### 标记通知已读

```
PUT /memora/notifications/:id/read
Authorization: Bearer <adptoolkit_token>
```

#### 管理员：创建通知

```
POST /memora/admin/notifications
Authorization: Bearer <adptoolkit_token>
Body: {
  "title": "通知标题",
  "content": "通知内容（支持 Markdown）",
  "type": "system | update | feature | warning",
  "priority": "normal | high | urgent",
  "target_all": false,
  "target_organization": "腾讯云",     // 可选，发给某组织
  "target_user_id": "u-xxx"          // 可选，发给某人
}
```

**权限**：仅 super_admin / regional_admin

#### 管理员：获取所有通知

```
GET /memora/admin/notifications
Authorization: Bearer <adptoolkit_token>
```

#### 管理员：删除通知

```
DELETE /memora/admin/notifications/:id
Authorization: Bearer <adptoolkit_token>
```

### 4.3 提示更新（无签名证书模式）

> **设计决策**：由于没有 Apple Developer 代码签名证书，macOS 无法使用 electron-updater 自动安装更新。
> 采用「提示下载」模式：客户端检测到新版本后，在设置页显示更新提示，引导用户通过浏览器下载 DMG 手动安装。

#### 检查更新

```
GET /memora/updates/check?platform=darwin&arch=arm64&version=2.1.0
```

**无需鉴权**（更新检查应公开）

**响应**：
```json
{
  "has_update": true,
  "latest_version": "2.2.0",
  "release_notes": "## v2.2.0\n- 新增通知系统\n- 优化 AI 响应速度",
  "download_url": "http://121.5.164.126:3450/memora/updates/download/Memora-2.2.0-arm64.dmg",
  "file_size": 89456640,
  "sha256": "abc123...",
  "released_at": "2026-06-10T08:00:00",
  "install_guide": "下载完成后双击 DMG 文件，将 Memora 拖入应用程序文件夹即可"
}
```

#### 下载更新文件

```
GET /memora/updates/download/:filename
```

**无需鉴权**（DMG 文件公开下载，浏览器直接下载）

#### 管理员：上传新版本

```
POST /memora/admin/updates/upload
Authorization: Bearer <adptoolkit_token>
Content-Type: multipart/form-data
Body: {
  "version": "2.2.0",
  "platform": "darwin",
  "arch": "arm64",
  "release_notes": "## v2.2.0\n- 新增通知系统",
  "file": <dmg文件>
}
```

**权限**：仅 super_admin

> **macOS 安全提示**：用户首次打开未签名应用时，需右键 → 「打开」→ 确认。后续可考虑获取 Apple Developer 证书后升级为自动更新模式。

---

## 五、数据库设计（Memora 扩展服务）

### 5.1 org_configs 表

```sql
CREATE TABLE IF NOT EXISTS org_configs (
  organization TEXT PRIMARY KEY,         -- 组织名（来自 ADPToolkit users.organization）
  config TEXT NOT NULL DEFAULT '{}',     -- JSON 配置
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT DEFAULT ''             -- 操作人 user_id
);
```

### 5.2 notifications 表

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  type TEXT DEFAULT 'system',            -- system / update / feature / warning
  priority TEXT DEFAULT 'normal',        -- normal / high / urgent
  target_all INTEGER DEFAULT 0,          -- 是否全员
  target_organization TEXT DEFAULT '',    -- 目标组织（空=不限）
  target_user_id TEXT DEFAULT '',         -- 目标用户（空=不限）
  created_by TEXT NOT NULL,              -- 创建人 user_id
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 5.3 notification_reads 表

```sql
CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notification_id, user_id)
);
```

### 5.4 app_versions 表

```sql
CREATE TABLE IF NOT EXISTS app_versions (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'darwin',
  arch TEXT NOT NULL DEFAULT 'arm64',
  release_notes TEXT DEFAULT '',
  file_path TEXT NOT NULL,             -- DMG 文件在服务器上的路径
  file_size INTEGER DEFAULT 0,
  sha256 TEXT DEFAULT '',
  created_by TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 六、Electron 客户端改动

### 6.1 main.js 改动

#### 登录流程替换

```javascript
// 旧：CONFIG_SERVER_URL + /auth/login（email + password）
// 新：ADPToolkit_URL + /api/auth/login（username + password）

const ADPTOOLKIT_URL = 'http://21.91.29.59:3000';
const MEMORA_SERVICE_URL = 'http://121.5.164.126:3450';

// 登录 IPC
ipcMain.handle('auth:login', async (event, { username, password }) => {
  // 1. 调用 ADPToolkit 登录
  const res = await fetch(`${ADPTOOLKIT_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!res.ok) return { success: false, error: data.error || '登录失败' };

  // 2. 保存认证状态
  authState = { isLoggedIn: true, token: data.token, user: data.user };

  // 3. 拉取 Memora 配置（用 ADPToolkit token）
  await fetchRemoteConfig();

  // 4. 拉取通知
  await fetchNotifications();

  return { success: true, user: data.user };
});

  // 4. 拉取通知
  await fetchNotifications();

  return { success: true, user: data.user };
});
```

#### 配置拉取改动

```javascript
async function fetchRemoteConfig() {
  if (!authState.isLoggedIn) return;
  const organization = authState.user?.organization;
  if (!organization) {
    console.log('[Auth] User has no organization, using default config');
    return;
  }
  const res = await fetch(`${MEMORA_SERVICE_URL}/memora/config`, {
    headers: { 'Authorization': `Bearer ${authState.token}` }
  });
  if (res.ok) {
    remoteConfig = await res.json();
  }
}
```

#### 通知轮询

```javascript
let notificationPollTimer = null;

async function fetchNotifications() {
  if (!authState.isLoggedIn) return;
  const res = await fetch(`${MEMORA_SERVICE_URL}/memora/notifications`, {
    headers: { 'Authorization': `Bearer ${authState.token}` }
  });
  if (res.ok) {
    const data = await res.json();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('notifications:update', data);
    }
  }
}

// 登录后启动轮询（5分钟一次）
function startNotificationPoll() {
  stopNotificationPoll();
  fetchNotifications();
  notificationPollTimer = setInterval(fetchNotifications, 5 * 60 * 1000);
}

function stopNotificationPoll() {
  if (notificationPollTimer) {
    clearInterval(notificationPollTimer);
    notificationPollTimer = null;
  }
}
```

#### 提示更新（提示下载模式）

```javascript
// 不使用 electron-updater（无签名证书，无法自动安装）
// 采用提示下载模式：检测新版本 → 通知用户 → 打开浏览器下载

async function checkForUpdates() {
  try {
    const platform = process.platform; // darwin
    const arch = process.arch; // arm64 / x64
    const currentVersion = app.getVersion();

    const res = await fetch(
      `${MEMORA_SERVICE_URL}/memora/updates/check?platform=${platform}&arch=${arch}&version=${currentVersion}`
    );
    const data = await res.json();

    if (data.has_update) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update:available', data);
      }
    }
  } catch (err) {
    console.error('[Update] Check failed:', err.message);
  }
}

// IPC：用户点击下载，用默认浏览器打开下载链接
ipcMain.handle('update:download', (event, downloadUrl) => {
  shell.openExternal(downloadUrl);
});

// 启动时检查一次，之后每 4 小时检查一次
app.on('ready', () => {
  checkForUpdates();
  setInterval(checkForUpdates, 4 * 60 * 60 * 1000);
});
```

### 6.2 渲染进程改动

#### 设置页面 - 登录表单

| 字段 | 旧 | 新 |
|------|-----|-----|
| 账号输入 | `email` | 根据环境切换：Beta 用 `email`，正式用 `username` |
| 占位符 | `admin@memora.com` | Beta: `输入邮箱` / 正式: `输入用户名` |
| 密码字段 | 不变 | 不变 |
| 环境选择 | 无 | **新增**：下拉框选择 Beta / 正式环境 |

#### 头部登录按钮

- 设置按钮右侧新增登录按钮（👤），未登录时显示
- 点击打开设置 Modal 并自动切到「组织配置」Tab
- 已登录时显示用户名徽章，点击同样打开设置

#### 设置页面 - 组织配置

- 隐藏管理员专属配置按钮（非 super_admin / regional_admin）
- 显示当前组织和配置状态
- 登录后显示组织名：`已登录：张三（腾讯云）`

#### 设置页面 - 通知面板

新增通知 Tab 或在组织配置 Tab 下方显示：

```html
<div class="notification-panel">
  <div class="notification-header">
    <h3>通知</h3>
    <span class="badge">3 条未读</span>
  </div>
  <div class="notification-list">
    <!-- 通知卡片 -->
    <div class="notification-card unread">
      <div class="notification-card-header">
        <span class="notification-type system">系统</span>
        <span class="notification-time">10分钟前</span>
      </div>
      <h4>系统维护通知</h4>
      <p>6月5日凌晨2点将进行系统维护...</p>
    </div>
  </div>
</div>
```

#### 提示更新 UI

- 收到 `update:available` 事件后，在设置页显示更新提示卡片
- 卡片内容：新版本号、更新日志摘要、文件大小
- 用户可选择「前往下载」（打开浏览器）或「稍后提醒」
- 不做应用内下载和自动安装（无签名证书）

### 6.3 preload.js 新增 IPC

```javascript
// 通知
notifyFetch: () => ipcRenderer.invoke('notifications:fetch'),
onNotificationsUpdate: (cb) => ipcRenderer.on('notifications:update', (_, data) => cb(data)),

// 通知已读
notifyMarkRead: (id) => ipcRenderer.invoke('notifications:mark-read', id),

// 提示更新
onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (_, data) => cb(data)),
updateDownload: (url) => ipcRenderer.invoke('update:download', url),
```

---

## 七、管理后台改动

### 7.1 Memora 管理后台（121.5.164.126:3450/admin）

现有管理后台需适配 ADPToolkit 认证：

| 模块 | 改动 |
|------|------|
| 登录 | 调用 ADPToolkit `/api/auth/login`（username 替代 email） |
| 仪表盘 | 增加「通知数」「版本」统计 |
| 组织管理 | 改为「组织配置」，组织列表从 ADPToolkit `/api/users` 聚合 organization 获取 |
| 用户管理 | 移除（由 ADPToolkit 管理） |
| 配置编辑 | 不变，按组织编辑 |
| 通知管理 | **新增**：创建/查看/删除通知，支持发给全员/指定组织/指定用户 |
| 版本管理 | **新增**：上传 DMG，填写版本号和更新日志 |

### 7.2 ADPToolkit 管理界面（可选）

如需在 ADPToolkit 管理界面中集成 Memora 功能，可新增：

- Memora 配置 Tab：在用户管理页新增组织配置入口
- 通知发送：在管理界面发送 Memora 通知

> 这是可选增强，v2.1 不做要求。

---

## 八、安全设计

### 8.1 Token 传递与验证

```
Memora 客户端 ──Bearer Token──→ Memora 扩展服务 ──Bearer Token──→ ADPToolkit
                                    │
                                    │ 验证链路
                                    ├── 方案A：每次回调 ADPToolkit /api/auth/me
                                    └── 方案B：共享 JWT_SECRET 本地验证（推荐）
```

**推荐方案B**：与 ADPToolkit 共享 JWT_SECRET，Memora 扩展服务可直接验证 Token 而无需回调，减少延迟和依赖。

### 8.2 配置安全

- 配置管理功能仅限管理员（super_admin / regional_admin）可见和操作
- 普通用户仅能获取本组织的配置结果，不能查看/编辑配置详情
- 服务器配置仅存内存，不写磁盘（v2.0 已实现）
- 退出登录清空 remoteConfig
- API Key 等敏感字段在传输时脱敏显示

### 8.3 通知安全

- 管理员可删除通知，普通用户只能标记已读
- 通知内容支持 Markdown，但渲染时做 XSS 过滤

---

## 九、提示更新方案（无签名证书）

### 方案说明

由于没有 Apple Developer 代码签名证书，无法使用 electron-updater 实现自动安装。采用「提示下载」模式：

```
客户端启动 → 检查版本 → 发现新版本 → 设置页显示提示 → 用户点击 → 浏览器下载 DMG → 手动安装
```

### 交互流程

```
┌─────────────────────────────────────────────────┐
│  设置页 - 更新提示卡片                             │
│                                                 │
│  🎉 发现新版本 v2.2.0                            │
│                                                 │
│  更新内容：                                       │
│  • 新增通知系统                                   │
│  • 优化 AI 响应速度                               │
│                                                 │
│  文件大小：85.3 MB                                │
│                                                 │
│  ┌──────────────┐  ┌──────────────┐             │
│  │  前往下载     │  │  稍后提醒     │             │
│  └──────────────┘  └──────────────┘             │
│                                                 │
│  💡 下载后双击 DMG → 拖入应用文件夹               │
└─────────────────────────────────────────────────┘
```

### 关键限制

| 限制 | 说明 |
|------|------|
| **无自动安装** | macOS 未签名应用无法静默安装，必须用户手动操作 |
| **首次打开拦截** | macOS Gatekeeper 会拦截未签名应用，需右键→「打开」→确认 |
| **无法增量更新** | 每次下载完整 DMG，无差分更新 |

### 后续升级路径

获取 Apple Developer 证书后可升级为自动更新模式：
1. 购买 Apple Developer Program（$99/年）
2. 生成 Developer ID Application 证书
3. 签名应用 + Apple 公证（notarization）
4. 切换到 electron-updater 自动更新

---

## 十、开发计划

### Phase 1：认证对接（2天）

- [ ] ADPToolkit users 表新增 `organization` 字段
- [ ] ADPToolkit 注册/更新接口支持 `organization`
- [ ] 修改 main.js 登录逻辑，对接 ADPToolkit API
- [ ] 修改 Memora 扩展服务，使用 ADPToolkit Token 验证
- [ ] 修改设置页登录表单（username 替代 email）
- [ ] 删除 Memora 自建用户表逻辑

### Phase 2：配置管理（1天）

- [ ] 新建 `org_configs` 表
- [ ] 实现配置 CRUD API（按 organization）
- [ ] 更新管理后台（组织配置 Tab）
- [ ] 迁移现有配置数据

### Phase 3：通知系统（2天）

- [ ] 新建 `notifications` + `notification_reads` 表
- [ ] 实现通知 API（获取/已读/管理员创建删除）
- [ ] Electron 客户端通知面板 UI（设置页内）
- [ ] 通知轮询机制（5 分钟一次）
- [ ] 管理后台通知管理 Tab

### Phase 4：提示更新（1天）

- [ ] 新建 `app_versions` 表
- [ ] 实现更新检查/下载 API
- [ ] 管理后台版本上传功能（DMG 文件上传）
- [ ] Electron 客户端：启动检查 + 设置页更新提示卡片
- [ ] 点击「前往下载」打开浏览器下载

---

## 十一、接口汇总

### Memora 扩展服务 API（121.5.164.126:3450）

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/memora/config` | Bearer Token | 获取当前用户组织配置 |
| GET | `/memora/notifications` | Bearer Token | 获取当前用户通知 |
| PUT | `/memora/notifications/:id/read` | Bearer Token | 标记通知已读 |
| GET | `/memora/updates/check` | 无 | 检查更新 |
| GET | `/memora/updates/download/:filename` | 无 | 下载更新文件 |
| GET | `/memora/admin/configs` | Admin | 获取所有组织配置 |
| PUT | `/memora/admin/configs/:organization` | Admin | 更新组织配置 |
| POST | `/memora/admin/notifications` | Admin | 创建通知 |
| GET | `/memora/admin/notifications` | Admin | 获取所有通知 |
| DELETE | `/memora/admin/notifications/:id` | Admin | 删除通知 |
| POST | `/memora/admin/updates/upload` | Admin | 上传新版本 |

### 依赖 ADPToolkit API（21.91.29.59:3000）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 用户登录 |
| GET | `/api/auth/me` | 获取当前用户信息 |
| GET | `/api/users` | 获取用户列表（管理员） |

---

## 十二、数据迁移

从 v2.0 自建认证迁移到 v2.1 ADPToolkit 认证：

1. **ADPToolkit 改动**：users 表新增 `organization` 字段，为现有用户设置 organization 值
2. **配置迁移**：将 `org_configs` 表数据按 `org_id → org_name` 映射到新 `org_configs` 表的 `organization` 字段
3. **用户关联**：不再需要，ADPToolkit 统一管理
4. **Token 清理**：客户端升级后首次启动清除旧 token，提示重新登录
5. **服务器部署**：更新 config-server 代码，保留 `data/` 目录（数据库文件）
