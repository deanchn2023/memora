# Memora 登录与组织配置 API 接口文档

> 登录 → 获取用户信息 → 按组织获取配置 → 记录登录活动，完整对接流程

## 基本信息

| 项目 | 值 |
|------|-----|
| ADPToolkit Base URL | `http://21.91.29.59:3000` |
| Memora Base URL | `http://21.91.29.59:3000`（同域代理） |
| 数据格式 | JSON |
| 字符编码 | UTF-8 |

> **架构说明**：Memora 服务以 Express 中间件形式挂载在 ADPToolkit 主服务下，所有 `/memora/*` 路由通过同一域名访问。鉴权复用 ADPToolkit 的 JWT Token。

---

## 一、完整对接流程（推荐）

Memora 客户端启动后，按以下顺序调用接口：

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐     ┌────────────────┐
│ 1. 用户登录   │ ──► │ 2. 获取配置   │ ──► │ 3. 记录登录活动   │ ──► │ 4. 获取通知     │
│ /api/auth/   │     │ /memora/     │     │ /memora/activity │     │ /memora/       │
│ login        │     │ config       │     │ /login           │     │ notifications  │
└─────────────┘     └──────────────┘     └──────────────────┘     └────────────────┘
      │                     │                      │                       │
  拿到 Token          按 organization        上报客户端信息            展示未读通知
  + user 信息          拿到 ADP/AI 配置       + 版本/平台
```

---

## 二、登录接口

### 2.1 用户登录

```
POST /api/auth/login
```

**无需鉴权**

#### Request Body (JSON)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | **是** | 用户名 |
| password | string | **是** | 密码 |

#### 成功响应 (200)

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "u-abc123def4",
    "username": "zhangsan",
    "name": "张三",
    "email": "zhangsan@example.com",
    "role": "architect",
    "region": "",
    "industry": "",
    "organization": "云智能 ADP 产品中心",
    "avatar": null
  }
}
```

> **关键字段**：`token` 用于后续所有鉴权请求，`user.organization` 用于获取组织配置。

#### 错误响应

| HTTP Code | 错误信息 | 说明 |
|-----------|---------|------|
| 400 | `用户名和密码不能为空` | 缺少必填字段 |
| 401 | `用户名或密码错误` | 凭证无效 |

---

### 2.2 获取当前用户信息

```
GET /api/auth/me
```

**需要鉴权**

#### 成功响应 (200)

```json
{
  "user": {
    "id": "u-abc123def4",
    "username": "zhangsan",
    "name": "张三",
    "email": "zhangsan@example.com",
    "role": "architect",
    "region": "",
    "industry": "",
    "organization": "云智能 ADP 产品中心",
    "avatar": null
  }
}
```

---

## 三、组织配置接口

### 3.1 获取当前用户组织的配置

```
GET /memora/config
```

**需要鉴权** — 自动根据 Token 中的 `organization` 字段匹配组织配置。

#### 逻辑说明

1. 解析 Token → 取得 `user.organization`
2. 若 organization 为空 → 返回默认配置（所有值为空）
3. 若 organization 在 `org_configs` 表中无记录 → 返回默认配置
4. 若有记录 → 合并默认配置 + 组织配置返回

#### 成功响应 (200)

