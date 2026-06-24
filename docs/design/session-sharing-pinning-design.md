# Memora 会话分享与置顶功能设计方案

**版本**: v1.0  
**日期**: 2026-06-25  
**状态**: 设计中

---

## 一、功能概述

### 1.1 会话分享功能 (.ora 格式)

将会话打包为 `.ora` 文件（本质是 ZIP），包含会话元数据和关联的 Agent 产物文件，支持在其他 Memora 客户端导入查看。

### 1.2 会话置顶功能

支持将重要会话钉住到列表顶部，超过 5 条时自动折叠，保持置顶区域整洁。

---

## 二、会话分享功能 (.ora)

### 2.1 文件格式设计

```
.session.ora
    ↓ (实际为 ZIP，扩展名 .ora)
    ├── session.json      # 会话元数据
    ├── messages.html     # 对话消息（可选，完整渲染）
    └── artifacts/        # 关联的产物文件
        ├── 2026-06-24/
        │   ├── report.html
        │   └── data.json
        └── ...
```

### 2.2 session.json 结构

```json
{
  "formatVersion": "1.0",
  "memoraVersion": "3.1.0",
  "sessionId": "chat_1719264000000_abc123",
  "title": "ADP 智能体调试",
  "createdAt": "2026-06-24T10:00:00.000Z",
  "updatedAt": "2026-06-24T14:30:00.000Z",
  "taskType": "parallel",
  "agentTypes": ["cc", "adp"],
  "expertId": null,
  "expertName": null,
  "messageCount": 15,
  "conversationHistory": [
    {
      "timestamp": "2026-06-24T10:01:00.000Z",
      "user": "帮我分析这段代码的问题",
      "assistant": "根据代码分析，我发现以下几个问题..."
    }
  ],
  "artifacts": [
    {
      "originalPath": "agent-artifacts/2026-06-24/report.html",
      "fileName": "report.html",
      "size": 10240,
      "hash": "sha256:abc123..."
    }
  ],
  "metadata": {
    "exportedBy": "Memora v3.1.0",
    "exportedAt": "2026-06-24T15:00:00.000Z",
    "platform": "darwin",
    "userName": "admin"
  }
}
```

### 2.3 实现方案

#### 2.3.1 导出功能（渲染进程）

