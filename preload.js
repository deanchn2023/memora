const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  estimateDuration: (task) => ipcRenderer.invoke('estimate-duration', task),
  addToCalendar: (task) => ipcRenderer.invoke('add-to-calendar', task),
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', title, body),
  getClipboardText: () => ipcRenderer.invoke('get-clipboard-text'),
  
  // AI统计和配置
  getAIStats: () => ipcRenderer.invoke('get-ai-stats'),
  setAIDailyLimit: (limit) => ipcRenderer.invoke('set-ai-daily-limit', limit),
  getAIPrompt: () => ipcRenderer.invoke('get-ai-prompt'),
  setAIPrompt: (prompt) => ipcRenderer.invoke('set-ai-prompt', prompt),
  resetAIPrompt: () => ipcRenderer.invoke('reset-ai-prompt'),
  
  // API配置
  getAPIConfig: () => ipcRenderer.invoke('get-api-config'),
  setAPIConfig: (config) => ipcRenderer.invoke('set-api-config', config),
  clearAPIKey: () => ipcRenderer.invoke('clear-api-key'),
  
  // ADP配置
  getADPConfig: () => ipcRenderer.invoke('get-adp-config'),
  setADPConfig: (config) => ipcRenderer.invoke('set-adp-config', config),
  sendADPMessage: (message) => ipcRenderer.invoke('send-adp-message', message),
  clearADPConfig: () => ipcRenderer.invoke('clear-adp-config'),

  // v2.0 认证与远程配置
  authLogin: (email, password) => ipcRenderer.invoke('auth:login', { email, password }),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  authGetState: () => ipcRenderer.invoke('auth:get-state'),
  configSync: () => ipcRenderer.invoke('config:sync'),
  onAuthChanged: (callback) => {
    ipcRenderer.on('auth:changed', (_, data) => callback(data));
  },

  // 知识跟随
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  knowledgeSearchADP: (params) => ipcRenderer.invoke('knowledge:search-adp', params),
  knowledgeStopADP: () => ipcRenderer.invoke('knowledge:stop-adp'),
  knowledgeSearchLocal: (params) => ipcRenderer.invoke('knowledge:search-local', params),
  knowledgeSaveItem: (item) => ipcRenderer.invoke('knowledge:save-item', item),
  knowledgeDeleteItem: (params) => ipcRenderer.invoke('knowledge:delete-item', params),
  knowledgeGetRecommendations: (params) => ipcRenderer.invoke('knowledge:get-recommendations', params),
  knowledgeGetHistory: (params) => ipcRenderer.invoke('knowledge:get-history', params),
  knowledgeClassifyIntent: (params) => ipcRenderer.invoke('knowledge:classify-intent', params),
  knowledgeGetDeviceFingerprint: () => ipcRenderer.invoke('knowledge:get-device-fingerprint'),
  onKnowledgeADPChunk: (callback) => {
    ipcRenderer.on('knowledge:adp-chunk', (event, data) => callback(data));
  },
  onKnowledgeRecommendation: (callback) => {
    ipcRenderer.on('knowledge:recommendation-new', (event, data) => callback(data));
  },
  
  // 记忆系统
  getMemories: (options) => ipcRenderer.invoke('get-memories', options),
  addMemory: (memory) => ipcRenderer.invoke('add-memory', memory),
  updateMemory: (id, updates) => ipcRenderer.invoke('update-memory', id, updates),
  deleteMemory: (id) => ipcRenderer.invoke('delete-memory', id),
  clearAllMemories: () => ipcRenderer.invoke('clear-all-memories'),
  getMemoryStats: () => ipcRenderer.invoke('get-memory-stats'),
  getEntityGraph: () => ipcRenderer.invoke('get-entity-graph'),
  searchRelatedMemories: (content) => ipcRenderer.invoke('search-related-memories', content),
  getMemoryPrompt: () => ipcRenderer.invoke('get-memory-prompt'),
  setMemoryPrompt: (prompt) => ipcRenderer.invoke('set-memory-prompt', prompt),
  resetMemoryPrompt: () => ipcRenderer.invoke('reset-memory-prompt'),
  extractMemory: (content) => ipcRenderer.invoke('extract-memory', content),
  analyzeTask: (text) => ipcRenderer.invoke('analyze-task', text),
  analyzeClipboard: (text) => ipcRenderer.invoke('analyze-clipboard', text),
  optimizeClipboardPrompt: (feedback) => ipcRenderer.invoke('optimize-clipboard-prompt', feedback),
  
  // 记事本系统
  notebookAddNote: (note) => ipcRenderer.invoke('notebook-add-note', note),
  notebookSearch: (query) => ipcRenderer.invoke('notebook-search', query),
  notebookGetNotes: (category) => ipcRenderer.invoke('notebook-get-notes', category),
  notebookGetNote: (id) => ipcRenderer.invoke('notebook-get-note', id),
  notebookUpdateNote: (id, updates) => ipcRenderer.invoke('notebook-update-note', id, updates),
  notebookDeleteNote: (id, reason) => ipcRenderer.invoke('notebook-delete-note', id, reason),
  notebookDeleteNotesByCategory: (category) => ipcRenderer.invoke('notebook-delete-notes-by-category', category),
  notebookGetStats: () => ipcRenderer.invoke('notebook-get-stats'),
  notebookGetCategories: () => ipcRenderer.invoke('notebook-get-categories'),
  notebookSaveCategories: (categories) => ipcRenderer.invoke('notebook-save-categories', categories),
  
  // 反馈系统（用于持续优化）
  recordFeedback: (feedback) => ipcRenderer.invoke('record-feedback', feedback),
  optimizePrompts: () => ipcRenderer.invoke('optimize-prompts'),
  
  // v1.1 Feedback 系统
  feedback: {
    newTraceId: () => ipcRenderer.invoke('ai:newTraceId'),
    recordTrace: (trace) => ipcRenderer.invoke('ai:recordTrace', trace),
    record: (feedback) => ipcRenderer.invoke('feedback:record', feedback),
    query: (options) => ipcRenderer.invoke('feedback:query', options),
    accept: (traceId, finalOutput) =>
      ipcRenderer.invoke('feedback:record', { trace_id: traceId, action: 'accept', user_final: finalOutput }),
    reject: (traceId, reason) =>
      ipcRenderer.invoke('feedback:record', { trace_id: traceId, action: 'reject', reason }),
    edit: (traceId, before, after, reason) =>
      ipcRenderer.invoke('feedback:record', { trace_id: traceId, action: 'edit', ai_output: before, user_final: after, reason }),
  },

  // v1.1 Profile 系统
  profile: {
    get: () => ipcRenderer.invoke('profile:get'),
    update: (updates) => ipcRenderer.invoke('profile:update', updates),
  },

  // v1.1 Agent 智能助手
  agent: {
    invoke: (query, agentType, attachments) => ipcRenderer.invoke('agent:invoke', { query, agentType, attachments }),
  },

  // v1.2 Phase 3: Prompt 优化器 + 历史记录
  optimizer: {
    listCandidates: () => ipcRenderer.invoke('optimizer:list-candidates'),
    applyCandidate: (filename) => ipcRenderer.invoke('optimizer:apply-candidate', filename),
    run: (options) => ipcRenderer.invoke('optimizer:run', options),
    history: () => ipcRenderer.invoke('optimizer:history'),
    readReport: (filename) => ipcRenderer.invoke('optimizer:read-report', filename),
    readCandidate: (filename) => ipcRenderer.invoke('optimizer:read-candidate', filename),
    applyToMain: (filename) => ipcRenderer.invoke('optimizer:apply-to-main', filename),
  },

  // Prompt 文件管理
  promptFiles: {
    list: () => ipcRenderer.invoke('prompt:list-files'),
    read: (filename) => ipcRenderer.invoke('prompt:read-file', filename),
    write: (filename, content) => ipcRenderer.invoke('prompt:write-file', filename, content),
    reset: (filename) => ipcRenderer.invoke('prompt:reset-file', filename),
    download: (filename) => ipcRenderer.invoke('prompt:download-file', filename),
    upload: (filename, content) => ipcRenderer.invoke('prompt:upload-file', filename, content),
    getVariables: (filename) => ipcRenderer.invoke('prompt:get-variables', filename),
    listBackups: (filename) => ipcRenderer.invoke('prompt:list-backups', filename),
    restoreBackup: (filename, backupFilename) => ipcRenderer.invoke('prompt:restore-backup', filename, backupFilename),
    resetToBuiltin: (filename) => ipcRenderer.invoke('prompt:reset-to-builtin', filename),
  },

  // v1.2 Phase 3: 用户画像建议
  profileSuggestions: () => ipcRenderer.invoke('profile:suggestions'),
  
  // 剪切板去重管理
  clearClipboardHashes: () => ipcRenderer.invoke('clear-clipboard-hashes'),
  getClipboardHashCount: () => ipcRenderer.invoke('get-clipboard-hash-count'),
  
  // 事件监听
  onClipboardTaskDetected: (callback) => {
    ipcRenderer.on('clipboard-task-detected', (event, data) => callback(data));
  },
  
  onStartPomodoro: (callback) => {
    ipcRenderer.on('start-pomodoro', () => callback());
  },
  
  onNewNoteAdded: (callback) => {
    ipcRenderer.on('new-note-added', (event, data) => callback(data));
  },
  
  // 窗口控制
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  
  // 数据库操作
  dbGetTasks: () => ipcRenderer.invoke('db-get-tasks'),
  dbSaveTasks: (tasks) => ipcRenderer.invoke('db-save-tasks', tasks),
  dbGetStats: () => ipcRenderer.invoke('db-get-stats'),
  dbCreateBackup: () => ipcRenderer.invoke('db-create-backup'),
  dbListBackups: () => ipcRenderer.invoke('db-list-backups'),
  dbRestoreBackup: (backupPath) => ipcRenderer.invoke('db-restore-backup', backupPath),
  dbExportData: () => ipcRenderer.invoke('db-export-data'),
  dbImportData: (jsonString) => ipcRenderer.invoke('db-import-data', jsonString),
  
  // 多窗口
  openChildWindow: (type) => ipcRenderer.invoke('open-child-window', type),
  
  // i18n
  i18nGetLocale: () => ipcRenderer.invoke('i18n-get-locale'),
  i18nSetLocale: (locale) => ipcRenderer.invoke('i18n-set-locale', locale),
  i18nGetTranslations: () => ipcRenderer.invoke('i18n-get-translations'),
  i18nT: (key, params) => ipcRenderer.invoke('i18n-t', key, params)
});