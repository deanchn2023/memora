# Memora PC 端登录接口文档

> 版本：v3.0 | 更新时间：2026-06-10

## 架构概览

```
┌──────────────┐     ① 登录认证      ┌──────────────────┐
│  Memora PC   │ ──────────────────► │   ADPToolkit     │
│  (Electron)  │                     │   :3010/:3000    │
│              │ ◄────────────────── │   POST /api/auth │
│              │     JWT Token       │   /login         │
└──────┬───────┘                     └──────────────────┘
       │
       │  ② 携带 Token 请求
       ▼
┌──────────────────┐
│  Config Server   │  :3450
│  (Memora 扩展服务)│
│                  │
│  GET  /memora/config
│  POST /memora/activity/login
│  POST /memora/sync/device/register
│  POST /memora/sync/push
│  POST /memora/sync/pull
└──────────────────┘
```

**认证链路**：Memora PC → ADPToolkit 登录获取 JWT → 携带 JWT 调用 Config Server → Config Server 回调 ADPToolkit `/api/auth/me` 验证 Token

---

## 1. 登录认证

### POST /api/auth/login

**服务地址**：`http://{ADPToolkit_HOST}:{PORT}/api/auth/login`

| 环境 | 地址 |
|------|------|
| Lighthouse 服务器 | `http://121.5.164.126:3010/api/auth/login` |
| AnyDev 服务器 | `http://21.91.29.59:3000/api/auth/login` |
| 本地开发 | `http://localhost:3010/api/auth/login` |

**请求头**：

| 字段 | 值 |
|------|-----|
| Content-Type | application/json |

**请求体**：

```json
{
  "username": "admin",
  "password": "admin123"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 用户名 |
| password | string | 是 | 密码 |

**成功响应** (`200 OK`)：

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "u-abcdef1234",
    "username": "admin",
    "name": "管理员",
    "email": "admin@example.com",
    "role": "super_admin",
    "region": "",
    "industry": "",
    "organization": "云智能 ADP 产品中心",
    "avatar": ""
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| token | string | JWT Token，有效期 7 天，所有后续请求需携带 |
| user.id | string | 用户唯一 ID |
| user.username | string | 用户名 |
| user.name | string | 姓名 |
| user.email | string | 邮箱 |
| user.role | string | 角色：`super_admin` / `regional_admin` / `architect` |
| user.organization | string | 所属组织 |
| user.avatar | string | 头像 URL |

**失败响应**：

| 状态码 | 场景 | 响应体 |
|--------|------|--------|
| 400 | 缺少用户名或密码 | `{ "error": "用户名和密码不能为空" }` |
| 401 | 用户名或密码错误 | `{ "error": "用户名或密码错误" }` |

---

## 2. Token 验证

### GET /api/auth/me

**用途**：验证 Token 有效性，获取当前用户完整信息。Config Server 内部也会回调此接口验证 Token。

**请求头**：

| 字段 | 值 |
|------|-----|
| Authorization | Bearer {token} |

**成功响应** (`200 OK`)：

```json
{
  "user": {
    "id": "u-abcdef1234",
    "username": "admin",
    "name": "管理员",
    "email": "admin@example.com",
    "role": "super_admin",
    "region": "",
    "industry": "",
    "organization": "云智能 ADP 产品中心",
    "avatar": ""
  }
}
```

**失败响应**：

| 状态码 | 场景 | 响应体 |
|--------|------|--------|
| 401 | 未提供 Token | `{ "error": "未登录" }` |
| 401 | Token 无效/过期 | `{ "error": "令牌无效" }` |

---

## 3. 获取组织配置

### GET /memora/config

**服务地址**：`http://121.5.164.126:3450/memora/config`

**调用时机**：Memora PC 登录成功后，首次启动时调用，获取 AI/API/ADP 等配置。

**请求头**：

| 字段 | 值 |
|------|-----|
| Authorization | Bearer {token} |

**成功响应** (`200 OK`)：

```json
{
  "api": {
    "api_key": "sk-xxx",
    "base_url": "https://api.deepseek.com",
    "model": "deepseek-v4-flash",
    "daily_limit": 500
  },
  "adp": {
    "app_key": "EvcCHx...",
    "knowledge_app_key": "",
    "graph_app_key": "",
    "clustering_app_key": "",
    "search_app_key": "",
    "url": "https://wss.lke.cloud.tencent.com/adp/v2/chat",
    "agent_name": "我的AI助手"
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
    "updated_at": "2026-06-01T12:00:00.000Z"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| api.api_key | string | DeepSeek API Key（组织级共享） |
| api.base_url | string | API 基础地址 |
| api.model | string | 默认模型名称 |
| api.daily_limit | number | 每日调用限制 |
| adp.app_key | string | ADP 智能体 AppKey |
| adp.url | string | ADP V2 接口地址 |
| adp.agent_name | string | 智能体显示名称 |
| prompts.ai_prompt | string | AI 助手系统提示词 |
| prompts.memory_prompt | string | 记忆提取提示词 |
| prompts.clipboard_prompt | string | 剪贴板分析提示词 |
| policies.lock_config | boolean | 是否锁定配置（禁止本地覆盖） |
| policies.allow_local_override | boolean | 是否允许本地覆盖远程配置 |

---

## 4. 记录登录活动

### POST /memora/activity/login

**服务地址**：`http://121.5.164.126:3450/memora/activity/login`

**调用时机**：Memora PC 登录成功并加载配置后，上报登录活动。

**请求头**：

| 字段 | 值 |
|------|-----|
| Authorization | Bearer {token} |
| Content-Type | application/json |

**请求体**：

