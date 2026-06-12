# ADPToolkit 注册与认证 API 文档

> 版本: 3.0 | 更新: 2026-06-11
> 服务端: ADPToolkit | 端口: 3010
> 基础路径: `/api/auth`

---

## 1. 概述

ADPToolkit 认证系统基于 JWT，支持完整的用户生命周期管理（注册→登录→修改→停用→软删除），预留全量用户画像字段。

### 1.1 认证架构

```
┌─────────────┐                   ┌──────────────────┐                   ┌─────────────────┐
│   客户端     │ ── 登录/注册 ──► │  ADPToolkit       │ ── Token 验证 ──► │  Memora Config  │
│   (Web/移动) │ ◄── JWT Token ── │  Auth Service     │                   │  Server (3450)  │
└─────────────┘                   │  (端口 3010)       │                   └─────────────────┘
                                  └──────────────────┘
```

### 1.2 角色体系

| 角色 | 值 | 权限说明 |
|------|-----|---------|
| 超级管理员 | `super_admin` | 全部权限，可创建/删除用户、管理组织配置 |
| 区域管理员 | `regional_admin` | 可管理组织配置 |
| 架构师（普通用户） | `architect` | 基础权限，自主注册默认角色 |

### 1.3 用户数据模型

#### 基础字段（注册时使用）

| 字段 | 英文名 | 类型 | 必填 | 说明 |
|------|--------|------|:----:|------|
| 用户ID | `id` | TEXT | 自动 | 格式 `u-{nanoid(10)}`，自动生成 |
| 用户名 | `username` | TEXT | ✓ | 英文字母/数字/下划线/中划线，2-20 位，唯一 |
| 密码 | `password` | TEXT | ✓ | 最少 6 位，bcrypt 加密存储 |
| 手机号 | `mobile` | TEXT | ✓ | 11 位中国手机号，唯一 |
| 姓名 | `name` | TEXT | ✓ | 展示名（未填时取 nickname 或 username） |
| 邮箱 | `email` | TEXT | | 唯一（如填写则检查唯一性） |

#### 用户画像字段（可选）

| 字段 | 英文名 | 类型 | 说明 |
|------|--------|------|------|
| 昵称/显示名 | `nickname` | TEXT | 允许中文，展示用 |
| 真实姓名 | `real_name` | TEXT | KYC/企业客户，通常单独存 |
| 证件类型 | `id_type` | TEXT | `id_card`(身份证) / `passport`(护照) / `hk_id`(回乡证) / `other` |
| 证件号码 | `id_number` | TEXT | 加密存储，唯一校验 |
| 性别 | `gender` | INTEGER | 0=未知，1=男，2=女 |
| 生日 | `birth_date` | TEXT | YYYY-MM-DD |
| 国家/地区 | `country_code` | TEXT | CN / HK / US 等，默认 CN |
| 职业 | `profession` | TEXT | 职业/岗位 |
| 地址 | `address` | TEXT | 联系地址 |
| 推荐人/邀请码 | `invite_code` | TEXT | 营销溯源 |
| 头像 | `avatar` | TEXT | 头像 URL |
| 语言偏好 | `locale` | TEXT | zh-CN（默认）/ en-US 等 |
| 时区 | `timezone` | TEXT | Asia/Shanghai（默认） |
| 组织 | `organization` | TEXT | Memora 组织标识 |
| 区域 | `region` | TEXT | 业务区域 |
| 行业 | `industry` | TEXT | 所属行业 |

#### 系统内部字段（自动维护，一般不出现在表单）

| 字段 | 英文名 | 类型 | 说明 |
|------|--------|------|------|
| 角色 | `role` | TEXT | `super_admin` / `regional_admin` / `architect` |
| 状态 | `status` | INTEGER | 0=未激活，1=正常，2=冻结 |
| 邮箱已验真 | `email_verified` | INTEGER | 0/1 |
| 手机已验真 | `mobile_verified` | INTEGER | 0/1 |
| 最后登录时间 | `last_login_time` | TEXT | 自动更新 |
| 最后登录IP | `last_login_ip` | TEXT | 自动更新 |
| 注册来源 | `source` | TEXT | `web` / `app` / `admin_create` / `oauth` |
| 注册渠道 | `channel` | TEXT | 营销渠道 |
| 第三方登录 | `oauth_provider` | TEXT | `wechat` / `google` / `apple` |
| 第三方OpenID | `oauth_openid` | TEXT | 第三方登录绑定 |
| 创建时间 | `created_at` | TEXT | 自动记录 |
| 更新时间 | `updated_at` | TEXT | 自动更新 |
| 删除时间 | `deleted_at` | TEXT | 软删除标记，NULL=正常 |

---

## 2. 注册接口

### POST `/api/auth/register`

支持两种模式：公开注册和管理员创建，由是否携带有效管理员 Token 决定。

