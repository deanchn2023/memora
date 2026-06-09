# Memora Production 环境登录与配置同步对接文档

> 描述 Memora 客户端对接 Production 环境时的登录认证、配置同步、通知拉取的完整流程

---

## 一、架构概览

```
┌──────────────────────┐         ┌────────────────────────┐         ┌───────────────────────┐
│  Memora 客户端        │         │  Config Server         │         │  ADPToolkit           │
│  (Electron 主进程)    │         │  121.5.164.126:3450    │         │  21.91.29.59:3000     │
│                      │         │                        │         │                       │
│  - 登录 → ADPToolkit │────────►│  - 组织配置下发         │         │  - 用户认证(JWT)       │
│  - 配置 → Config Srv │────────►│  - 通知推送             │◄────────│  - 用户管理           │
│  - 通知 → Config Srv │────────►│  - 登录活动记录         │         │  - 商机/文档等         │
└──────────────────────┘         └────────────────────────┘         └───────────────────────┘
```

**核心要点**：Production 环境下，认证走 ADPToolkit（用户名+密码），配置走 Config Server（按组织匹配）。两个服务分属不同服务器。

---

## 二、环境配置

### 2.1 双环境定义

| 属性 | Beta（测试） | Production（正式） |
|------|-------------|-------------------|
| 认证服务 | `http://121.5.164.126:3450` | `http://21.91.29.59:3000` |
| 配置服务 | `http://121.5.164.126:3450` | `http://121.5.164.126:3450` |
| 资源服务 | `http://121.5.164.126:3010` | `http://21.91.29.59:3000` |
| 登录字段 | `email` | `username` |
| 登录路径 | `POST /auth/login` | `POST /api/auth/login` |
| 配置路径 | `GET /config` | `GET /memora/config` |
| 验证路径 | `GET /auth/validate` | `GET /api/auth/me` |

### 2.2 代码中的环境配置

```javascript
// main.js - AUTH_SERVERS 定义
const DEFAULT_AUTH_SERVERS = {
  beta: {
    name: 'Beta 版本（测试）',
    authUrl: 'http://121.5.164.126:3450',
    configUrl: 'http://121.5.164.126:3450',
    toolkitUrl: 'http://121.5.164.126:3010',
    loginPath: '/auth/login',
    loginField: 'email',          // email 登录
    configPath: '/config',
    validatePath: '/auth/validate'
  },
  production: {
    name: '正式版本',
    authUrl: 'http://21.91.29.59:3000',
    configUrl: 'http://121.5.164.126:3450',   // 配置仍走 config-server
    toolkitUrl: 'http://21.91.29.59:3000',
    loginPath: '/api/auth/login',
    loginField: 'username',        // username 登录
    configPath: '/memora/config',
    validatePath: '/api/auth/me'
  }
};
```

### 2.3 自定义服务器地址

客户端支持在设置页面修改服务器地址，存储在本地 `auth_settings` 中（key: `custom_server_urls`）：

```javascript
// 保存格式
{
  "production": {
    "authUrl": "http://your-server:3000",
    "configUrl": "http://your-config-server:3450",
    "toolkitUrl": "http://your-server:3000"
  }
}
```

修改时会验证服务器可达性（8 秒超时），验证通过后才保存。

---

## 三、登录对接流程

### 3.1 完整登录时序

```
用户输入用户名/密码 → 选择环境(production) → 点击登录
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ 1. ipcRenderer.invoke('auth:login', { email, password, env })   │
│    ↓                                                             │
│ 2. main.js: auth:login handler                                   │
│    - 设置 authState.env = 'production'                           │
│    - 构建请求: POST http://21.91.29.59:3000/api/auth/login      │
│    - Body: { username, password }  (production 用 username)      │
│    ↓                                                             │
│ 3. ADPToolkit 返回 JWT Token + 用户信息                          │
│    - token: "eyJhbGciOiJIUzI1NiIs..."                           │
│    - user: { id, username, name, email, role, organization }     │
│    ↓                                                             │
│ 4. 保存到本地存储                                                 │
│    - auth_token, auth_user, auth_env, auth_remember_me           │
│    ↓                                                             │
│ 5. fetchRemoteConfig() → 拉取组织配置                            │
│    ↓                                                             │
│ 6. reportLoginActivity() → 上报登录活动                          │
│    ↓                                                             │
│ 7. fetchServerNotifications() → 拉取通知                         │
│    ↓                                                             │
│ 8. startConfigPolling() → 启动 5 分钟配置轮询                    │
│    ↓                                                             │
│ 9. IPC 通知渲染进程:                                             │
│    - auth:changed → { isLoggedIn, user, env }                   │
│    - config:updated → { api, adp, forceLocalConfig }            │
│    - notifications:updated → { notifications, unreadCount }     │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Production 登录接口

```
POST http://21.91.29.59:3000/api/auth/login
Content-Type: application/json