```json
{
  "login_source": "memora_client",
  "config_loaded": true,
  "app_version": "3.0.0",
  "platform": "darwin"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| login_source | string | 否 | 登录来源：`memora_client` \| `web_admin` \| `web_portal` \| `api` |
| config_loaded | boolean | 否 | 配置是否加载成功 |
| app_version | string | 否 | 应用版本号 |
| platform | string | 否 | 操作系统：`darwin` \| `win32` \| `linux` |

**成功响应** (`200 OK`)：

```json
{
  "success": true,
  "activity_id": "act-1a2b3c4d5e6f"
}
```

---

## 5. 记录登出活动

### POST /memora/activity/logout

**服务地址**：`http://121.5.164.126:3450/memora/activity/logout`

**调用时机**：Memora PC 用户退出登录时调用。

**请求头**：

| 字段 | 值 |
|------|-----|
| Authorization | Bearer {token} |
| Content-Type | application/json |

**请求体**：

```json
{
  "login_source": "memora_client"
}
```

**成功响应** (`200 OK`)：

```json
{
  "success": true,
  "activity_id": "act-7g8h9i0j1k2l"
}
```

---

## 6. 修改密码

### POST /api/auth/change-password

**服务地址**：`http://{ADPToolkit_HOST}:{PORT}/api/auth/change-password`

**请求头**：

| 字段 | 值 |
|------|-----|
| Authorization | Bearer {token} |
| Content-Type | application/json |

**请求体**：

```json
{
  "oldPassword": "admin123",
  "newPassword": "newPassword456"
}
```

**成功响应** (`200 OK`)：

```json
{
  "success": true
}
```

**失败响应**：

| 状态码 | 场景 | 响应体 |
|--------|------|--------|
| 400 | 原密码错误 | `{ "error": "原密码错误" }` |
| 401 | Token 无效 | `{ "error": "令牌无效" }` |

---

## 7. 注册设备（首次登录后）

### POST /memora/sync/device/register

**服务地址**：`http://121.5.164.126:3450/memora/sync/device/register`

**调用时机**：Memora PC 首次登录后，注册设备信息用于多端同步。

**请求头**：

| 字段 | 值 |
|------|-----|
| Authorization | Bearer {token} |
| Content-Type | application/json |

**请求体**：

```json
{
  "device_id": "memora-macbook-pro-abc123",
  "platform": "electron",
  "device_name": "MacBook Pro",
  "app_version": "3.0.0"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| device_id | string | 是 | 设备唯一 ID，客户端本地生成 |
| platform | string | 是 | 平台：`electron` \| `flutter` \| `miniprogram` \| `web` |
| device_name | string | 否 | 设备名称 |
| app_version | string | 否 | 应用版本号 |

**成功响应** (`200 OK`)：

```json
{
  "ok": true,
  "device_id": "memora-macbook-pro-abc123",
  "is_new": true
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| is_new | boolean | 是否为新注册设备（首次注册为 true） |

---

## PC 端登录完整流程

```
1. 用户输入用户名密码
         │
         ▼
2. POST /api/auth/login ──► ADPToolkit
         │
         ◄── JWT Token + 用户信息
         │
3. 本地存储 Token
         │
         ▼
4. GET /memora/config ──► Config Server
   (Header: Bearer Token)
         │
         ◄── 组织配置 (API Key, ADP AppKey, Prompts...)
         │
         ▼
5. POST /memora/activity/login ──► Config Server
   (上报登录活动)
         │
         ▼
6. POST /memora/sync/device/register ──► Config Server
   (注册设备)
         │
         ▼
7. POST /memora/sync/pull ──► Config Server
   (拉取云端数据，同步到本地)
         │
         ▼
8. 进入主界面
```

---

## Token 机制说明

| 项目 | 说明 |
|------|------|
| 算法 | HS256 (HMAC-SHA256) |
| 密钥 | `JWT_SECRET` 环境变量（默认 `adp_toolkit_secret_key_2026`） |
| 有效期 | 7 天 |
| Payload 字段 | `sub`(用户ID), `username`, `role`, `name`, `organization`, `iat`, `exp` |
| 验证方式 | 两种模式可切换：`remote`(回调 ADPToolkit) / `local`(本地 JWT 解码) |
| 缓存 | 验证结果缓存 5 分钟 (`CACHE_TTL=300000ms`) |
| 传输方式 | `Authorization: Bearer {token}` |

### 验证模式

| 模式 | 环境变量 | 说明 | 适用场景 |
|------|----------|------|----------|
| remote | `MEMORA_AUTH_MODE=remote`（默认） | 每次请求回调 ADPToolkit `/api/auth/me` | 跨服务部署，Token 不共享密钥 |
| local | `MEMORA_AUTH_MODE=local` | 本地 JWT 解码，不回调 | 同密钥部署，低延迟 |

---

## 错误码汇总

| 状态码 | 错误信息 | 说明 |
|--------|----------|------|
| 400 | 用户名和密码不能为空 | 登录请求缺少必填字段 |
| 401 | 用户名或密码错误 | 凭据无效 |
| 401 | 未提供认证令牌 | 请求头缺少 Authorization |
| 401 | 令牌无效或已过期 | Token 验证失败 |
| 403 | 需要管理员权限 | 非管理员访问管理接口 |
| 502 | 认证服务不可用 | ADPToolkit 回调超时/失败 |

---

## 跨域配置

Config Server 已配置 CORS 允许以下来源：

- `http://121.5.164.126:*`
- `http://21.91.29.59:*`
- `http://localhost:*`
- `http://127.0.0.1:*`

Electron 应用使用 `file://` 协议，不受 CORS 限制。