#### 2.1 公开注册（无 Token）

任何人可自助注册，角色固定为 `architect`，**必须验证手机号**。

**请求**

```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "zhangsan",
  "password": "MyPass123",
  "mobile": "13800138000",
  "sms_code": "123456",
  "name": "张三",
  "nickname": "小张",
  "email": "zhangsan@example.com",
  "invite_code": "INVITE2026"
}
```

**参数说明**

| 参数 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `username` | string | ✓ | 2-20 位，仅限 `[a-zA-Z0-9_-]` |
| `password` | string | ✓ | 至少 6 位 |
| `mobile` | string | ✓ | 11 位中国手机号（1开头） |
| `sms_code` | string | ✓ | 手机验证码（6位数字），管理员创建时免填 |
| `name` | string | ✓ | 姓名（未填取 nickname 或 username） |
| `nickname` | string | | 昵称/显示名 |
| `email` | string | | 邮箱，唯一 |
| `invite_code` | string | | 邀请码（由环境变量 `INVITE_CODES` 配置） |
| `locale` | string | | 语言偏好，默认 zh-CN |
| `timezone` | string | | 时区，默认 Asia/Shanghai |

**唯一性查重规则**

注册时自动检查以下字段的唯一性（排除已软删除的记录）：

| 字段 | 查重条件 |
|------|---------|
| `username` | 必查，重复返回 409 |
| `mobile` | 必查，重复返回 409 |
| `email` | 填写时查，重复返回 409 |
| `id_type + id_number` | 两者同时填写时查，重复返回 409 |

**成功响应** `200`

```json
{
  "success": true,
  "userId": "u-a1b2c3d4e5"
}
```

**错误响应**

| 状态码 | 错误信息 | 场景 |
|--------|---------|------|
| 400 | `用户名、密码、手机号、姓名不能为空` | 缺少必填字段 |
| 400 | `密码至少6位` | 密码太短 |
| 400 | `用户名只能包含英文字母、数字、下划线和中划线，2-20位` | 用户名格式不合法 |
| 400 | `手机号格式不正确` | 手机号不是 11 位中国号码 |
| 400 | `验证码不能为空` | 公开注册未填写验证码 |
| 400 | `验证码错误或已过期` | 验证码不正确或已过期 |
| 400 | `邀请码无效` | 邀请码不在白名单 |
| 409 | `用户名已存在` | 用户名重复 |
| 409 | `该手机号已被注册` | 手机号重复 |
| 409 | `该邮箱已被注册` | 邮箱重复 |
| 409 | `该证件号已被注册` | 证件号重复 |

---

### POST `/api/auth/send-code`

发送手机验证码，注册前需先调用此接口获取验证码。

**请求**

```http
POST /api/auth/send-code
Content-Type: application/json

{
  "mobile": "13800138000"
}
```

**参数说明**

| 参数 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `mobile` | string | ✓ | 11 位中国手机号 |

**成功响应** `200`

```json
{
  "success": true,
  "message": "验证码已发送",
  "code": "123456",
  "expires_in": 300
}
```

> 开发模式下 `code` 和 `expires_in` 直接返回，生产模式不返回。

**错误响应**

| 状态码 | 错误信息 | 场景 |
|--------|---------|------|
| 400 | `手机号不能为空` | 未填手机号 |
| 400 | `手机号格式不正确` | 手机号格式不对 |
| 429 | `请Ns后再试` | 60s 内重复发送 |
| 429 | `发送次数超限，请1小时后再试` | 同一手机号每小时超过5次 |

---

#### 2.2 管理员创建（需 Token）

超级管理员可指定角色创建用户。

**请求**

```http
POST /api/auth/register
Content-Type: application/json
Authorization: Bearer <super_admin_token>

{
  "username": "admin2",
  "password": "AdminPass123",
  "mobile": "13900139000",
  "name": "李四",
  "role": "regional_admin",
  "organization": "云智能ADP产品中心",
  "source": "admin_create"
}
```

**额外参数（仅管理员可用）**

| 参数 | 类型 | 说明 |
|------|------|------|
| `role` | string | 可指定为 `super_admin`/`regional_admin`/`architect`，默认 `architect` |
| `source` | string | 注册来源标记 |
| `channel` | string | 注册渠道标记 |

> 管理员创建时，`invite_code` 字段被忽略。

**响应格式与公开注册一致。**

---

## 3. 登录接口

### POST `/api/auth/login`

支持三种账号登录：用户名、手机号、邮箱。

**请求**

```http
POST /api/auth/login
Content-Type: application/json

{
  "account": "zhangsan",
  "password": "MyPass123"
}
```

**参数说明**

| 参数 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| `account` | string | ✓ | 用户名 / 手机号 / 邮箱（三合一） |
| `username` | string | | 兼容旧字段，等同 account |
| `password` | string | ✓ | 密码 |

