/**
 * 本地文件模块 - 浏览和搜索本地文件
 */

const LocalFiles = {
  currentDirectory: 'all',
  currentTimeRange: 'all',
  currentFileType: 'all',
  keyword: '',
  page: 1,
  pageSize: 50,
  total: 0,
  hasMore: false,
  files: [],
  isLoading: false,
  initialized: false,
  indexBuilt: false,
  customDirs: [], // 自定义文件夹列表 [{ key, path, name }]

  DIRECTORY_MAP: {
    all: { label: '📂 全部', icon: '📂' },
    desktop: { label: '🖥 桌面', icon: '🖥' },
    downloads: { label: '📥 下载', icon: '📥' },
    documents: { label: '📝 文档', icon: '📝' },
    pictures: { label: '🖼 图片', icon: '🖼' },
    movies: { label: '🎬 影片', icon: '🎬' },
    home: { label: '🏠 主目录', icon: '🏠' },
  },

  FILE_TYPE_OPTIONS: [
    { value: 'all', label: '全部', icon: '📂' },
    { value: 'document', label: '文档', icon: '📄' },
    { value: 'spreadsheet', label: '表格', icon: '📊' },
    { value: 'presentation', label: '演示', icon: '📑' },
    { value: 'image', label: '图片', icon: '🖼' },
    { value: 'video', label: '影片', icon: '🎬' },
    { value: 'code', label: '代码', icon: '💻' },
    { value: 'archive', label: '压缩包', icon: '📦' },
    { value: 'audio', label: '音频', icon: '🎵' },
  ],

  FILE_TYPE_ICONS: {
    document: '📄', spreadsheet: '📊', presentation: '📑',
    image: '🖼', video: '🎬', code: '💻', archive: '📦',
    audio: '🎵', other: '📎'
  },

  init() {
    if (this.initialized) return;
    this.initialized = true;
    this._bindEvents();
    this._loadCustomDirs();
  },

  _bindEvents() {
    // 目录标签切换
    const dirTabs = document.getElementById('localDirTabs');
    if (dirTabs) {
      dirTabs.addEventListener('click', (e) => {
        // 添加自定义文件夹按钮
        const addBtn = e.target.closest('.local-dir-tab-add');
        if (addBtn) {
          e.stopPropagation();
          this._selectCustomDir();
          return;
        }

        const tab = e.target.closest('.local-dir-tab');
        if (!tab) return;

        // 删除自定义文件夹
        const removeBtn = e.target.closest('.local-dir-remove');
        if (removeBtn) {
          e.stopPropagation();
          const dirKey = removeBtn.dataset.dirKey;
          if (dirKey) this._removeCustomDir(dirKey);
          return;
        }

        dirTabs.querySelectorAll('.local-dir-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.currentDirectory = tab.dataset.dir;
        this.page = 1;
        this.searchFiles();
      });
    }

    // 文件类型筛选（作为标签过滤）
    const typeTabs = document.getElementById('localTypeTabs');
    if (typeTabs) {
      typeTabs.addEventListener('click', (e) => {
        const tab = e.target.closest('.local-type-tab');
        if (!tab) return;
        typeTabs.querySelectorAll('.local-type-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.currentFileType = tab.dataset.type;
        this.page = 1;
        this.searchFiles();
      });
    }

    // 刷新索引
    const refreshBtn = document.getElementById('localRefreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.buildIndex(true));
    }

    // 加载更多
    const loadMoreBtn = document.getElementById('localLoadMoreBtn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        this.page++;
        this.searchFiles(false);
      });
    }

    // 滚动加载
    const body = document.getElementById('localFilesBody');
    if (body) {
      body.addEventListener('scroll', () => {
        if (this.isLoading || !this.hasMore) return;
        const { scrollTop, scrollHeight, clientHeight } = body;
        if (scrollHeight - scrollTop - clientHeight < 100) {
          this.page++;
          this.searchFiles(false);
        }
      });
    }
  },

  /**
   * 从外部搜索（统一搜索入口）
   */
  searchFromExternal(keyword) {
    this.init();
    this.keyword = keyword || '';
    this.currentFileType = 'all';
    this.currentDirectory = 'all';
    this.page = 1;

    // 重置 UI 选中状态
    const dirTabs = document.getElementById('localDirTabs');
    if (dirTabs) {
      dirTabs.querySelectorAll('.local-dir-tab').forEach(t => t.classList.remove('active'));
      dirTabs.querySelector('[data-dir="all"]')?.classList.add('active');
    }
    const typeTabs = document.getElementById('localTypeTabs');
    if (typeTabs) {
      typeTabs.querySelectorAll('.local-type-tab').forEach(t => t.classList.remove('active'));
      typeTabs.querySelector('[data-type="all"]')?.classList.add('active');
    }

    // 显示本地文件容器
    const localContainer = document.getElementById('localFilesContainer');
    if (localContainer) localContainer.classList.remove('hidden');

    if (this.indexBuilt) {
      this.searchFiles();
    } else {
      // 索引未建立，先建索引再搜索
      this.buildIndex(true);
    }
  },

  async onShow() {
    this.init();
    if (!this.indexBuilt) {
      await this.buildIndex(false);
    } else {
      this.searchFiles();
    }
  },

  async buildIndex(forceRebuild = false) {
    const statusEl = document.getElementById('localIndexStatus');
    const refreshBtn = document.getElementById('localRefreshBtn');

    if (refreshBtn) refreshBtn.disabled = true;
    if (statusEl) statusEl.innerHTML = '<span class="local-index-building">🔄 正在建立索引...</span>';

    try {
      const result = await window.electronAPI.localFilesIndex({
        directories: [
          ...Object.keys(this.DIRECTORY_MAP).filter(k => k !== 'all'),
          ...this.customDirs.map(d => d.key)
        ],
        forceRebuild
      });

      if (result.success) {
        this.indexBuilt = true;
        this._updateIndexStatus(result);
        this.searchFiles();
      } else {
        if (statusEl) statusEl.innerHTML = `<span class="local-index-error">❌ 索引失败${result.error ? ': ' + result.error : ''}</span>`;
      }
    } catch (e) {
      console.error('[LocalFiles] Index error:', e);
      if (statusEl) statusEl.innerHTML = `<span class="local-index-error">❌ 索引失败: ${e.message || e}</span>`;
    } finally {
      if (refreshBtn) refreshBtn.disabled = false;
    }
  },

  async searchFiles(resetList = true) {
    if (this.isLoading) return;
    this.isLoading = true;

    const grid = document.getElementById('localFilesGrid');
    const loadingEl = document.getElementById('localFilesLoading');
    const emptyEl = document.getElementById('localFilesEmpty');

    if (resetList) {
      if (loadingEl) loadingEl.style.display = 'flex';
      if (grid) grid.innerHTML = '';
      this.files = [];
    }

    try {
      const directory = this.currentDirectory === 'all' ? 'all' : this.currentDirectory;
      const result = await window.electronAPI.localFilesSearch({
        keyword: this.keyword,
        directory: directory,
        timeRange: this.currentTimeRange,
        fileType: this.currentFileType,
        page: this.page,
        pageSize: this.pageSize
      });

      if (result.success) {
        this.total = result.total;
        this.hasMore = result.hasMore;
        if (resetList) {
          this.files = result.files;
        } else {
          this.files = this.files.concat(result.files);
        }
        this.renderFileList();
      }
    } catch (e) {
      console.error('[LocalFiles] Search error:', e);
    } finally {
      this.isLoading = false;
      if (loadingEl) loadingEl.style.display = 'none';
    }
  },

  renderFileList() {
    const grid = document.getElementById('localFilesGrid');
    const emptyEl = document.getElementById('localFilesEmpty');
    const loadMoreBtn = document.getElementById('localLoadMoreBtn');

    if (!grid) return;

    if (this.files.length === 0) {
      grid.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'flex';
      if (loadMoreBtn) loadMoreBtn.style.display = 'none';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    grid.innerHTML = this.files.map(f => this._renderFileCard(f)).join('');
    if (loadMoreBtn) loadMoreBtn.style.display = this.hasMore ? 'block' : 'none';

    this._bindCardEvents(grid);
    this._updateIndexStatus();
  },

  _bindCardEvents(grid) {
    // 单击复制路径
    grid.querySelectorAll('.local-file-card').forEach(card => {
      card.addEventListener('click', () => {
        this._copyPath(card.dataset.path);
      });
      // 双击打开文件
      card.addEventListener('dblclick', () => {
        window.electronAPI?.localFilesOpen(card.dataset.path);
      });
    });

    // 复制路径按钮
    grid.querySelectorAll('.local-file-copy-path').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._copyPath(btn.dataset.path);
      });
    });

    // 在 Finder 中显示按钮
    grid.querySelectorAll('.local-file-reveal').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const filePath = btn.dataset.path;
        window.electronAPI?.localFilesReveal(filePath);
      });
    });
  },

  async _copyPath(filePath) {
    try {
      await window.electronAPI?.writeClipboardText(filePath);
      this._showToast('已复制路径');
    } catch (e) {
      // fallback
      try {
        await navigator.clipboard.writeText(filePath);
        this._showToast('已复制路径');
      } catch {
        this._showToast('复制失败');
      }
    }
  },

  _showToast(msg) {
    let toast = document.getElementById('localFileToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'localFileToast';
      toast.className = 'local-file-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('show'), 1500);
  },

  _renderFileCard(file) {
    const typeIcon = this.FILE_TYPE_ICONS[file.type] || '📎';
    const size = this._formatSize(file.size);
    // 自定义目录显示文件夹名，预设目录显示标签名
    let dirLabel = this.DIRECTORY_MAP[file.directory]?.label || '';
    if (!dirLabel && file.directory?.startsWith('custom:')) {
      const customDir = this.customDirs.find(d => d.key === file.directory);
      dirLabel = '📁 ' + (customDir?.name || file.directory.split('/').pop());
    }
    if (!dirLabel) dirLabel = file.directory;
    const createdTime = this._formatDateTime(file.createdAt);
    const modifiedTime = this._formatDateTime(file.modifiedAt);
    const modifiedAgo = this._timeAgo(file.modifiedAt);

    return `
      <div class="local-file-card" data-path="${this._escapeAttr(file.path)}" title="单击复制路径&#10;双击打开文件&#10;${this._escapeAttr(file.path)}">
        <div class="local-file-icon">${typeIcon}</div>
        <div class="local-file-body">
          <div class="local-file-name">${this._escapeHtml(file.name)}</div>
          <div class="local-file-meta">
            <span class="local-file-type">${this._getTypeLabel(file.type)}</span>
            <span class="local-file-size">${size}</span>
            <span class="local-file-dir">${dirLabel}</span>
          </div>
          <div class="local-file-times">
            <span class="local-file-time" title="创建时间: ${createdTime}">创建: ${this._timeAgo(file.createdAt)}</span>
            <span class="local-file-time" title="修改时间: ${modifiedTime}">修改: ${modifiedAgo}</span>
          </div>
        </div>
        <div class="local-file-actions">
          <button class="local-file-copy-path" data-path="${this._escapeAttr(file.path)}" title="复制路径">📋</button>
          <button class="local-file-reveal" data-path="${this._escapeAttr(file.path)}" title="在 Finder 中显示">📂</button>
        </div>
      </div>`;
  },

  _getTypeLabel(type) {
    const map = {
      document: '文档', spreadsheet: '表格', presentation: '演示',
      image: '图片', video: '影片', code: '代码', archive: '压缩包',
      audio: '音频', other: '其他'
    };
    return map[type] || '其他';
  },

  _formatSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'GB';
  },

  _formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${h}:${min}`;
  },

  _timeAgo(dateStr) {
    if (!dateStr) return '';
    const now = new Date();
    const date = new Date(dateStr);
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    if (days < 30) return `${Math.floor(days / 7)}周前`;
    if (days < 365) return `${Math.floor(days / 30)}月前`;
    return `${Math.floor(days / 365)}年前`;
  },

  _updateIndexStatus(indexResult) {
    const statusEl = document.getElementById('localIndexStatus');
    if (!statusEl) return;

    if (indexResult) {
      const count = indexResult.totalFiles || 0;
      const dirs = Object.entries(indexResult.directories || {})
        .map(([k, v]) => {
          let label = this.DIRECTORY_MAP[k]?.label;
          if (!label && k.startsWith('custom:')) {
            const customDir = this.customDirs.find(d => d.key === k);
            label = '📁 ' + (customDir?.name || k.split('/').pop());
          }
          return `${label || k}: ${v.fileCount}`;
        })
        .join(' · ');
      statusEl.innerHTML = `<span class="local-index-ok">📊 已索引 ${count.toLocaleString()} 个文件${dirs ? ' | ' + dirs : ''}</span>`;
    }
  },

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  _escapeAttr(text) {
    return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  // ========== 自定义文件夹 ==========

  /** 加载自定义文件夹列表并渲染标签 */
  async _loadCustomDirs() {
    try {
      const result = await window.electronAPI?.localFilesGetCustomDirs?.();
      if (result?.success && result.dirs) {
        this.customDirs = result.dirs;
        this._renderCustomDirTabs();
      }
    } catch (e) {
      console.error('[LocalFiles] Load custom dirs error:', e);
    }
  },

  /** 渲染自定义文件夹标签 */
  _renderCustomDirTabs() {
    const dirTabs = document.getElementById('localDirTabs');
    if (!dirTabs) return;

    // 移除旧的自定义标签
    dirTabs.querySelectorAll('.local-dir-tab-custom').forEach(el => el.remove());

    // 在 + 按钮前插入自定义标签
    const addBtn = document.getElementById('localAddDirBtn');
    this.customDirs.forEach(dir => {
      const tab = document.createElement('button');
      tab.className = 'local-dir-tab local-dir-tab-custom';
      tab.dataset.dir = dir.key;
      tab.innerHTML = `📁 ${this._escapeHtml(dir.name)}<span class="local-dir-remove" data-dir-key="${this._escapeAttr(dir.key)}" title="移除此文件夹">✕</span>`;
      if (addBtn) {
        dirTabs.insertBefore(tab, addBtn);
      } else {
        dirTabs.appendChild(tab);
      }
    });
  },

  /** 选择自定义文件夹 */
  async _selectCustomDir() {
    try {
      const result = await window.electronAPI?.localFilesSelectDirectory?.();
      if (!result?.success) {
        if (result?.canceled) return;
        this._showToast(result?.error || '选择文件夹失败');
        return;
      }

      const addResult = await window.electronAPI?.localFilesAddCustomDir?.({
        dirPath: result.path,
        dirName: result.name
      });

      if (addResult?.success) {
        this.customDirs.push(addResult.dir);
        this._renderCustomDirTabs();
        this._showToast(`已添加：${result.name}`);

        // 自动索引新目录并切换
        this.currentDirectory = addResult.dir.key;
        this.page = 1;

        // 激活新标签
        const dirTabs = document.getElementById('localDirTabs');
        if (dirTabs) {
          dirTabs.querySelectorAll('.local-dir-tab').forEach(t => t.classList.remove('active'));
          dirTabs.querySelector(`[data-dir="${CSS.escape(addResult.dir.key)}"]`)?.classList.add('active');
        }

        // 重建索引（包含新目录）
        await this.buildIndex(true);
      } else {
        this._showToast(addResult?.error || '添加失败');
      }
    } catch (e) {
      console.error('[LocalFiles] Select dir error:', e);
      this._showToast('选择文件夹出错');
    }
  },

  /** 删除自定义文件夹 */
  async _removeCustomDir(dirKey) {
    // dirKey 格式: custom:/abs/path
    const dirPath = dirKey.startsWith('custom:') ? dirKey.slice(7) : dirKey;
    const dir = this.customDirs.find(d => d.key === dirKey);
    const dirName = dir?.name || dirPath.split('/').pop() || dirPath;

    if (!confirm(`确定移除文件夹「${dirName}」吗？\n已索引的文件将从列表中移除。`)) return;

    try {
      const result = await window.electronAPI?.localFilesRemoveCustomDir?.({ dirPath });
      if (result?.success) {
        this.customDirs = this.customDirs.filter(d => d.key !== dirKey);
        this._renderCustomDirTabs();

        // 如果当前正在查看被删除的目录，切回全部
        if (this.currentDirectory === dirKey) {
          this.currentDirectory = 'all';
          this.page = 1;
          const dirTabs = document.getElementById('localDirTabs');
          if (dirTabs) {
            dirTabs.querySelectorAll('.local-dir-tab').forEach(t => t.classList.remove('active'));
            dirTabs.querySelector('[data-dir="all"]')?.classList.add('active');
          }
          this.searchFiles();
        }

        this._showToast(`已移除：${dirName}`);
      } else {
        this._showToast(result?.error || '移除失败');
      }
    } catch (e) {
      console.error('[LocalFiles] Remove dir error:', e);
      this._showToast('移除出错');
    }
  }
};

window.LocalFiles = LocalFiles;