```javascript
// src/scripts/app.js 新增方法

/**
 * 导出会话为 .ora 文件
 */
async exportSession(sessionId = null) {
  const targetSession = sessionId || this._activeSessionId;
  if (!targetSession) {
    this._showToast('请先选择要导出的会话', 'warning');
    return;
  }

  const session = this._chatSessions.find(s => s.id === targetSession);
  if (!session) {
    this._showToast('会话不存在', 'error');
    return;
  }

  try {
    // 1. 收集会话数据
    const sessionData = this._collectSessionData(session);
    
    // 2. 收集关联的 artifacts 文件
    const artifacts = await this._collectSessionArtifacts(session);
    
    // 3. 调用主进程打包
    const result = await window.electronAPI?.sessionExport?.({
      sessionData,
      artifacts,
    });
    
    if (result?.success) {
      // 4. 触发下载
      this._triggerFileDownload(result.filePath, `${session.title || 'session'}.ora`);
      this._showToast('会话已导出', 'success');
    } else {
      this._showToast('导出失败: ' + (result?.error || '未知错误'), 'error');
    }
  } catch (err) {
    console.error('[SessionExport] Error:', err);
    this._showToast('导出异常: ' + err.message, 'error');
  }
}

/**
 * 收集会话数据
 */
_collectSessionData(session) {
  const msgHtml = localStorage.getItem('memora_session_msg_' + session.id) || '';
  
  // 解析对话历史（从 HTML 中提取用户和助手消息）
  const conversationHistory = this._parseConversationHistory(msgHtml);
  
  return {
    formatVersion: '1.0',
    memoraVersion: window.electronAPI?.getAppVersion?.() || '3.1.0',
    sessionId: session.id,
    title: session.title || '新对话',
    createdAt: session.createdAt,
    updatedAt: session.updatedAt || session.createdAt,
    taskType: session.taskType || 'chat',
    agentTypes: session.agentTypes || [],
    expertId: session.expertId || null,
    expertName: session.expertName || null,
    messageCount: session.messageCount || conversationHistory.length,
    conversationHistory,
    messagesHtml: msgHtml, // 完整消息 HTML（用于导入时还原）
    metadata: {
      exportedBy: 'Memora',
      exportedAt: new Date().toISOString(),
      platform: process.platform,
      userName: this._currentUser?.email?.split('@')[0] || 'user',
    },
  };
}

/**
 * 解析对话历史
 */
_parseConversationHistory(html) {
  const history = [];
  if (!html) return history;
  
  // 使用 DOMParser 解析 HTML
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  const messages = doc.querySelectorAll('.message');
  messages.forEach(msg => {
    const role = msg.classList.contains('user') ? 'user' : 'assistant';
    const contentEl = msg.querySelector('.message-content');
    const text = contentEl ? contentEl.textContent : '';
    const timestamp = msg.dataset?.sendTime;
    
    if (text.trim()) {
      history.push({
        timestamp,
        role,
        text: text.substring(0, 5000), // 限制长度
      });
    }
  });
  
  return history;
}

/**
 * 收集会话关联的 artifacts
 */
async _collectSessionArtifacts(session) {
  const artifacts = [];
  const basePath = await window.electronAPI?.artifactsGetBasePath?.();
  
  if (!basePath?.path) return artifacts;
  
  try {
    // 扫描 artifacts 目录中最近 7 天的文件
    const recentDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const sessionDate = new Date(session.updatedAt || session.createdAt).toISOString().split('T')[0];
    
    const dateDir = path.join(basePath.path, sessionDate);
    if (fs.existsSync(dateDir)) {
      const files = fs.readdirSync(dateDir);
      files.forEach(file => {
        const filePath = path.join(dateDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile() && stat.mtime >= recentDate) {
            artifacts.push({
              relativePath: `${sessionDate}/${file}`,
              fileName: file,
              size: stat.size,
            });
          }
        } catch {}
      });
    }
  } catch (err) {
    console.warn('[SessionExport] Failed to collect artifacts:', err);
  }
  
  return artifacts;
}

/**
 * 触发文件下载
 */
_triggerFileDownload(filePath, fileName) {
  // 创建隐藏的 <a> 标签触发下载
  const link = document.createElement('a');
  link.href = 'file://' + filePath;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  // 或者使用 Electron 的 shell API
  // window.electronAPI?.openExternal('file://' + filePath);
}
```

#### 2.3.2 主进程 IPC 实现

```javascript
// main.js 新增 IPC

const { archiver } = require('archiver'); // 需要安装依赖

// 导出会话为 .ora 文件
ipcMain.handle('session:export', async (event, { sessionData, artifacts }) => {
  try {
    // 创建临时目录
    const tempDir = path.join(os.tmpdir(), `memora-export-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    // 1. 写入 session.json
    const sessionJsonPath = path.join(tempDir, 'session.json');
    fs.writeFileSync(sessionJsonPath, JSON.stringify(sessionData, null, 2), 'utf8');
    
    // 2. 写入 messages.html（如果存在）
    if (sessionData.messagesHtml) {
      const messagesHtmlPath = path.join(tempDir, 'messages.html');
      fs.writeFileSync(messagesHtmlPath, sessionData.messagesHtml, 'utf8');
    }
    
    // 3. 复制 artifacts 文件
    if (artifacts && artifacts.length > 0) {
      const artifactsDir = path.join(tempDir, 'artifacts');
      fs.mkdirSync(artifactsDir, { recursive: true });
      
      const basePath = getArtifactsBasePath();
      for (const artifact of artifacts) {
        const srcPath = path.join(basePath, artifact.relativePath);
        if (fs.existsSync(srcPath)) {
          const destDir = path.join(artifactsDir, path.dirname(artifact.relativePath));
          fs.mkdirSync(destDir, { recursive: true });
          fs.copyFileSync(srcPath, path.join(destDir, artifact.fileName));
        }
      }
    }
    
    // 4. 打包为 ZIP
    const oraFileName = `${sessionData.title || 'session'}.ora`;
    const oraFileNameSafe = oraFileName.replace(/[<>:"/\\|?*]/g, '_');
    const outputPath = path.join(os.tmpdir(), oraFileNameSafe);
    
    await createZipArchive(tempDir, outputPath);
    
    // 5. 清理临时目录
    fs.rmSync(tempDir, { recursive: true, force: true });
    
    console.log('[SessionExport] Created:', outputPath);
    return { success: true, filePath: outputPath };
  } catch (err) {
    console.error('[SessionExport] Error:', err);
    return { success: false, error: err.message };
  }
});