**登录类型自动判断**

| account 格式 | 登录方式 |
|-------------|---------|
| `1[3-9]开头的11位数字` | 手机号登录 |
| `包含 @ 符号` | 邮箱登录 |
| `其他` | 用户名登录 |

**成功响应** `200`

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "u-a1b2c3d4e5",
    "username": "zhangsan",
    "name": "张三",
    "nickname": "小张",
    "email": "zhangsan@example.com",
    "mobile": "138****8000",
    "role": "architect",
    "region": "",
    "industry": "",
    "organization": "云智能ADP产品中心",
    "avatar": null,
    "locale": "zh-CN",
    "timezone": "Asia/Shanghai"
  }
}
```

**Token 说明**

| 字段 | 说明 |
|------|------|
| 算法 | HS256 |
| 有效期 | 7 天 |
| Payload | `{ sub, username, role, name, organization }` |
| 密钥 | 环境变量 `JWT_SECRET`（默认 `adp_toolkit_secret_key_2026`） |

**错误响应**

| 状态码 | 错误信息 | 场景 |
|--------|---------|------|
| 400 | `账号和密码不能为空` | 缺少字段 |
| 401 | `账号或密码错误` | 凭证错误 |
| 403 | `账号未激活，请联系管理员` | status=0 |
| 403 | `该账号已被停用，请联系管理员` | status=2 |

**副作用**

- 自动记录登录日志到 `login_logs` 表（IP、UA、时间）
- 更新 `last_login_time` 和 `last_login_ip`
- 异步通知 Memora Config Server 登录活动

---

## 4. Token 验证接口

### GET `/api/auth/me`

获取当前登录用户完整信息（过滤密码和证件号等敏感字段）。

**请求**

```http
GET /api/auth/me
Authorization: Bearer <token>
```

**成功响应** `200`

```json
{
  "user": {
    "id": "u-a1b2c3d4e5",
    "username": "zhangsan",
    "name": "张三",
    "nickname": "小张",
    "mobile": "13800138000",
    "email": "zhangsan@example.com",
    "avatar": "",
    "role": "architect",
    "region": "",
    "industry": "",
    "organization": "云智能ADP产品中心",
    "gender": 1,
    "birth_date": "1995-06-15",
    "country_code": "CN",
    "profession": "架构师",
    "address": "北京市海淀区",
    "locale": "zh-CN",
    "timezone": "Asia/Shanghai",
    "status": 1,
    "email_verified": 0,
    "mobile_verified": 0,
    "last_login_time": "2026-06-11 01:00:00",
    "last_login_ip": "192.168.1.1",
    "source": "web",
    "channel": "",
    "created_at": "2026-06-10 10:00:00",
    "updated_at": "2026-06-11 01:00:00"
  }
}
```

> 注意：`password` 和 `id_number` 不会在响应中返回。

---

## 5. 修改密码接口

### POST `/api/auth/change-password`

**请求**

```http
POST /api/auth/change-password
Authorization: Bearer <token>
Content-Type: application/json

{
  "oldPassword": "MyPass123",
  "newPassword": "NewPass456"
}
```

**成功响应** `200`

```json
{
  "success": true
}
```

---

## 6. 跨服务认证机制

### 6.1 Memora Config Server Token 验证

Memora Config Server（端口 3450）不独立管理用户，通过共享 JWT Token 与 ADPToolkit 实现跨服务认证。

支持两种验证模式（环境变量 `MEMORA_AUTH_MODE` 控制）：

| 模式 | 值 | 原理 | 适用场景 |
|------|-----|------|---------|
| 远程验证 | `remote`（默认） | 调用 ADPToolkit `/api/auth/me` 回调验证 | 不共享密钥时 |
| 本地验证 | `local` | 共享 `JWT_SECRET`，本地解码验证 | 内网部署，性能更优 |

### 6.2 认证流程

```
客户端                    ADPToolkit (3010)              Memora Config (3450)
  │                           │                              │
  │  POST /api/auth/login     │                              │
  │ ───────────────────────► │                              │
  │  ◄── JWT Token ──────────│                              │
  │                           │                              │
  │  GET /memora/config       │                              │
  │  (带 Bearer Token)        │                              │
  │ ───────────────────────────────────────────────────────►│
  │                           │                              │
  │                    （remote 模式）  GET /api/auth/me      │
  │                           │ ◄────────────────────────────│
  │                           │ ── user info ───────────────►│
  │                           │                              │
  │  ◄── config data ──────────────────────────────────────│
```

### 6.3 中间件白名单

以下路径无需 Token 即可访问：

- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/send-code`
- `/api/public/*`

---

## 7. 管理员用户管理接口

> 以下接口需要 `Authorization: Bearer <admin_token>`

### 7.1 查询用户列表