```json
{
  "api": {
    "api_key": "sk-b4116cb788d64e3fb20e8e5bd1333168",
    "base_url": "https://api.deepseek.com",
    "model": "deepseek-v4-flash",
    "daily_limit": 500
  },
  "adp": {
    "app_key": "<your_adp_app_key>",
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

#### 配置字段详解

| 一级字段 | 二级字段 | 类型 | 说明 |
|---------|---------|------|------|
| **api** | | | AI 模型 API 配置 |
| | api_key | string | DeepSeek/OpenAI 兼容 API Key |
| | base_url | string | API 基础地址 |
| | model | string | 默认模型名称 |
| | daily_limit | number | 每日调用限额 |
| **adp** | | | 腾讯云 ADP 智能体配置 |
| | app_key | string | ADP 应用 AppKey（Body 传递，非 Header） |
| | url | string | ADP SSE 接口地址（V2: `/adp/v2/chat`） |
| | agent_name | string | 助手显示名称 |
| | knowledge_app_key | string | 知识库应用 AppKey |
| | search_app_key | string | 联网搜索应用 AppKey |
| **prompts** | | | 自定义提示词 |
| | ai_prompt | string | AI 对话系统提示词 |
| | memory_prompt | string | 记忆提取提示词 |
| | clipboard_prompt | string | 剪贴板处理提示词 |
| **policies** | | | 客户端策略 |
| | lock_config | boolean | 是否锁定配置（禁止客户端本地覆盖） |
| | allow_local_override | boolean | 是否允许客户端本地覆盖配置 |
| **_meta** | | | 元信息（只读） |
| | organization | string | 当前组织名称 |
| | updated_at | string | 配置最后更新时间 |
| | updated_by | string | 配置最后更新者 |

#### 错误响应

| HTTP Code | 错误信息 | 说明 |
|-----------|---------|------|
| 401 | `未提供认证令牌` | 无 Authorization Header |
| 401 | `令牌无效或已过期` | Token 过期/无效 |
| 502 | `认证服务不可用` | ADPToolkit 回调验证失败 |

---

### 3.2 管理员：获取所有组织配置

```
GET /memora/admin/configs
```

**需要管理员权限**（super_admin 或 regional_admin）

#### 成功响应 (200)

```json
[
  {
    "organization": "云智能 ADP 产品中心",
    "config": {
      "api": { "api_key": "...", "base_url": "...", "model": "...", "daily_limit": 500 },
      "adp": { "app_key": "...", "url": "...", "agent_name": "...", "knowledge_app_key": "", "search_app_key": "" },
      "prompts": { "ai_prompt": "", "memory_prompt": "", "clipboard_prompt": "" },
      "policies": { "lock_config": false, "allow_local_override": true }
    },
    "updated_at": "2026-06-06T09:30:00.000Z",
    "updated_by": "system"
  }
]
```

---

### 3.3 管理员：更新组织配置

```
PUT /memora/admin/configs/:organization
```

**需要管理员权限**

#### URL 参数

| 参数 | 说明 |
|------|------|
| organization | 组织名称（URL 编码） |

#### Request Body (JSON)

完整或部分配置对象，与 `GET /memora/config` 返回结构一致（不含 `_meta`）。

```json
{
  "api": {
    "api_key": "sk-xxx",
    "base_url": "https://api.deepseek.com",
    "model": "deepseek-v4-flash",
    "daily_limit": 500
  },
  "adp": {
    "app_key": "<your_adp_app_key>",
    "url": "https://wss.lke.cloud.tencent.com/adp/v2/chat",
    "agent_name": "我的AI助手",
    "knowledge_app_key": "",
    "search_app_key": ""
  },
  "prompts": {
    "ai_prompt": "你是一个专业的助手",
    "memory_prompt": "",
    "clipboard_prompt": ""
  },
  "policies": {
    "lock_config": false,
    "allow_local_override": true
  }
}
```

#### 成功响应 (200)

```json
{
  "success": true,
  "message": "组织「云智能 ADP 产品中心」配置已更新"
}
```

> **注意**：如果组织不存在，会自动创建。

---

### 3.4 管理员：删除组织配置

```
DELETE /memora/admin/configs/:organization
```

**需要管理员权限**

#### 成功响应 (200)

```json
{
  "success": true,
  "message": "组织「xxx」配置已删除"
}
```

---

## 四、登录活动记录接口

### 4.1 记录登录活动

```
POST /memora/activity/login
```

**需要鉴权** — Memora 客户端登录成功后调用。

#### Request Body (JSON)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| login_source | string | 否 | 登录来源：`memora_client` / `web_admin` / `web_portal` / `api` |
| config_loaded | boolean | 否 | 配置是否加载成功 |
| app_version | string | 否 | 应用版本号（如 `2.1.0`） |
| platform | string | 否 | 操作系统（`darwin` / `win32` / `linux`） |

#### 成功响应 (200)

```json
{
  "success": true,
  "activity_id": "act-a1b2c3d4e5f6"
}
```

---

### 4.2 记录登出活动

```
POST /memora/activity/logout
```

**需要鉴权**

#### Request Body (JSON)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| login_source | string | 否 | 同登录来源 |

#### 成功响应 (200)

```json
{
  "success": true,
  "activity_id": "act-x9y8z7w6v5u4"
}
```

---

## 五、通知接口

### 5.1 获取通知列表

```
GET /memora/notifications
```

**需要鉴权** — 自动匹配当前用户的组织通知和全局通知。

#### Query 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| limit | number | 否 | 返回条数（默认 50） |
| offset | number | 否 | 偏移量（默认 0） |

#### 成功响应 (200)

```json
{
  "notifications": [
    {
      "id": "notif-xxx",
      "title": "系统升级通知",
      "content": "Memora v2.2 已发布...",
      "type": "system",
      "priority": "normal",
      "target_all": 1,
      "target_organization": "",
      "created_by": "admin",
      "created_at": "2026-06-06 10:00:00",
      "is_read": false
    }
  ],
  "unread_count": 3
}
```

#### 通知匹配规则

1. `target_all = 1` → 全员通知，所有用户可见
2. `target_organization` 匹配用户的 organization → 组织通知
3. `target_user_id` 匹配用户的 id → 个人通知
4. 三种规则取并集

---

### 5.2 标记通知已读

```
PUT /memora/notifications/:id/read
```

**需要鉴权**

#### 成功响应 (200)

```json
{
  "success": true
}
```

---

## 六、版本更新接口

### 6.1 检查更新

```
GET /memora/updates/check?platform=darwin&arch=arm64&version=2.1.0
```

**公开接口，无需鉴权**

#### Query 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| platform | string | 否 | 平台：`darwin` / `win32` / `linux`（默认 darwin） |
| arch | string | 否 | 架构：`arm64` / `x64`（默认 arm64） |
| version | string | **是** | 当前版本号 |

#### 成功响应 (200)

```json
{
  "has_update": true,
  "latest_version": "2.2.0",
  "release_notes": "1. 新增 AI 记忆功能\n2. 优化性能",
  "download_url": "/memora/updates/download/Memora-2.2.0-file.dmg",
  "file_size": 85432128,
  "sha256": "a1b2c3d4e5f6...",
  "released_at": "2026-06-06 10:00:00",
  "install_guide": "下载完成后双击 DMG 文件，将 Memora 拖入应用程序文件夹即可"
}
```

> `download_url` 为相对路径，拼接 Base URL 即为完整下载地址（免登录）。

---

### 6.2 下载安装包

```
GET /memora/updates/download/:filename
```

**公开接口，无需鉴权**

返回二进制文件流，`Content-Type: application/octet-stream`，`Content-Disposition: attachment`。

完整下载示例：

```
http://21.91.29.59:3000/memora/updates/download/Memora-2.2.0-file.dmg
```

---

## 七、客户端对接完整示例

### 7.1 Electron (Node.js) 完整启动流程

```javascript
const STORE_KEY_TOKEN = 'memora_token';
const STORE_KEY_USER = 'memora_user';
const STORE_KEY_CONFIG = 'memora_config';
const BASE_URL = 'http://21.91.29.59:3000';