// 创建 ZIP 压缩包
async function createZipArchive(sourceDir, outputPath) {
  const output = fs.createWriteStream(outputPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  
  return new Promise((resolve, reject) => {
    archive.directory(sourceDir, false);
    
    archive.on('error', (err) => reject(err));
    archive.pipe(output);
    
    output.on('close', () => resolve());
    archive.finalize();
  });
}

// 导入 .ora 文件
ipcMain.handle('session:import', async (event, { filePath }) => {
  try {
    // 解压 .ora 文件到临时目录
    const tempDir = path.join(os.tmpdir(), `memora-import-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    
    await extractZipArchive(filePath, tempDir);
    
    // 读取 session.json
    const sessionJsonPath = path.join(tempDir, 'session.json');
    if (!fs.existsSync(sessionJsonPath)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      return { success: false, error: '无效的 .ora 文件：缺少 session.json' };
    }
    
    const sessionData = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf8'));
    
    // 验证格式版本
    if (!sessionData.formatVersion || sessionData.formatVersion !== '1.0') {
      fs.rmSync(tempDir, { recursive: true, force: true });
      return { success: false, error: '不支持的 .ora 格式版本' };
    }
    
    // 返回导入数据（由渲染进程处理会话创建）
    return { 
      success: true, 
      sessionData,
      tempDir,
    };
  } catch (err) {
    console.error('[SessionImport] Error:', err);
    return { success: false, error: err.message };
  }
});

// 解压 ZIP 文件
async function extractZipArchive(zipPath, outputDir) {
  const { execSync } = require('child_process');
  
  return new Promise((resolve, reject) => {
    try {
      // macOS/Linux: 使用 unzip
      if (process.platform === 'darwin' || process.platform === 'linux') {
        execSync(`unzip -q "${zipPath}" -d "${outputDir}"`, { stdio: 'ignore' });
      } else {
        // Windows: 使用 PowerShell
        execSync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${outputDir}' -Force"`, { stdio: 'ignore' });
      }
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}
```

#### 2.3.3 渲染进程导入处理

```javascript
// src/scripts/app.js 新增方法

/**
 * 导入 .ora 文件
 */
async importSession() {
  try {
    // 打开文件选择对话框
    const result = await window.electronAPI?.dialogOpen?.({
      title: '导入会话',
      filters: [{ name: 'Memora 会话', extensions: ['ora'] }],
    });
    
    if (!result?.success || !result.filePath) return;
    
    // 调用主进程解析
    const importResult = await window.electronAPI?.sessionImport?.({ filePath: result.filePath });
    
    if (!importResult?.success) {
      this._showToast('导入失败: ' + (importResult?.error || '未知错误'), 'error');
      return;
    }
    
    const { sessionData, tempDir } = importResult;
    
    // 创建新会话
    const newSession = {
      id: sessionData.sessionId + '_imported_' + Date.now(),
      title: sessionData.title,
      messageCount: sessionData.messageCount || 0,
      createdAt: sessionData.createdAt,
      updatedAt: new Date().toISOString(),
      taskType: sessionData.taskType || 'chat',
      agentTypes: sessionData.agentTypes || [],
      imported: true, // 标记为导入的会话
      importedFrom: sessionData.memoraVersion,
      importedAt: new Date().toISOString(),
    };
    
    // 添加到会话列表
    this._chatSessions.unshift(newSession);
    this._saveChatSessions();
    
    // 保存消息 HTML
    if (sessionData.messagesHtml) {
      localStorage.setItem('memora_session_msg_' + newSession.id, sessionData.messagesHtml);
    }
    
    // 复制 artifacts 文件
    if (sessionData.artifacts && sessionData.artifacts.length > 0) {
      await this._copyImportedArtifacts(tempDir, sessionData.artifacts);
    }
    
    // 清理临时目录
    fs.rmSync(tempDir, { recursive: true, force: true });
    
    // 切换到新导入的会话
    this._activeSessionId = newSession.id;
    this._renderChatSessionList();
    this._restoreSessionMessages(newSession.id);
    
    this._showToast(`已导入会话: ${sessionData.title}`, 'success');
  } catch (err) {
    console.error('[SessionImport] Error:', err);
    this._showToast('导入异常: ' + err.message, 'error');
  }
}

/**
 * 复制导入的 artifacts 文件
 */
async _copyImportedArtifacts(tempDir, artifacts) {
  const basePath = await window.electronAPI?.artifactsGetBasePath?.();
  if (!basePath?.path) return;
  
  const today = new Date().toISOString().split('T')[0];
  const destDir = path.join(basePath.path, today);
  fs.mkdirSync(destDir, { recursive: true });
  
  for (const artifact of artifacts) {
    const srcPath = path.join(tempDir, 'artifacts', artifact.relativePath);
    if (fs.existsSync(srcPath)) {
      // 添加导入标记避免冲突
      const destFileName = `[导入]${artifact.fileName}`;
      const destPath = path.join(destDir, destFileName);
      fs.copyFileSync(srcPath, destPath);
      console.log('[SessionImport] Copied artifact:', destFileName);
    }
  }
}
```

### 2.4 UI 交互设计

#### 2.4.1 会话列表操作按钮

```
┌─────────────────────────────────────────────────────────┐
│ 🤖 ADP 智能体调试                    [⋮] [📌] [📤] [×] │
│    并行 · 2                                              │
└─────────────────────────────────────────────────────────┘
     ↑      ↑    ↑
   更多  置顶  导出
```

**按钮说明**：
- `⋮` (更多): 下拉菜单，包含"导出"、"复制链接"、"删除"等
- `📌` (置顶): 点击切换置顶状态
- `📤` (导出): 导出为 .ora 文件
- `×` (删除): 删除会话

#### 2.4.2 导出进度提示

```
📤 正在导出会话...
   ✓ 收集会话数据
   ✓ 收集关联文件 (3/5)
   ⏳ 打包压缩...
```

### 2.5 依赖安装

```bash
npm install archiver --save
```

---

## 三、会话置顶功能

### 3.1 数据结构设计

```javascript
// 会话对象新增字段
{
  id: "chat_1719264000000_abc123",
  title: "ADP 智能体调试",
  // ... 其他字段
  
  // 新增：置顶相关字段
  pinned: true,           // 是否置顶
  pinnedAt: "2026-06-24T15:00:00.000Z",  // 置顶时间（用于排序）
}
```

### 3.2 会话列表渲染逻辑

```javascript
/**
 * 渲染会话列表（支持置顶）
 */
_renderChatSessionList(keyword) {
  const listEl = document.getElementById('chatSessionList');
  if (!listEl) return;

  if (this._chatSessions.length === 0) {
    listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-tertiary); font-size: 12px;">暂无对话</div>';
    return;
  }

  // 1. 搜索过滤
  let sorted = [...this._chatSessions];
  if (keyword && keyword.trim()) {
    const kw = keyword.trim().toLowerCase();
    sorted = sorted.filter(session => {
      const title = (session.title || '新对话').toLowerCase();
      const msgHtml = localStorage.getItem('memora_session_msg_' + session.id) || '';
      return title.includes(kw) || msgHtml.toLowerCase().includes(kw);
    });
  }

  // 2. 分离置顶和普通会话
  const pinnedSessions = sorted.filter(s => s.pinned).sort((a, b) => 
    new Date(b.pinnedAt || b.createdAt) - new Date(a.pinnedAt || a.createdAt)
  );
  const normalSessions = sorted.filter(s => !s.pinned).sort((a, b) =>
    new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
  );

  // 3. 渲染
  let html = '';
  
  // 置顶区域
  if (pinnedSessions.length > 0) {
    html += this._renderPinnedSection(pinnedSessions);
  }
  
  // 普通会话区域
  if (normalSessions.length > 0) {
    html += normalSessions.map(session => this._renderSessionItem(session)).join('');
  }
  
  listEl.innerHTML = html;
}

/**
 * 渲染置顶区域
 */
_renderPinnedSection(pinnedSessions) {
  const maxVisible = 5;
  const hasMore = pinnedSessions.length > maxVisible;
  const visibleSessions = pinnedSessions.slice(0, maxVisible);
  const hiddenSessions = pinnedSessions.slice(maxVisible);
  
  let html = `
    <div class="chat-session-pinned-section">
      <div class="pinned-header">
        <span class="pinned-title">📌 置顶 (${pinnedSessions.length})</span>
        ${hasMore ? `<button class="pinned-toggle" data-action="expand">展开全部</button>` : ''}
      </div>
      <div class="pinned-list ${hasMore ? 'collapsed' : ''}">
        ${visibleSessions.map(session => this._renderSessionItem(session)).join('')}
        ${hasMore ? `
          <div class="pinned-collapsed">
            <div class="pinned-collapsed-count">还有 ${hiddenSessions.length} 个置顶会话</div>
            <button class="pinned-toggle" data-action="expand">展开查看</button>
          </div>
        ` : ''}
      </div>
    </div>
  `;
  
  return html;
}

/**
 * 渲染单个会话项
 */
_renderSessionItem(session) {
  const taskType = session.taskType || (session.isGroupChat ? 'group' : 'chat');
  const agentTypes = session.agentTypes || [];
  
  // Agent 类型图标映射
  const agentIconMap = {
    cc: '🤖',
    adp: '🤖',
    agent: '🤖',
    llm: '🤖',
  };
  
  let icon, badge;
  
  switch (taskType) {
    case 'scheduled':
      icon = '⏰';
      badge = '<span class="chat-session-type-badge scheduled">定时</span>';
      break;
    case 'group':
      icon = '👥';
      badge = '<span class="chat-session-type-badge group">群聊</span>';
      break;
    case 'parallel':
      if (agentTypes.length > 0) {
        const agentIcons = agentTypes.slice(0, 3).map(mode => agentIconMap[mode] || '🤖').join(' ');
        icon = agentIcons;
        badge = `<span class="chat-session-type-badge parallel">并行 · ${agentTypes.length}</span>`;
      } else {
        icon = '⚡';
        badge = '<span class="chat-session-type-badge parallel">并行</span>';
      }
      break;
    default:
      icon = '💬';
      badge = '';
  }
  
  // 置顶图标
  const pinnedIcon = session.pinned ? '📌' : '';
  
  return `
    <div class="chat-session-item${session.id === this._activeSessionId ? ' active' : ''}${session.pinned ? ' pinned' : ''}" data-session-id="${session.id}">
      <span class="chat-session-pinned-indicator">${pinnedIcon}</span>
      <span class="chat-session-type-icon">${icon}</span>
      <span class="chat-session-title">${this.escapeHtml(session.title || '新对话')}</span>
      ${badge}
      <button class="chat-session-pin-btn" data-session-id="${session.id}" title="${session.pinned ? '取消置顶' : '置顶'}" data-pinned="${session.pinned}">${session.pinned ? '📍' : '📌'}</button>
      <button class="chat-session-export-btn" data-session-id="${session.id}" title="导出">📤</button>
      <button class="chat-session-more-btn" data-session-id="${session.id}" title="更多">⋮</button>
      <button class="chat-session-delete" data-session-id="${session.id}" title="删除对话">×</button>
    </div>
  `;
}
```

### 3.3 置顶/取消置顶交互

```javascript
/**
 * 切换会话置顶状态
 */
async _toggleSessionPin(sessionId) {
  const session = this._chatSessions.find(s => s.id === sessionId);
  if (!session) return;
  
  session.pinned = !session.pinned;
  session.pinnedAt = session.pinned ? new Date().toISOString() : null;
  session.updatedAt = new Date().toISOString();
  
  this._saveChatSessions();
  this._renderChatSessionList();
  
  this._showToast(session.pinned ? '已置顶会话' : '已取消置顶', 'success');
}

// 绑定置顶按钮事件
document.addEventListener('click', async (e) => {
  const pinBtn = e.target.closest('.chat-session-pin-btn');
  if (pinBtn) {
    e.stopPropagation();
    await this._toggleSessionPin(pinBtn.dataset.sessionId);
  }
  
  // 展开/折叠置顶区域
  const toggleBtn = e.target.closest('.pinned-toggle');
  if (toggleBtn) {
    e.stopPropagation();
    const action = toggleBtn.dataset.action;
    const list = toggleBtn.closest('.pinned-list');
    if (list) {
      if (action === 'expand') {
        list.classList.remove('collapsed');
        toggleBtn.textContent = '收起';
        toggleBtn.dataset.action = 'collapse';
      } else {
        list.classList.add('collapsed');
        toggleBtn.textContent = '展开全部';
        toggleBtn.dataset.action = 'expand';
      }
    }
  }
});
```

### 3.4 CSS 样式

```css
/* 置顶区域样式 */
.chat-session-pinned-section {
  border-bottom: 0.5px solid var(--border-light, rgba(0,0,0,0.08));
  margin-bottom: 8px;
  background: linear-gradient(180deg, rgba(0, 122, 255, 0.04) 0%, transparent 100%);
  padding: 4px 0;
}

.pinned-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-secondary, #86868b);
}

