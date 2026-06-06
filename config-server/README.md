# Memora 配置管理服务

## 快速启动

```bash
npm install
npm start
```

默认端口：3450

## 默认管理员

首次启动自动创建：
- 邮箱：admin@memora.com
- 密码：admin123
- ⚠️ 请立即修改默认密码

## API 端点

### 认证
- `POST /auth/login` — 登录，返回 JWT Token
- `GET /auth/validate` — 验证 Token 有效性

### 配置
- `GET /config` — 获取当前用户所属组织的配置
- `GET /config/check` — 轻量检查配置更新时间

### 管理员（需 admin 角色）
- `POST /admin/orgs` — 创建组织
- `GET /admin/orgs` — 列出所有组织
- `GET /admin/orgs/:orgId` — 获取组织详情（含成员和配置）
- `PUT /admin/orgs/:orgId/config` — 更新组织配置
- `POST /admin/users` — 创建用户
- `GET /admin/users` — 列出所有用户
- `PUT /admin/users/:userId` — 更新用户

## 配置结构

```json
{
  "api": {
    "api_key": "sk-xxx",
    "base_url": "https://api.deepseek.com",
    "model": "deepseek-v4-flash",
    "daily_limit": 500
  },
  "adp": {
    "app_key": "VnIv...",
    "knowledge_app_key": "",
    "search_app_key": "",
    "url": "https://wss.lke.cloud.tencent.com/adp/v2/chat",
    "agent_name": "公司AI助手"
  },
  "prompts": {
    "ai_prompt": "",
    "memory_prompt": "",
    "clipboard_prompt": ""
  },
  "policies": {
    "lock_config": false,
    "allow_local_override": true
  }
}
```