```
GET /api/users?role=architect&organization=xxx&status=1
Auth: 任意已登录用户
Response: [{ id, username, name, nickname, mobile, email, role, region, industry, organization, gender, profession, status, source, created_at, last_login_time }]
```

**筛选参数**

| 参数 | 说明 |
|------|------|
| `role` | 按角色筛选 |
| `region` | 按区域筛选 |
| `organization` | 按组织筛选 |
| `status` | 按状态筛选：0=未激活，1=正常，2=冻结 |

> 所有查询自动排除已软删除用户（`deleted_at IS NULL`）

### 7.2 查询单个用户

```
GET /api/users/:id
Auth: 任意已登录用户
Response: { id, username, name, nickname, mobile, email, avatar, role, region, industry, organization, gender, birth_date, country_code, profession, address, locale, timezone, status, email_verified, mobile_verified, source, channel, last_login_time, last_login_ip, created_at, updated_at }
```

### 7.3 修改用户信息

```
PUT /api/users/:id
Auth: 本人 或 super_admin
Body: { name?, nickname?, email?, mobile?, role?(仅admin), region?, industry?, organization?, avatar?, gender?, birth_date?, country_code?, profession?, address?, locale?, timezone?, real_name?, id_type?, id_number?, status?(仅admin) }
Response: { success: true }
```

### 7.4 修改用户密码

```
PUT /api/users/:id/password
Auth: 仅本人
Body: { oldPassword, newPassword }
Response: { success: true }
```

### 7.5 删除用户（软删除）

```
DELETE /api/users/:id
Auth: super_admin
Response: { success: true }
```

> 软删除：设置 `deleted_at` 和 `status=2`，不物理删除数据。已删除用户不会出现在列表和登录中。

### 7.6 用户统计

```
GET /api/users/:id/stats
Auth: 任意已登录用户
Response: { docCount, caseCount, demoCount }
```

---

## 8. 用户状态流转

```
         注册成功               管理员激活            管理员停用
  ──────► 0(未激活) ──────────► 1(正常) ──────────► 2(冻结)
                                   │                    │
                                   │   管理员解冻        │
                                   ◄────────────────────┘
                                   │
                                   │   软删除
                                   ▼
                              deleted_at ≠ NULL
```

---

## 9. 环境变量配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `JWT_SECRET` | `adp_toolkit_secret_key_2026` | JWT 签名密钥，生产环境务必修改 |
| `INVITE_CODES` | 空 | 邀请码白名单，逗号分隔（如 `CODE1,CODE2`） |
| `SMS_DEV_MODE` | `false` | 验证码开发模式：`true` 时响应中返回验证码，`false` 时仅服务端日志 |
| `MEMORA_CONFIG_URL` | 空 | Memora Config Server 地址，用于登录活动上报 |
| `MEMORA_AUTH_MODE` | `remote` | Config Server 验证模式：`remote` 或 `local` |
| `ADPTOOLKIT_URL` | `http://21.91.29.59:3000` | Config Server 回调 ADPToolkit 的地址 |

---

## 10. 完整请求示例

### cURL - 发送验证码

```bash
curl -X POST http://121.5.164.126:3010/api/auth/send-code \
  -H "Content-Type: application/json" \
  -d '{
    "mobile": "13800138000"
  }'
```

### cURL - 公开注册

```bash
curl -X POST http://121.5.164.126:3010/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "newuser",
    "password": "Pass123456",
    "mobile": "13800138000",
    "sms_code": "123456",
    "name": "新用户",
    "nickname": "小明",
    "email": "newuser@example.com"
  }'
```

### cURL - 用户名登录

```bash
curl -X POST http://121.5.164.126:3010/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"account":"newuser","password":"Pass123456"}'
```

### cURL - 手机号登录

```bash
curl -X POST http://121.5.164.126:3010/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"account":"13800138000","password":"Pass123456"}'
```

### cURL - 邮箱登录

```bash
curl -X POST http://121.5.164.126:3010/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"account":"newuser@example.com","password":"Pass123456"}'
```

### cURL - 管理员创建用户

```bash
curl -X POST http://121.5.164.126:3010/api/auth/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <super_admin_token>" \
  -d '{
    "username": "manager1",
    "password": "Manager123",
    "mobile": "13900139000",
    "name": "王五",
    "role": "regional_admin",
    "organization": "CSIG行业架构"
  }'
```

### cURL - Token 验证

```bash
curl http://121.5.164.126:3010/api/auth/me \
  -H "Authorization: Bearer <token>"
```

### cURL - 修改用户画像

```bash
curl -X PUT http://121.5.164.126:3010/api/users/u-a1b2c3d4e5 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "nickname": "新昵称",
    "profession": "解决方案架构师",
    "address": "上海市浦东新区",
    "locale": "zh-CN"
  }'
```