class MemoraClient {
  constructor() {
    this.token = null;
    this.user = null;
    this.config = null;
  }

  // ========== 1. 登录 ==========
  async login(username, password) {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '登录失败');
    }
    const data = await res.json();
    this.token = data.token;
    this.user = data.user;
    return data;
  }

  // ========== 2. 获取组织配置 ==========
  async loadConfig() {
    const res = await fetch(`${BASE_URL}/memora/config`, {
      headers: { 'Authorization': `Bearer ${this.token}` },
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '获取配置失败');
    }
    this.config = await res.json();
    return this.config;
  }

  // ========== 3. 记录登录活动 ==========
  async reportLogin(appVersion, platform) {
    try {
      await fetch(`${BASE_URL}/memora/activity/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          login_source: 'memora_client',
          config_loaded: !!this.config,
          app_version: appVersion,
          platform: platform,
        }),
      });
    } catch (e) {
      console.warn('记录登录活动失败:', e.message);
    }
  }

  // ========== 4. 获取通知 ==========
  async getNotifications() {
    const res = await fetch(`${BASE_URL}/memora/notifications`, {
      headers: { 'Authorization': `Bearer ${this.token}` },
    });
    if (!res.ok) return { notifications: [], unread_count: 0 };
    return res.json();
  }

  // ========== 5. 标记通知已读 ==========
  async markNotificationRead(notifId) {
    await fetch(`${BASE_URL}/memora/notifications/${notifId}/read`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${this.token}` },
    });
  }

  // ========== 6. 检查更新 ==========
  async checkUpdate(currentVersion, platform, arch) {
    const res = await fetch(
      `${BASE_URL}/memora/updates/check?version=${currentVersion}&platform=${platform}&arch=${arch}`
    );
    return res.json();
  }

  // ========== 7. 记录登出 ==========
  async reportLogout() {
    try {
      await fetch(`${BASE_URL}/memora/activity/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`,
        },
        body: JSON.stringify({ login_source: 'memora_client' }),
      });
    } catch (e) {
      console.warn('记录登出活动失败:', e.message);
    }
  }
}