{
  "username": "zhangsan",
  "password": "your_password"
}
```

**成功响应 (200)**：
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "u-abc123def4",
    "username": "zhangsan",
    "name": "张三",
    "email": "zhangsan@example.com",
    "role": "architect",
    "organization": "云智能 ADP 产品中心",
    "avatar": null
  }
}
```

> **与 Beta 环境的差异**：Beta 用 `email` 字段登录，Production 用 `username` 字段登录。代码通过 `server.loginField` 自动切换。

### 3.3 自动登录（记住登录）

应用启动时执行 `autoLogin()`：

```javascript
async function autoLogin() {
  const token = getSetting('auth_token');
  const userStr = getSetting('auth_user');
  const savedEnv = getSetting('auth_env') || 'beta';
  const rememberMe = getSetting('auth_remember_me') !== '0';

  // 未勾选记住登录 → 清除 token，不自动登录
  if (!rememberMe && token) {
    deleteSetting('auth_token');
    deleteSetting('auth_user');
    return;
  }

  if (token && userStr) {
    authState.env = savedEnv;
    const server = getAuthServer();
    // 验证 token 有效性
    const res = await fetch(`${server.authUrl}${server.validatePath}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      authState.isLoggedIn = true;
      authState.token = token;
      authState.user = JSON.parse(userStr);
      // 拉取配置 → 上报活动 → 拉取通知
      await fetchRemoteConfig();
      await reportLoginActivity(!!remoteConfig);
      await fetchServerNotifications();
      // 通知渲染进程
      mainWindow.webContents.send('auth:changed', {...});
      mainWindow.webContents.send('config:updated', {...});
    } else {
      // Token 过期，清空
      await handleLogout();
    }
  }
}
```

### 3.4 退出登录

```javascript
async function handleLogout(clearToken = true) {
  // 1. 上报登出活动
  await reportLogoutActivity();
  // 2. 停止轮询
  stopNotificationPolling();
  stopConfigPolling();
  // 3. 清空状态
  authState = { isLoggedIn: false, token: null, user: null, env, forceLocalConfig: false };
  remoteConfig = null;  // 仅内存，退出即清空
  // 4. 清空持久化存储
  if (clearToken) {
    deleteSetting('auth_token');
    deleteSetting('auth_user');
  }
  // 5. 通知渲染进程
  mainWindow.webContents.send('auth:changed', { isLoggedIn: false });
}
```

---

## 四、配置同步对接

### 4.1 配置拉取流程

登录成功后，主进程自动调用 `fetchRemoteConfig()`：

```
GET http://121.5.164.126:3450/memora/config
Authorization: Bearer <token>
X-Auth-Server: http://21.91.29.59:3000    ← 告知配置服务认证服务器地址