.pinned-title {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pinned-toggle {
  font-size: 11px;
  color: var(--accent-blue, #007AFF);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background 0.2s;
}

.pinned-toggle:hover {
  background: rgba(0, 122, 255, 0.1);
}

.pinned-list {
  overflow: hidden;
  transition: max-height 0.3s ease;
}

.pinned-list.collapsed {
  max-height: 200px;
}

.pinned-collapsed {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--bg-secondary, #f5f5f7);
  border-radius: 8px;
  margin: 4px 12px;
}

.pinned-collapsed-count {
  font-size: 12px;
  color: var(--text-tertiary, #86868b);
}

/* 置顶会话项样式 */
.chat-session-item.pinned {
  background: var(--bg-secondary, #f5f5f7);
  margin: 2px 8px;
  border-radius: 10px;
}

.chat-session-pinned-indicator {
  color: var(--accent-orange, #FF9500);
  font-size: 10px;
  margin-right: 4px;
}

.chat-session-pin-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-tertiary, #86868b);
  padding: 4px 6px;
  border-radius: 4px;
  transition: all 0.2s;
  opacity: 0;
}

.chat-session-item:hover .chat-session-pin-btn {
  opacity: 1;
}

.chat-session-pin-btn:hover {
  background: rgba(0, 122, 255, 0.1);
  color: var(--accent-blue, #007AFF);
}

.chat-session-item.pinned .chat-session-pin-btn {
  opacity: 1;
}
```

---

## 四、文件关联

### 4.1 需要修改的文件

| 文件 | 修改内容 |
|------|----------|
| `src/scripts/app.js` | 导出/导入方法、置顶逻辑、渲染函数 |
| `src/styles/components.css` | 置顶区域样式 |
| `src/styles/expert.css` | 置顶徽章样式 |
| `main.js` | IPC handler（导出/导入）、ZIP 操作 |
| `package.json` | 添加 `archiver` 依赖 |

### 4.2 新增 IPC 通道

| 通道 | 方向 | 说明 |
|------|------|------|
| `session:export` | render → main | 导出会话为 .ora |
| `session:import` | render → main | 解压 .ora 文件 |
| `dialog:open` | render → main | 打开文件选择对话框 |

---

## 五、可行性评估

### 5.1 会话分享功能

| 项目 | 评估 | 说明 |
|------|------|------|
| 技术可行性 | ✅ 高 | Node.js 原生支持 ZIP 操作 |
| 实现复杂度 | 中等 | 需处理 artifacts 文件关联 |
| 用户体验 | ✅ 好 | .ora 扩展名有品牌识别度 |
| 跨平台 | ✅ 支持 | archiver 库跨平台兼容 |
| 文件大小 | ⚠️ 注意 | 大量 artifacts 可能很大 |

### 5.2 置顶功能

| 项目 | 评估 | 说明 |
|------|------|------|
| 技术可行性 | ✅ 高 | 纯前端实现，无复杂依赖 |
| 实现复杂度 | 低 | 数据结构简单 |
| 用户体验 | ✅ 好 | 折叠机制避免列表过长 |
| 性能影响 | ✅ 无 | 仅影响列表渲染 |

---

## 六、开发计划

### Phase 1: 核心功能（预计 2 天）

- [ ] 会话数据收集与解析
- [ ] ZIP 打包与解压
- [ ] 导出功能 UI 与交互
- [ ] 置顶数据结构与渲染

### Phase 2: 完善体验（预计 1 天）

- [ ] 导入功能与 artifacts 复制
- [ ] 置顶区域折叠交互
- [ ] CSS 样式完善
- [ ] 错误处理与提示

### Phase 3: 优化（预计 1 天）

- [ ] 大文件导出进度提示
- [ ] 导出历史记录
- [ ] 置顶会话右键菜单
- [ ] 性能优化

---

## 七、风险与注意事项

1. **文件大小限制**: 单个 .ora 文件建议不超过 100MB，超过时提示用户
2. **Artifacts 关联**: 导出时只包含会话更新时间前 7 天内的 artifacts
3. **导入冲突**: 导入时会话 ID 添加时间戳后缀避免冲突
4. **版本兼容**: session.json 包含 formatVersion，便于未来升级

---

**文档版本**: v1.0  
**最后更新**: 2026-06-25