// ========== 使用示例 ==========
async function appStartup() {
  const client = new MemoraClient();

  // Step 1: 登录
  const { token, user } = await client.login('zhangsan', 'password123');
  console.log(`登录成功: ${user.name} (${user.organization})`);

  // Step 2: 加载组织配置
  const config = await client.loadConfig();
  console.log(`ADP AppKey: ${config.adp.app_key.substring(0, 20)}...`);
  console.log(`AI Model: ${config.api.model}`);

  // Step 3: 上报登录活动
  await client.reportLogin('2.1.0', 'darwin');

  // Step 4: 获取通知
  const { notifications, unread_count } = await client.getNotifications();
  console.log(`未读通知: ${unread_count} 条`);

  // Step 5: 检查更新（免登录接口）
  const update = await client.checkUpdate('2.1.0', 'darwin', 'arm64');
  if (update.has_update) {
    console.log(`发现新版本: v${update.latest_version}`);
    console.log(`下载地址: ${BASE_URL}${update.download_url}`);
  }
}
```

### 7.2 Python 对接示例

```python
import requests

BASE = 'http://21.91.29.59:3000'

class MemoraClient:
    def __init__(self):
        self.token = None
        self.user = None
        self.config = None

    @property
    def _headers(self):
        return {'Authorization': f'Bearer {self.token}'} if self.token else {}

    def login(self, username: str, password: str) -> dict:
        """登录并获取 Token"""
        resp = requests.post(f'{BASE}/api/auth/login', json={
            'username': username, 'password': password
        })
        resp.raise_for_status()
        data = resp.json()
        self.token = data['token']
        self.user = data['user']
        return data

    def load_config(self) -> dict:
        """获取当前用户组织的配置"""
        resp = requests.get(f'{BASE}/memora/config', headers=self._headers)
        resp.raise_for_status()
        self.config = resp.json()
        return self.config

    def report_login(self, app_version: str = '', platform: str = ''):
        """记录登录活动"""
        requests.post(f'{BASE}/memora/activity/login', headers=self._headers, json={
            'login_source': 'api',
            'config_loaded': self.config is not None,
            'app_version': app_version,
            'platform': platform,
        })

    def get_notifications(self) -> dict:
        """获取通知"""
        resp = requests.get(f'{BASE}/memora/notifications', headers=self._headers)
        resp.raise_for_status()
        return resp.json()

    def check_update(self, version: str, platform: str = 'darwin', arch: str = 'arm64') -> dict:
        """检查更新（公开接口）"""
        resp = requests.get(f'{BASE}/memora/updates/check', params={
            'version': version, 'platform': platform, 'arch': arch
        })
        resp.raise_for_status()
        return resp.json()

    def report_logout(self):
        """记录登出活动"""
        requests.post(f'{BASE}/memora/activity/logout', headers=self._headers, json={
            'login_source': 'api'
        })


# ========== 完整流程 ==========
if __name__ == '__main__':
    client = MemoraClient()

    # 1. 登录
    data = client.login('zhangsan', 'password123')
    print(f"登录成功: {data['user']['name']}")

    # 2. 获取配置
    config = client.load_config()
    print(f"ADP AppKey: {config['adp']['app_key'][:20]}...")
    print(f"AI Model: {config['api']['model']}")

    # 3. 上报登录
    client.report_login(app_version='2.1.0', platform='darwin')

    # 4. 获取通知
    notifs = client.get_notifications()
    print(f"未读通知: {notifs['unread_count']} 条")

    # 5. 检查更新
    update = client.check_update('2.1.0')
    if update.get('has_update'):
        print(f"新版本: v{update['latest_version']}")
        print(f"下载: {BASE}{update['download_url']}")
```

### 7.3 cURL 快速测试

```bash
# 1. 登录（获取 Token）
TOKEN=$(curl -s -X POST 'http://21.91.29.59:3000/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"username":"zhangsan","password":"your_password"}' | jq -r '.token')

# 2. 获取组织配置
curl -s 'http://21.91.29.59:3000/memora/config' \
  -H "Authorization: Bearer $TOKEN" | jq .