→ 返回该用户所属组织的配置
```

**Production 特殊处理**：
- 认证服务器（ADPToolkit）和配置服务器（Config Server）不在同一台机器
- 请求中增加 `X-Auth-Server` Header，让 Config Server 知道去哪里验证 Token
- Config Server 收到请求后，回调 ADPToolkit 的 `/api/auth/me` 验证 JWT

### 4.2 配置响应结构

```json
{
  "api": {
    "api_key": "sk-b4116cb788d64e3fb20e8e5bd1333168",
    "base_url": "https://api.deepseek.com",
    "model": "deepseek-v4-flash",
    "daily_limit": 500,
    "highvol_api_key": "sk-xxx",
    "highvol_base_url": "https://api.deepseek.com",
    "highvol_model": "deepseek-v4-pro"
  },
  "adp": {
    "app_key": "EvcCHxUUzJxtLABs...",
    "url": "https://wss.lke.cloud.tencent.com/adp/v2/chat",
    "agent_name": "我的AI助手",
    "knowledge_app_key": "",
    "search_app_key": "",
    "clustering_app_key": "",
    "graph_app_key": "",
    "activation_app_key": "",
    "evolution_app_key": "",
    "conflict_app_key": ""
  },
  "prompts": {
    "ai_prompt": "",
    "memory_prompt": "",
    "clipboard_prompt": ""
  },
  "policies": {
    "lock_config": false,
    "allow_local_override": true
  },
  "_meta": {
    "organization": "云智能 ADP 产品中心",
    "updated_at": "2026-06-06T09:30:00.000Z",
    "updated_by": "system"
  }
}
```

### 4.3 配置优先级

```
已登录 && 远程配置存在 && !forceLocalConfig
  → 使用远程配置（组织级）

否则
  → 使用本地配置（用户自设 API Key 等）
```

具体逻辑：

| 场景 | API 配置 | ADP 配置 |
|------|---------|---------|
| 未登录 | 本地 `api_key` / `api_base_url` / `api_model` | 本地 `adp_app_key` / `adp_url` |
| 已登录 + 远程配置 + 云端优先 | `remoteConfig.api` | `remoteConfig.adp` |
| 已登录 + forceLocalConfig=true | 本地配置 | 本地配置 |
| 已登录 + 远程无配置 | 本地配置 | 本地配置 |

### 4.4 配置定期同步

登录后自动启动 5 分钟轮询：

```javascript
function startConfigPolling(intervalMs = 5 * 60 * 1000) {
  configPollTimer = setInterval(async () => {
    if (!authState.isLoggedIn || authState.forceLocalConfig) return;
    const oldUpdatedAt = _lastConfigUpdatedAt;
    await fetchRemoteConfig();
    // 检测配置是否更新
    if (remoteConfig?._meta?.updated_at !== oldUpdatedAt) {
      // 通知渲染进程配置已更新
      mainWindow.webContents.send('config:updated', {
        api: remoteConfig?.api || null,
        adp: remoteConfig?.adp || null,
        forceLocalConfig: authState.forceLocalConfig,
        reason: 'cloud_updated'
      });
    }
  }, intervalMs);
}
```

### 4.5 手动同步

渲染进程可通过 IPC 手动触发配置同步：

```javascript
// preload.js
configSync: () => ipcRenderer.invoke('config:sync')
```

### 4.6 配置源切换

用户可在设置中切换「云端配置」/「本地配置」：

```javascript
// 切换到本地配置
ipcMain.handle('config:set-source', async (event, { forceLocal }) => {
  authState.forceLocalConfig = !!forceLocal;
  setSetting('auth_force_local', forceLocal ? '1' : '0');
  // 通知渲染进程
  mainWindow.webContents.send('config:updated', {
    api: remoteConfig?.api || null,
    adp: remoteConfig?.adp || null,
    forceLocalConfig: authState.forceLocalConfig
  });
});
```

---

## 五、通知对接

### 5.1 拉取通知

登录成功后自动拉取，之后定期轮询：

```
GET http://121.5.164.126:3450/memora/notifications
Authorization: Bearer <token>
```

响应：
```json
{
  "notifications": [...],
  "unread_count": 3
}
```

### 5.2 通知匹配规则

1. `target_all = 1` → 全员通知
2. `target_organization` 匹配用户 organization → 组织通知
3. `target_user_id` 匹配用户 id → 个人通知
4. 三种取并集

### 5.3 相关 IPC

| IPC 通道 | 说明 |
|----------|------|
| `notifications:fetch` | 拉取通知列表 |
| `notifications:unread-count` | 获取未读数 |
| `notifications:mark-read` | 标记已读 |
| `notifications:mark-all-read` | 全部标记已读 |

---

## 六、登录活动记录

登录/登出时自动上报到 Config Server：

```
POST http://121.5.164.126:3450/memora/activity/login
Authorization: Bearer <token>
Content-Type: application/json

