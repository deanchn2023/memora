# SkillHub 市场集成方案

> 在文档 → Skill 标签页下新增「SkillHub 市场」子标签，展示第三方 SkillHub 市场的技能，支持搜索、浏览、一键安装到 CC 工作目录。

---

## 一、背景

### 1.1 SkillHub 简介
- **网站**：https://skillhub.cn/skills
- **定位**：专为中国用户优化的 AI Skills 社区，约 2.2 万个技能
- **CLI 工具**：`skillhub` 命令行，支持搜索/安装/列表/升级技能
- **安装方式**：`curl -fsSL .../install.sh | bash -s -- --cli-only`（仅 CLI，不装默认 Skill）
- **安装路径**：`~/.local/bin/skillhub`

### 1.2 CLI 命令验证（已完成）

| 命令 | 用途 | JSON 输出 |
|------|------|-----------|
| `skillhub search <query> --json --search-limit N` | 搜索技能 | `{query, count, results: [{slug, name, description, version, source}]}` |
| `skillhub install <slug> --json --dir <path>` | 安装技能到指定目录 | `{success, slug, name, version, targetDir}` |
| `skillhub list --dir <path>` | 列出已安装技能 | 文本格式 `slug  version` |
| `skillhub upgrade --dir <path>` | 升级已安装技能 | — |
| `skillhub --version` | 查看版本 | — |

**关键参数**：
- `--dir <path>`：指定安装根目录，技能装在 `<dir>/<slug>/` 下
- `--json`：输出结构化 JSON，便于程序解析
- `--skip-self-upgrade`：跳过启动时的自升级检查（加速）

---

## 二、UI 设计

### 2.1 Skill 标签页结构

```
文档 → 🧩 Skill 标签页
├── 📦 我的技能（现有：上传的 zip 包管理）
└── 🌐 SkillHub 市场（新增）
    ├── 搜索框 + 排序/筛选
    ├── 技能卡片网格
    │   └── 卡片：名称 / 描述 / 版本 / 来源 / [安装]按钮
    └── 分页
```

### 2.2 子标签切换

在 Skill 标签页顶部增加两个子标签：

```html
<div class="skill-sub-tabs">
  <button class="skill-sub-tab active" data-subtab="mine">📦 我的技能</button>
  <button class="skill-sub-tab" data-subtab="market">🌐 SkillHub 市场</button>
</div>
```

- **📦 我的技能**：现有的 zip 上传管理（保持不变）
- **🌐 SkillHub 市场**：搜索浏览 SkillHub 市场，一键安装

### 2.3 市场搜索区

```
┌─────────────────────────────────────────────────┐
│ 🔍 [搜索关键词____________] [搜索]    每页: 20 ▼ │
└─────────────────────────────────────────────────┘
```

- 搜索框输入关键词，回车或点击搜索按钮触发 `skillhub search`
- 空搜索时显示热门技能（搜索高频词或默认推荐）

### 2.4 技能卡片

```
┌──────────────────────────────────────┐
│ 📅 Calendar                    v1.0.0│
│                                      │
│ 日历管理与日程安排。创建事件、管理     │
│ 会议，并实现多日历平台同步。           │
│                                      │
│ 来源: community                       │
│                    [📥 安装到CC] [ℹ️] │
└──────────────────────────────────────┘
```

- **名称**：技能名称
- **描述**：中英文描述（截断显示，hover 展开）
- **版本**：`v1.0.0`
- **来源**：community / enterprise
- **📥 安装到CC**：调用 `skillhub install --dir <cc-workdir>/.claude/skills` 安装
- **ℹ️ 详情**：跳转到 `https://skillhub.cn/skills/<slug>` 查看详情
- 安装后按钮变为 **✅ 已安装**，点击可 **卸载**（删除目录）

### 2.5 安装状态同步

安装到 CC 工作目录后，技能自动出现在 CC 对话框的 Skill 下拉框中（现有的 `_refreshCCSkillSelect` 逻辑会扫描 `.claude/skills/` 目录）。

---

## 三、技术实现

### 3.1 IPC 设计

| IPC | 参数 | 返回 | 说明 |
|-----|------|------|------|
| `skillhub:search` | `{ query, limit }` | `{ success, results: [...] }` | 调用 `skillhub search --json` |
| `skillhub:install` | `{ slug, targetDir }` | `{ success, targetDir }` | 调用 `skillhub install --json --dir` |
| `skillhub:list` | `{ dir }` | `{ success, skills: [...] }` | 调用 `skillhub list` 解析 |
| `skillhub:check` | — | `{ installed: bool, path: string }` | 检查 CLI 是否已安装 |
| `skillhub:install-cli` | — | `{ success }` | 安装 SkillHub CLI |

### 3.2 main.js 实现

