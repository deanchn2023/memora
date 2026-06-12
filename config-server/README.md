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
    "clustering_app_key": "",
    "graph_app_key": "",
    "url": "https://wss.lke.cloud.tencent.com/adp/v2/chat",
    "agent_name": "公司AI助手"
  },
  "file_share": {
    "api_key": "adp_xxx"
  },
  "tencent_cloud": {
    "secret_id": "",
    "secret_key": "",
    "bot_biz_id": ""
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

### 配置字段说明

| 分组 | 字段 | 说明 | 获取方式 |
|------|------|------|----------|
| `api` | `api_key` | LLM API Key | DeepSeek/智谱等平台控制台 |
| `api` | `base_url` | LLM API 地址 | 默认 `https://api.deepseek.com` |
| `api` | `model` | 模型名称 | 如 `deepseek-v4-flash` |
| `api` | `daily_limit` | 每日调用上限 | 默认 500 |
| `adp` | `app_key` | ADP 通用 AppKey | ADP 应用管理页面 |
| `adp` | `knowledge_app_key` | 知识推荐专用 AppKey | ADP 应用管理页面 |
| `adp` | `search_app_key` | 知识搜索专用 AppKey | ADP 应用管理页面 |
| `adp` | `clustering_app_key` | 知识聚类专用 AppKey | ADP 应用管理页面 |
| `adp` | `graph_app_key` | 知识图谱专用 AppKey | ADP 应用管理页面 |
| `adp` | `url` | ADP API 地址 | 默认 `https://wss.lke.cloud.tencent.com/adp/v2/chat` |
| `adp` | `agent_name` | 助手显示名称 | 自定义 |
| `file_share` | `api_key` | File Share 降级方案 Key | 自部署的 File Share 服务 |
| `tencent_cloud` | `secret_id` | 腾讯云 SecretId | 腾讯云控制台「访问管理 → API密钥管理」 |
| `tencent_cloud` | `secret_key` | 腾讯云 SecretKey | 腾讯云控制台「访问管理 → API密钥管理」 |
| `tencent_cloud` | `bot_biz_id` | ADP 应用业务 ID | ADP 应用管理页面 → 应用详情 |
| `policies` | `lock_config` | 是否锁定配置（禁止客户端覆盖） | 管理员控制 |
| `policies` | `allow_local_override` | 是否允许本地配置覆盖 | 管理员控制 |

### 腾讯云文件上传配置指南

Memora 的 ADP 文件对话功能使用腾讯云 COS 上传（[官方文档](https://cloud.tencent.com/document/product/1759/108903)），需要配置以下三个字段：

#### 1. 获取 SecretId 和 SecretKey
1. 登录 [腾讯云控制台](https://console.cloud.tencent.com/)
2. 进入「访问管理」→「API密钥管理」
3. 创建或查看 SecretId 和 SecretKey
4. ⚠️ 建议使用子账号密钥，仅授予 `LKE` 相关权限

#### 2. 获取 BotBizId
1. 登录 [ADP 智能体开发平台](https://lke.cloud.tencent.com/)
2. 进入「应用管理」→ 选择目标应用 → 点击「应用详情」
3. 找到「应用ID」（BotBizId），格式如 `177106121651545xxxx`
4. 注意：BotBizId ≠ AppKey，两者是不同的字段

#### 3. 通过管理后台配置
```bash
# 更新组织配置（需 admin 角色）
curl -X PUT http://121.5.164.126:3450/admin/orgs/{orgId}/config \
  -H "Authorization: Bearer {admin_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "tencent_cloud": {
      "secret_id": "<your_secret_id>",
      "secret_key": "<your_secret_key>",
      "bot_biz_id": "<your_bot_biz_id>"
    }
  }'
```

配置后，组织内所有 Memora 客户端登录即可自动获得 COS 上传能力，无需每台设备单独配置。

#### 4. 安全注意事项
- `secret_key` 是敏感信息，仅通过 HTTPS 传输
- Config Server 仅在认证后返回配置，未登录用户无法获取
- 建议为 Memora 专用子账号，限制最小权限
- 如需更高安全性，可在 `policies.lock_config = true` 锁定后禁止客户端本地覆盖