# 3. 记录登录活动
curl -s -X POST 'http://21.91.29.59:3000/memora/activity/login' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"login_source":"memora_client","config_loaded":true,"app_version":"2.1.0","platform":"darwin"}'

# 4. 获取通知
curl -s 'http://21.91.29.59:3000/memora/notifications' \
  -H "Authorization: Bearer $TOKEN" | jq .

# 5. 检查更新（免登录）
curl -s 'http://21.91.29.59:3000/memora/updates/check?version=2.1.0&platform=darwin&arch=arm64' | jq .

# 6. 下载安装包（免登录）
curl -O 'http://21.91.29.59:3000/memora/updates/download/Memora-2.2.0-file.dmg'
```

---

## 八、ADP SSE 调用要点（配置获取后）

获取到 `config.adp` 后，调用 ADP 智能体的关键参数：

| 参数 | 来源 | 说明 |
|------|------|------|
| AppKey | `config.adp.app_key` | **必须放在 Body 中**（V2 用 PascalCase `AppKey`） |
| URL | `config.adp.url` | V2 接口：`https://wss.lke.cloud.tencent.com/adp/v2/chat` |
| ConversationId | 客户端生成 UUID | 同一用户多轮对话复用 |
| VisitorId | `user.id` | 用户唯一标识 |
| Stream | `"enable"` | 启用 SSE 流式响应 |

### V2 接口调用示例

```javascript
async function callADP(userMessage, config, userId) {
  const body = {
    AppKey: config.adp.app_key,           // Body 传 AppKey，非 Header
    ConversationId: crypto.randomUUID(),
    VisitorId: userId,
    Contents: [{ Type: 'text', Text: userMessage }],
    RequestId: crypto.randomUUID().replace(/-/g, '').substring(0, 32),
    Stream: 'enable',
  };

  const res = await fetch(config.adp.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  // 解析 SSE 事件流...
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // 按 \n\n 分割事件，解析 event: / data: 行
  }
}
```

> 完整 ADP SSE 对接规范参见项目记忆中的 ADP V2 接口文档。

---

## 九、数据库表结构参考

### org_configs（组织配置表）

| 字段 | 类型 | 说明 |
|------|------|------|
| organization | TEXT PK | 组织名称（主键） |
| config | TEXT | JSON 配置字符串 |
| updated_at | TEXT | 最后更新时间 |
| updated_by | TEXT | 最后更新者 |

### login_activities（登录活动表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 活动ID `act-xxxxxxxx` |
| user_id | TEXT | 用户ID |
| username | TEXT | 用户名 |
| name | TEXT | 姓名 |
| organization | TEXT | 组织 |
| role | TEXT | 角色 |
| action | TEXT | 动作：`login` / `logout` |
| login_source | TEXT | 来源：`memora_client` / `web_admin` / `web_portal` / `api` |
| config_loaded | INTEGER | 配置是否加载成功（0/1） |
| app_version | TEXT | 客户端版本号 |
| platform | TEXT | 操作系统 |
| ip_address | TEXT | IP 地址 |
| user_agent | TEXT | User-Agent |
| created_at | TEXT | 创建时间 |

### users（用户表 — ADPToolkit 主库）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 主键 `u-xxxxxxxxxx` |
| username | TEXT UNIQUE | 登录用户名 |
| password | TEXT | bcrypt 哈希值 |
| name | TEXT | 真实姓名 |
| email | TEXT | 邮箱 |
| role | TEXT | 角色 |
| organization | TEXT | 所属组织（**用于匹配 org_configs**） |
| region | TEXT | 区域 |
| industry | TEXT | 行业 |
| avatar | TEXT | 头像 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

---

## 十、错误码汇总

| HTTP Code | 含义 | 典型场景 |
|-----------|------|---------|
| 200 | 成功 | 正常返回 |
| 400 | 请求参数错误 | 缺少必填字段 |
| 401 | 未授权 | 无 Token、Token 过期/无效、用户名密码错误 |
| 403 | 禁止访问 | 权限不足（非 admin 操作管理接口） |
| 404 | 资源不存在 | 组织配置/通知/版本不存在 |
| 500 | 服务器内部错误 | 数据库异常 |
| 502 | 网关错误 | ADPToolkit 认证回调失败 |

---

*文档版本：v1.0 | 更新时间：2026-06-06*