```javascript
const SKILLHUB_CLI = path.join(os.homedir(), '.local', 'bin', 'skillhub');
const EXEC_ENV = { ...process.env, PATH: `/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin:${process.env.PATH}` };

// 检查 CLI 是否安装
ipcMain.handle('skillhub:check', async () => {
  const installed = fs.existsSync(SKILLHUB_CLI);
  return { installed, path: installed ? SKILLHUB_CLI : null };
});

// 搜索技能
ipcMain.handle('skillhub:search', async (event, { query, limit = 20 }) => {
  try {
    const { execSync } = require('child_process');
    const cmd = `"${SKILLHUB_CLI}" --skip-self-upgrade search --json --search-limit ${limit} ${query ? `"${query}"` : ''}`;
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 15000, env: EXEC_ENV });
    const data = JSON.parse(output);
    return { success: true, results: data.results || [], count: data.count || 0 };
  } catch (e) {
    return { success: false, error: e.message, results: [] };
  }
});

// 安装技能到指定目录
ipcMain.handle('skillhub:install', async (event, { slug, targetDir }) => {
  try {
    const { execSync } = require('child_process');
    fs.mkdirSync(targetDir, { recursive: true });
    const cmd = `"${SKILLHUB_CLI}" --skip-self-upgrade install --json --dir "${targetDir}" "${slug}"`;
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 60000, env: EXEC_ENV });
    const data = JSON.parse(output);
    return { success: data.success, targetDir: data.targetDir, slug: data.slug };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 列出已安装技能
ipcMain.handle('skillhub:list', async (event, { dir }) => {
  try {
    const { execSync } = require('child_process');
    const cmd = `"${SKILLHUB_CLI}" --skip-self-upgrade list --dir "${dir}"`;
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 10000, env: EXEC_ENV });
    // 解析 "slug  version" 格式
    const skills = output.trim().split('\n').filter(Boolean).map(line => {
      const [slug, version] = line.trim().split(/\s+/);
      return { slug, version };
    });
    return { success: true, skills };
  } catch (e) {
    return { success: false, error: e.message, skills: [] };
  }
});
```

### 3.3 安装目标目录

安装到 CC 工作目录的 `.claude/skills/` 下，与现有 Skill 管理一致：

```
<cc-workdir>/.claude/skills/
├── <上传的zip解压skill>/
├── <skillhub安装的skill>/
└── ...
```

CC SDK 子进程启动时自动扫描此目录加载所有 Skill。

### 3.4 CLI 安装引导

首次打开 SkillHub 市场标签时，检查 CLI 是否已安装：
- **已安装**：直接显示搜索界面
- **未安装**：显示引导界面，提供"一键安装 CLI"按钮

```javascript
ipcMain.handle('skillhub:install-cli', async () => {
  try {
    const { execSync } = require('child_process');
    const cmd = `curl -fsSL https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/install.sh | bash -s -- --cli-only`;
    execSync(cmd, { encoding: 'utf-8', timeout: 60000, env: EXEC_ENV });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
```

### 3.5 卸载技能

删除 `<targetDir>/<slug>/` 目录即可卸载：
```javascript
ipcMain.handle('skillhub:uninstall', async (event, { slug, targetDir }) => {
  try {
    const skillDir = path.join(targetDir, slug);
    if (fs.existsSync(skillDir)) {
      fs.rmSync(skillDir, { recursive: true, force: true });
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
```

---

## 四、用户流程

### 4.1 首次使用

```
1. 文档 → Skill → 🌐 SkillHub 市场
2. 检测到 CLI 未安装 → 显示引导
3. 点击"一键安装 CLI" → 后台执行安装脚本
4. 安装完成 → 显示搜索界面
```

### 4.2 搜索安装

```
1. 输入关键词（如 "calendar"）→ 搜索
2. 浏览结果卡片
3. 点击"📥 安装到CC" → 安装到 cc-workdir/.claude/skills/
4. 安装完成 → 按钮变为"✅ 已安装"
5. 切换到 CC 对话 → Skill 下拉框出现新技能
6. 选择技能 → 发送消息 → CC 子进程加载技能
```

### 4.3 卸载

```
1. 已安装的技能卡片显示"✅ 已安装 | 卸载"
2. 点击"卸载" → 删除目录
3. 下次 CC 对话下拉框不再显示该技能
```

---

## 五、与现有 Skill 管理的关系

| 维度 | 我的技能（现有） | SkillHub 市场（新增） |
|------|----------------|---------------------|
| 来源 | 用户上传 zip 包 | SkillHub 市场搜索安装 |
| 存储 | `userData/cc-skills/` | `cc-workdir/.claude/skills/` |
| 安装方式 | zip 解压 | CLI install |
| CC 加载 | 手动"安装到CC"链接 | 直接安装到 CC 目录 |
| 卸载 | 删除 zip 解压目录 | 删除安装目录 |

两者独立但互补：用户既可上传自定义 zip，也可从市场搜索安装。

---

## 六、实施计划

| 阶段 | 内容 | 工作量 |
|------|------|--------|
| Phase 1 | IPC + CLI 检查/安装引导 | 0.5 天 |
| Phase 2 | 搜索 + 卡片渲染 + 安装 | 0.5 天 |
| Phase 3 | 子标签切换 + 安装状态同步 | 0.5 天 |
| Phase 4 | 卸载 + 详情跳转 | 0.5 天 |
| **合计** | | **2 天** |

---

## 七、注意事项

1. **CLI 依赖**：用户机器需安装 `skillhub` CLI，首次使用引导安装
2. **网络**：搜索和下载依赖 SkillHub CDN（腾讯云 COS），国内可直连
3. **PATH 环境**：Electron 主进程的 PATH 可能缺少 `~/.local/bin`，需显式设置
4. **超时**：搜索 15s 超时，安装 60s 超时
5. **安全**：CLI 安装脚本来自 SkillHub 官方 CDN，信任度与 SkillHub 网站一致
6. **升级**：`skillhub upgrade` 可批量升级已安装技能，未来可加"一键升级"按钮
