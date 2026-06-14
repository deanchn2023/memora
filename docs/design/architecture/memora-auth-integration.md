# Memora 登录认证对接文档（Production 环境）

> 版本：v2.1 | 更新日期：2026-06-09

---

## 1. 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                     Memora Electron App                      │
│                                                              │
│  ┌────────────────┐    IPC     ┌──────────────────────────┐ │
│  │  渲染进程       │ ◄──────► │  主进程                    │ │
│  │  (app.js)      │           │  (main.js)               │ │
│  │                │           │                           │ │
│  │  electronAPI   │           │  authState {              │ │
│  │  .authLogin()  │           │    isLoggedIn, token,     │ │
│  │  .authLogout() │           │    user, env              │ │
│  │  .authGetState│           │  }                        │ │
│  └────────────────┘           └──────────┬───────────────┘ │
│                                          │                  │
└──────────────────────────────────────────┼──────────────────┘
                                           │ HTTP (fetch)
                                           ▼
                              ┌──────────────────────────┐
                              │  ADPToolkit Server       │
                              │  (21.91.29.59:3000)      │
                              │                          │
                              │  POST /api/auth/login    │
                              │  GET  /api/auth/me       │
                              └──────────────────────────┘
                                           │
                                           │ 配置 + 通知
                                           ▼
                              ┌──────────────────────────┐
                              │  Config Server           │
                              │  (121.5.164.126:3450)    │
                              │                          │
                              │  GET  /memora/config     │
                              │  GET  /memora/notifications │
                              │  POST /memora/sync/*     │
                              └──────────────────────────┘
```

---

## 2. 双环境配置

| 配置项 | Beta（测试） | Production（正式） |
|--------|-------------|-------------------|
| 认证服务器 | `http://121.5.164.126:3450` | `http://21.91.29.59:3000` |
| 配置服务器 | `http://121.5.164.126:3450` | `http://121.5.164.126:3450` |
| Toolkit 服务器 | `http://121.5.164.126:3010` | `http://21.91.29.59:3000` |
| 登录路径 | `POST /auth/login` | `POST /api/auth/login` |
| 登录字段 | `email` | `username` |
| 配置路径 | `GET /config` | `GET /memora/config` |
| Token 验证路径 | `GET /auth/validate` | `GET /api/auth/me` |

### 代码定义位置

`main.js` → `DEFAULT_AUTH_SERVERS`

```javascript
const DEFAULT_AUTH_SERVERS = {
  beta: {
    name: 'Beta 版本（测试）',
    authUrl: 'http://121.5.164.126:3450',
    configUrl: 'http://121.5.164.126:3450',
    toolkitUrl: 'http://121.5.164.126:3010',
    loginPath: '/auth/login',
    loginField: 'email',
    configPath: '/config',
    validatePath: '/auth/validate'
  },
  production: {
    name: '正式版本',
    authUrl: 'http://21.91.29.59:3000',
    configUrl: 'http://121.5.164.126:3450',
    toolkitUrl: 'http://21.91.29.59:3000',
    loginPath: '/api/auth/login',
    loginField: 'username',
    configPath: '/memora/config',
    validatePath: '/api/auth/me'
  }
};
```

### 自定义服务器地址

支持通过设置页面修改服务器地址，持久化到本地 SQLite（`settings` 表 `custom_server_urls` 键），运行时覆盖默认值。

```javascript
// 保存自定义地址
function saveCustomServerUrls(urls) {
  setSetting('custom_server_urls', JSON.stringify(urls));
}

// 启动时加载
function loadCustomServerUrls() {
  const custom = getSetting('custom_server_urls');
  // 覆盖 AUTH_SERVERS[env].authUrl / configUrl / toolkitUrl
}
```

---

## 3. 认证状态模型

### 主进程内存状态

```javascript
let authState = {
  isLoggedIn: false,       // 是否已登录
  token: null,             // JWT Token（内存中）
  user: null,              // { id, email, name, org_id, org_name, role }
  env: 'beta',             // 当前环境 'beta' | 'production'
  forceLocalConfig: false  // 已登录但强制使用本地配置
};
```

### 持久化字段（SQLite settings 表）

| Key | 类型 | 说明 |
|-----|------|------|
| `auth_token` | string | JWT Token（加密存储） |
| `auth_user` | JSON string | 用户信息 `{ id, email, name, org_id, org_name, role }` |
| `auth_env` | string | 环境选择 `beta` / `production` |
| `auth_force_local` | `'0'` / `'1'` | 是否强制使用本地配置 |
| `auth_remember_me` | `'0'` / `'1'` | 是否记住登录状态（默认 `1`） |

---

## 4. 登录流程

### 4.1 时序图

```
用户            渲染进程              主进程               ADPToolkit          Config Server
 │                │                    │                     │                    │
 │ 点击登录       │                    │                     │                    │
 │───────────────►│                    │                     │                    │
 │                │ auth:login(IPC)    │                     │                    │
 │                │───────────────────►│                     │                    │
 │                │                    │ POST /api/auth/login│                    │
 │                │                    │────────────────────►│                    │
 │                │                    │    { token, user }  │                    │
 │                │                    │◄────────────────────│                    │
 │                │                    │                     │                    │
 │                │                    │ 保存 authState      │                    │
 │                │                    │ 持久化 token/user   │                    │
 │                │                    │                     │                    │
 │                │                    │ GET /memora/config  │                    │
 │                │                    │────────────────────────────────────────►│
 │                │                    │    { api, adp, ... }│                    │
 │                │                    │◄────────────────────────────────────────│
 │                │                    │                     │                    │
 │                │                    │ 上报登录活动         │                    │
 │                │                    │────────────────────►│                    │
 │                │                    │                     │                    │
 │                │                    │ 拉取服务端通知       │                    │
 │                │                    │────────────────────────────────────────►│
 │                │                    │                     │                    │
 │                │ auth:changed事件   │                     │                    │
 │                │◄───────────────────│                     │                    │
 │                │ config:updated事件 │                     │                    │
 │                │◄───────────────────│                     │                    │
 │ 更新UI        │                    │                     │                    │
 │◄───────────────│                    │                     │                    │
```

### 4.2 登录 API 请求

**Production 环境请求格式：**

```http
POST http://21.91.29.59:3000/api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "admin123"
}
```

**Beta 环境请求格式：**

```http
POST http://121.5.164.126:3450/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

### 4.3 登录成功响应

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "email": "admin@company.com",
    "username": "admin",
    "name": "管理员",
    "org_id": 1,
    "org_name": "云智能ADP产品中心",
    "role": "admin"
  }
}
```

### 4.4 登录后自动操作链

登录成功后主进程自动执行：

1. **保存认证状态** → `authState` 内存 + SQLite 持久化
2. **拉取远程配置** → `fetchRemoteConfig()` → `GET /memora/config`
3. **通知渲染进程** → `auth:changed` + `config:updated` IPC 事件
4. **上报登录活动** → `POST /memora/activity/login`
5. **拉取服务端通知** → `GET /memora/notifications`
6. **启动配置轮询** → 每 5 分钟 `fetchRemoteConfig()`
7. **启动通知轮询** → 每 3 分钟 `fetchServerNotifications()`

---

## 5. 自动登录（Session 恢复）

应用启动时，主进程 `restoreAuthFromStorage()` 自动恢复登录态：

```
App 启动
  → loadSettings() 从 SQLite 读取 auth_token / auth_user / auth_env / auth_remember_me
  → 如果 rememberMe = false → 清除 token，不自动登录
  → 如果 token 存在：
    → GET /api/auth/me (Authorization: Bearer <token>)
    → 200 OK → 恢复 authState，拉取配置，通知渲染进程
    → 401 → token 过期，清除持久化数据
    → 网络错误 → 不清除 token（下次重试），本次用本地配置
```

### 代码位置

`main.js` → 自动登录逻辑（`getSetting('auth_token')` 区域）

```javascript
const token = getSetting('auth_token');
const userStr = getSetting('auth_user');
const savedEnv = getSetting('auth_env') || 'beta';
const rememberMe = getSetting('auth_remember_me') !== '0';

if (!rememberMe && token) {
  deleteSetting('auth_token');
  deleteSetting('auth_user');
  deleteSetting('auth_remember_me');
  return;  // 未勾选记住登录，不自动恢复
}

if (!token || !userStr) return;

// 验证 token 有效性
const res = await fetch(`${server.authUrl}${server.validatePath}`, {
  headers: { 'Authorization': `Bearer ${token}` }
});

if (res.ok) {
  authState.isLoggedIn = true;
  authState.token = token;
  authState.user = data.user || data;
  await fetchRemoteConfig();
  // 通知渲染进程
  mainWindow.webContents.send('config:updated', { ... });
} else if (res.status === 401) {
  // Token 过期，清除
  deleteSetting('auth_token');
  deleteSetting('auth_user');
}
```

---

## 6. 登出流程

```
用户点击登出
  → 渲染进程: window.electronAPI.authLogout()
  → IPC: auth:logout
  → 主进程: handleLogout()
    1. 上报登出活动 → POST /memora/activity/logout
    2. 停止通知轮询 → stopNotificationPolling()
    3. 停止配置轮询 → stopConfigPolling()
    4. 清空 authState → { isLoggedIn: false, token: null, user: null, ... }
    5. 清空 remoteConfig → null
    6. 清除持久化 → deleteSetting('auth_token'), deleteSetting('auth_user'), deleteSetting('auth_remember_me')
    7. 通知渲染进程 → auth:changed({ isLoggedIn: false })
```

---

## 7. IPC 通道清单

### 渲染进程 → 主进程

| IPC 通道 | 参数 | 返回值 | 说明 |
|---------|------|--------|------|
| `auth:login` | `{ email, password, env, rememberMe }` | `{ success, user?, error? }` | 登录 |
| `auth:logout` | 无 | `{ success }` | 登出 |
| `auth:get-state` | 无 | 见下方 | 获取当前认证状态 |
| `auth:get-server-urls` | 无 | `{ beta: {...}, production: {...} }` | 获取服务器地址配置 |
| `auth:set-server-urls` | `{ urls }` | `{ success }` | 修改服务器地址 |
| `auth:reset-server-urls` | `{ env }` | `{ success }` | 重置为默认地址 |

### 主进程 → 渲染进程（事件推送）

| IPC 事件 | 数据 | 说明 |
|---------|------|------|
| `auth:changed` | `{ isLoggedIn, user?, env? }` | 认证状态变更 |
| `config:updated` | `{ api, adp, forceLocalConfig, reason? }` | 远程配置更新 |

### `auth:get-state` 返回值

```javascript
{
  isLoggedIn: boolean,        // 是否已登录
  token: string | null,       // JWT Token
  user: object | null,        // 用户信息
  env: 'beta' | 'production', // 当前环境
  forceLocalConfig: boolean,  // 是否强制本地配置
  rememberMe: boolean,        // 是否记住登录
  serverName: string,         // 服务器名称
  authUrl: string,            // 认证服务器地址
  configUrl: string,          // 配置服务器地址
  toolkitUrl: string          // Toolkit 服务器地址
}
```

---

## 8. Preload 桥接 API

`preload.js` 暴露给渲染进程的认证 API：

```javascript
window.electronAPI = {
  // 认证
  authLogin: (email, password, env, rememberMe) =>
    ipcRenderer.invoke('auth:login', { email, password, env, rememberMe }),

  authLogout: () =>
    ipcRenderer.invoke('auth:logout'),

  authGetState: () =>
    ipcRenderer.invoke('auth:get-state'),

  authGetServerUrls: () =>
    ipcRenderer.invoke('auth:get-server-urls'),

  authSetServerUrls: (urls) =>
    ipcRenderer.invoke('auth:set-server-urls', { urls }),

  authResetServerUrls: (env) =>
    ipcRenderer.invoke('auth:reset-server-urls', { env }),

  // 事件监听
  onAuthChanged: (callback) => {
    ipcRenderer.on('auth:changed', (_, data) => callback(data));
  },

  onConfigUpdated: (callback) => {
    ipcRenderer.on('config:updated', (_, data) => callback(data));
  },
};
```

---

## 9. 渲染进程使用示例

### 9.1 登录

```javascript
// 登录（Production 环境）
const result = await window.electronAPI.authLogin('admin', 'admin123', 'production', true);

if (result.success) {
  console.log('登录成功:', result.user);
  // result.user = { id, email, name, org_id, org_name, role }
} else {
  console.error('登录失败:', result.error);
}
```

### 9.2 监听认证状态变更

```javascript
window.electronAPI.onAuthChanged((data) => {
  if (data.isLoggedIn) {
    console.log('用户已登录:', data.user);
    // 更新 UI：显示用户名、组织信息
  } else {
    console.log('用户已登出');
    // 更新 UI：显示登录表单
  }
});
```

### 9.3 获取当前认证状态

```javascript
const state = await window.electronAPI.authGetState();

if (state.isLoggedIn) {
  console.log('当前用户:', state.user.name);
  console.log('组织:', state.user.org_name);
  console.log('环境:', state.env);
  console.log('认证服务器:', state.authUrl);
}
```

### 9.4 登出

```javascript
const result = await window.electronAPI.authLogout();
if (result.success) {
  console.log('已退出登录');
}
```

---

## 10. 远程配置系统

登录后自动拉取组织配置，仅存内存不写磁盘，退出登录即清空。

### 请求

```http
GET http://121.5.164.126:3450/memora/config
Authorization: Bearer <token>
X-Auth-Server: http://21.91.29.59:3000
```

> `X-Auth-Server` Header 传递登录服务器地址，供 Config Server 同步配置使用。

### 响应结构

```javascript
{
  _meta: {
    updated_at: "2026-06-09T10:00:00Z",  // 配置最后更新时间
    org_id: 1,
    org_name: "云智能ADP产品中心"
  },
  api: {
    deepseek_key: "sk-xxx...",             // DeepSeek API Key
    deepseek_base_url: "https://api.deepseek.com",
    deepseek_model: "deepseek-v4-flash"
  },
  adp: {
    app_key: "xxx",                        // ADP 智能体 AppKey
    knowledge_app_key: "yyy",              // 知识库 AppKey
    search_app_key: "zzz"                  // 搜索 AppKey
  },
  features: {
    clipboard_monitor: true,
    ai_assistant: true,
    sync_enabled: true
  },
  prompts: { ... }                         // Prompt 模板（远程下发）
}
```

### 配置轮询

登录后每 **5 分钟** 自动拉取一次配置，检测 `updated_at` 变化时推送 `config:updated` 事件到渲染进程。

---

## 11. 通知系统

### API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/memora/notifications` | GET | 拉取通知列表 |
| `/memora/notifications/unread-count` | GET | 获取未读数 |
| `/memora/notifications/:id/read` | PUT | 标记已读 |
| `/memora/notifications/read-all` | PUT | 全部标记已读 |

### 请求头

```http
Authorization: Bearer <token>
```

### 轮询频率

登录后每 **3 分钟** 自动拉取一次未读数。

---

## 12. 同步系统对接

登录是同步功能的前置条件，Token 用于所有同步 API 的鉴权。

### 同步 API 鉴权

所有同步请求携带 JWT Token：

```http
POST http://121.5.164.126:3450/memora/sync/full
Authorization: Bearer <token>
Content-Type: application/json

{
  "device_id": "memora-mac-xxxxx",
  "device_name": "MacBook Pro (congkunzhu)",
  "device_type": "desktop",
  "since": "2026-06-09T00:00:00Z",
  "changes": { ... }
}
```

### 同步与登录的联动

1. 登录成功 → `SyncEngine.init()` 自动注册设备
2. 登录成功 → 自动启动定时同步（如已开启）
3. Token 过期（401） → 同步自动暂停，提示重新登录
4. 登出 → 停止所有同步操作

详见 [memora-sync-api.md](./memora-sync-api.md)

---

## 13. 安全设计

| 安全措施 | 实现 |
|---------|------|
| **Token 存储** | SQLite `settings` 表，主进程专用，渲染进程无法直接读取 |
| **IPC 隔离** | 渲染进程通过 `contextBridge` 白名单 API 访问，不暴露 `require`/`process` |
| **Token 传输** | 仅在主进程 HTTP 请求中使用，不通过 IPC 传给渲染进程 |
| **防回放** | JWT Token 含过期时间，服务端校验 |
| **记住登录** | 用户可选，不勾选则关闭应用即清除 Token |
| **配置仅内存** | 远程配置 `remoteConfig` 仅存内存，不写磁盘，登出即清空 |
| **HTTPS** | Production 环境建议升级为 HTTPS |

---

## 14. Production 环境部署清单

| 项目 | 地址 | 说明 |
|------|------|------|
| ADPToolkit（认证 + 资源） | `http://21.91.29.59:3000` | 提供登录认证、文档/案例/Demo |
| Config Server（配置 + 通知 + 同步） | `http://121.5.164.126:3450` | 组织配置、通知推送、数据同步 |
| 数据库 | Config Server 内置 SQLite | `memora-config.db` |
| 管理员账号 | username: `admin` / password: `admin123` | ADPToolkit 超级管理员 |

### 关键配置项

- ADPToolkit 的 `loginField` 为 `username`（非 email）
- ADPToolkit 的登录路径为 `/api/auth/login`（非 `/auth/login`）
- ADPToolkit 的验证路径为 `/api/auth/me`（非 `/auth/validate`）
- 配置路径为 `/memora/config`（非 `/config`）

---

## 15. 错误处理

| 场景 | 处理方式 |
|------|---------|
| 登录失败（密码错误） | 返回 `{ success: false, error: '错误信息' }` |
| Token 过期（401） | 清除持久化 Token，通知渲染进程登出 |
| 网络不可达 | 不清除 Token（下次重试），本次使用本地配置 |
| 配置拉取失败 | 降级到本地配置，不影响基础功能 |
| 设备被停用（403） | 返回 `{ ok: false, error: 'DEVICE_DEACTIVATED' }`，提示联系管理员 |