{
  "login_source": "memora_client",
  "config_loaded": true,
  "app_version": "2.1.0",
  "platform": "darwin"
}
```

---

## 七、IPC 通道总览

### 认证相关

| 通道 | 方向 | 参数 | 说明 |
|------|------|------|------|
| `auth:login` | renderer → main | `{ email, password, env, rememberMe }` | 登录 |
| `auth:logout` | renderer → main | — | 退出登录 |
| `auth:get-state` | renderer → main | — | 获取认证状态 |
| `auth:get-server-urls` | renderer → main | — | 获取服务器地址配置 |
| `auth:set-server-urls` | renderer → main | `{ urls }` | 自定义服务器地址 |
| `auth:reset-server-urls` | renderer → main | `{ env }` | 重置服务器地址 |
| `auth:changed` | main → renderer | `{ isLoggedIn, user, env }` | 认证状态变更通知 |

### 配置相关

| 通道 | 方向 | 参数 | 说明 |
|------|------|------|------|
| `config:sync` | renderer → main | — | 手动同步配置 |
| `config:set-source` | renderer → main | `{ forceLocal }` | 切换配置源 |
| `config:get-source` | renderer → main | — | 获取配置源信息 |
| `config:updated` | main → renderer | `{ api, adp, forceLocalConfig, reason }` | 配置更新通知 |

### 通知相关

| 通道 | 方向 | 参数 | 说明 |
|------|------|------|------|
| `notifications:fetch` | renderer → main | — | 拉取通知 |
| `notifications:unread-count` | renderer → main | — | 未读数 |
| `notifications:mark-read` | renderer → main | `notificationId` | 标记已读 |
| `notifications:mark-all-read` | renderer → main | — | 全部已读 |
| `notifications:updated` | main → renderer | `{ notifications, unreadCount }` | 通知更新推送 |

---

## 八、Production vs Beta 关键差异

| 差异点 | Beta | Production |
|--------|------|-----------|
| **认证服务器** | Config Server (121.5.164.126:3450) | ADPToolkit (21.91.29.59:3000) |
| **配置服务器** | Config Server (121.5.164.126:3450) | Config Server (121.5.164.126:3450) |
| **登录字段** | `email` | `username` |
| **登录路径** | `/auth/login` | `/api/auth/login` |
| **配置路径** | `/config` | `/memora/config` |
| **Token 验证** | Config Server 自验证 | Config Server 回调 ADPToolkit 验证 |
| **X-Auth-Server** | 不需要（同一服务） | **必须**（跨服务验证） |
| **用户体系** | Config Server 自建 | ADPToolkit 统一管理 |

---

## 九、安全要点

1. **Token 存储**：使用 Electron `electron-store` 持久化，仅在勾选「记住登录」时保存
2. **配置不写磁盘**：`remoteConfig` 仅存内存，退出登录即清空，不泄漏 API Key 到本地文件
3. **X-Auth-Server**：Production 模式下必须传递，Config Server 据此回调 ADPToolkit 验证 Token
4. **AppKey 传递**：ADP AppKey 从远程配置注入，不硬编码；调用 ADP 时 AppKey 放 Body 不放 Header
5. **forceLocalConfig**：用户可强制使用本地配置（断网/隐私场景），此时不拉取远程配置
6. **服务器地址验证**：自定义地址保存前验证可达性（8 秒超时），防止配置错误

---

## 十、故障排查

| 问题 | 可能原因 | 解决方案 |
|------|---------|---------|
| 登录失败 401 | 用户名/密码错误 | 检查 ADPToolkit 用户表 |
| 登录失败 502 | ADPToolkit 不可达 | 检查 21.91.29.59:3000 服务状态 |
| 配置拉取失败 | Config Server 回调 ADPToolkit 失败 | 检查 Config Server 到 ADPToolkit 的网络连通性 |
| 配置拉取返回空 | 用户 organization 在 org_configs 表中无记录 | 在 Config Server 管理后台为该组织创建配置 |
| Token 验证失败 | Token 过期 | 自动登录时验证失败会触发 handleLogout() |
| ADP 调用 460034 | 输入过长 | 减少 prompt 长度 |
| ADP 调用 460011 | 模型 QPM 超限 | 等待或联系管理员提升配额 |

---

*文档版本：v1.0 | 更新时间：2026-06-09*
