const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  estimateDuration: (task) => ipcRenderer.invoke('estimate-duration', task),
  addToCalendar: (task) => ipcRenderer.invoke('add-to-calendar', task),
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', title, body),
  getClipboardText: () => ipcRenderer.invoke('get-clipboard-text'),
  writeClipboardText: (text) => ipcRenderer.invoke('write-clipboard-text', text),
  
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
  
  // 全局 AI 模式控制（v2.3）
  getGlobalAIMode: () => ipcRenderer.invoke('get-global-ai-mode'),
  setGlobalAIMode: (mode) => ipcRenderer.invoke('set-global-ai-mode', mode),
  onGlobalAIModeChanged: (callback) => {
    ipcRenderer.on('global-ai-mode-changed', (event, mode) => callback(mode));
  },
  
  // ADP配置
  getADPConfig: () => ipcRenderer.invoke('get-adp-config'),
  setADPConfig: (config) => ipcRenderer.invoke('set-adp-config', config),
  sendADPMessage: (data) => ipcRenderer.invoke('send-adp-message', data),
  stopADPMessage: () => ipcRenderer.invoke('adp:stop-message'),
  newADPChat: () => ipcRenderer.invoke('adp:new-chat'),
  setADPConversationId: (convId) => ipcRenderer.invoke('adp:set-conversation-id', convId),
  clearADPConfig: () => ipcRenderer.invoke('clear-adp-config'),
  onADPSSEEvent: (callback) => {
    ipcRenderer.on('adp:sse-event', (event, data) => callback(data));
  },
  removeADPListeners: () => {
    ipcRenderer.removeAllListeners('adp:sse-event');
  },

  // v2.0 认证与远程配置
  authLogin: (email, password, env, rememberMe) => ipcRenderer.invoke('auth:login', { email, password, env, rememberMe }),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  authGetState: () => ipcRenderer.invoke('auth:get-state'),
  authGetServerUrls: () => ipcRenderer.invoke('auth:get-server-urls'),
  authSetServerUrls: (urls) => ipcRenderer.invoke('auth:set-server-urls', { urls }),
  authResetServerUrls: (env) => ipcRenderer.invoke('auth:reset-server-urls', { env }),
  configSync: () => ipcRenderer.invoke('config:sync'),
  configSetSource: (forceLocal) => ipcRenderer.invoke('config:set-source', { forceLocal }),
  configGetSource: () => ipcRenderer.invoke('config:get-source'),
  notificationsFetch: () => ipcRenderer.invoke('notifications:fetch'),
  notificationsUnreadCount: () => ipcRenderer.invoke('notifications:unread-count'),
  notificationsMarkRead: (id) => ipcRenderer.invoke('notifications:mark-read', id),
  notificationsMarkAllRead: () => ipcRenderer.invoke('notifications:mark-all-read'),
  updatesCheck: () => ipcRenderer.invoke('updates:check'),
  onAuthChanged: (callback) => {
    ipcRenderer.on('auth:changed', (_, data) => callback(data));
  },
  onConfigUpdated: (callback) => {
    ipcRenderer.on('config:updated', (_, data) => callback(data));
  },
  onNotificationsUpdated: (callback) => {
    ipcRenderer.on('notifications:updated', (_, data) => callback(data));
  },
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update:available', (_, data) => callback(data));
  },

  // 知识跟随
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  knowledgeSearchADP: (params) => ipcRenderer.invoke('knowledge:search-adp', params),
  knowledgeStopADP: () => ipcRenderer.invoke('knowledge:stop-adp'),
  knowledgeSearchLocal: (params) => ipcRenderer.invoke('knowledge:search-local', params),
  knowledgeExtractKeywords: (params) => ipcRenderer.invoke('knowledge:extract-keywords', params),
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
  
  // 知识萃取系统
  knowledgeGetAtoms: (filter) => ipcRenderer.invoke('knowledge:get-atoms', filter),
  knowledgeGetAtomById: (id) => ipcRenderer.invoke('knowledge:get-atom-by-id', id),
  knowledgeAddAtom: (atom) => ipcRenderer.invoke('knowledge:add-atom', atom),
  knowledgeDeleteAtom: (id) => ipcRenderer.invoke('knowledge:delete-atom', id),
  knowledgeUpdateAtom: (id, updates) => ipcRenderer.invoke('knowledge:update-atom', id, updates),
  knowledgeGetClusters: (filter) => ipcRenderer.invoke('knowledge:get-clusters', filter),
  knowledgeGetClusterById: (id) => ipcRenderer.invoke('knowledge:get-cluster-by-id', id),
  knowledgeCreateCluster: (cluster) => ipcRenderer.invoke('knowledge:create-cluster', cluster),
  knowledgeUpdateCluster: (id, updates) => ipcRenderer.invoke('knowledge:update-cluster', id, updates),
  knowledgeDeleteCluster: (id, atomAction) => ipcRenderer.invoke('knowledge:delete-cluster', id, atomAction),
  knowledgeClusterAtom: (atomId, clusterId) => ipcRenderer.invoke('knowledge:cluster-atom', atomId, clusterId),
  knowledgeAutoCluster: () => ipcRenderer.invoke('knowledge:auto-cluster'),
  knowledgeCancelClustering: () => ipcRenderer.invoke('knowledge:cancel-clustering'),
  knowledgeGetArticles: (filter) => ipcRenderer.invoke('knowledge:get-articles', filter),
  knowledgeGetArticle: (id) => ipcRenderer.invoke('knowledge:get-article', id),
  knowledgeGenerateArticle: (clusterId) => ipcRenderer.invoke('knowledge:generate-article', clusterId),
  knowledgeUpdateArticle: (id, updates) => ipcRenderer.invoke('knowledge:update-article', id, updates),
  knowledgeDeleteArticle: (id) => ipcRenderer.invoke('knowledge:delete-article', id),
  knowledgeGetStats: () => ipcRenderer.invoke('knowledge:get-stats'),
  knowledgeGetDomains: () => ipcRenderer.invoke('knowledge:get-domains'),
  knowledgeDistillAll: () => ipcRenderer.invoke('knowledge:distill-all'),
  knowledgeClusteringStats: () => ipcRenderer.invoke('knowledge:clustering-stats'),
  knowledgeExtractAtoms: (noteId) => ipcRenderer.invoke('knowledge:extract-atoms', noteId),
  onKnowledgeAtomsUpdated: (callback) => {
    ipcRenderer.on('knowledge:atoms-updated', (event, data) => callback(data));
  },
  onKnowledgeClustersUpdated: (callback) => {
    ipcRenderer.on('knowledge:clusters-updated', (event, data) => callback(data));
  },
  onKnowledgeClusteringProgress: (callback) => {
    ipcRenderer.on('knowledge:clustering-progress', (event, data) => callback(data));
  },
  removeKnowledgeClusteringProgressListeners: () => {
    ipcRenderer.removeAllListeners('knowledge:clustering-progress');
  },
  onKnowledgeClusteringComplete: (callback) => {
    ipcRenderer.on('knowledge:clustering-complete', (event, data) => callback(data));
  },
  removeKnowledgeClusteringCompleteListeners: () => {
    ipcRenderer.removeAllListeners('knowledge:clustering-complete');
  },
  onKnowledgeArticleGenerated: (callback) => {
    ipcRenderer.on('knowledge:article-generated', (event, data) => callback(data));
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
  aiOrganizeMemory: (content) => ipcRenderer.invoke('memory:ai-organize', content),
  aiBatchOrganizeMemories: () => ipcRenderer.invoke('memory:ai-batch-organize'),
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
  notebookExportMarkdown: (data) => ipcRenderer.invoke('notebook-export-markdown', data),
  
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
    importAI: (text) => ipcRenderer.invoke('profile:import-ai', text),
    importConfirm: (previewData) => ipcRenderer.invoke('profile:import-confirm', previewData),
  },

  // v1.1 Agent 智能助手
  agent: {
    invoke: (query, agentType, attachments) => ipcRenderer.invoke('agent:invoke', { query, agentType, attachments }),
    stop: () => ipcRenderer.invoke('agent:stop'),
  },
  onAgentStream: (callback) => {
    ipcRenderer.on('agent:stream', (event, data) => callback(data));
  },
  removeAgentListeners: () => {
    ipcRenderer.removeAllListeners('agent:stream');
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
  clipboardGetConfig: () => ipcRenderer.invoke('clipboard:get-config'),
  clipboardUpdateConfig: (config) => ipcRenderer.invoke('clipboard:update-config', config),
  clipboardDiagnostic: () => ipcRenderer.invoke('clipboard:diagnostic'),
  clipboardForceAnalyze: () => ipcRenderer.invoke('clipboard:force-analyze'),
  
  // AI 审计日志
  auditQuery: (options) => ipcRenderer.invoke('audit:query', options),
  auditModules: () => ipcRenderer.invoke('audit:modules'),
  auditDailyStats: (days) => ipcRenderer.invoke('audit:daily-stats', days),
  auditCleanup: () => ipcRenderer.invoke('audit:cleanup'),
  
  // 知识图谱
  graphBuild: (params) => ipcRenderer.invoke('graph:build', params),
  graphBuildLimit: () => ipcRenderer.invoke('graph:build-limit'),
  graphGetNodes: (filter) => ipcRenderer.invoke('graph:get-nodes', filter),
  graphGetEdges: (filter) => ipcRenderer.invoke('graph:get-edges', filter),
  graphSearch: (params) => ipcRenderer.invoke('graph:search', params),
  graphNeighbors: (params) => ipcRenderer.invoke('graph:neighbors', params),
  graphSubgraph: (params) => ipcRenderer.invoke('graph:subgraph', params),
  graphGapDetail: (params) => ipcRenderer.invoke('graph:gap-detail', params),
  graphConflictResolve: (params) => ipcRenderer.invoke('graph:conflict-resolve', params),
  graphConflictArbitrate: (params) => ipcRenderer.invoke('graph:conflict-arbitrate', params),
  graphHealthReport: () => ipcRenderer.invoke('graph:health-report'),
  graphOutdatedReview: (params) => ipcRenderer.invoke('graph:outdated-review', params),
  graphStats: () => ipcRenderer.invoke('graph:stats'),
  
  // 事件监听
  onClipboardLog: (callback) => {
    ipcRenderer.on('clipboard-log', (event, msg) => callback(msg));
  },
  onClipboardTaskDetected: (callback) => {
    ipcRenderer.on('clipboard-task-detected', (event, data) => callback(data));
  },
  onClipboardCandidateDetected: (callback) => {
    ipcRenderer.on('clipboard-candidate-detected', (event, data) => callback(data));
  },
  onClipboardBufferStatus: (callback) => {
    ipcRenderer.on('clipboard-buffer-status', (event, data) => callback(data));
  },
  onClipboardAssociationDetected: (callback) => {
    ipcRenderer.on('clipboard-association-detected', (event, data) => callback(data));
  },
  removeClipboardCandidateListeners: () => {
    ipcRenderer.removeAllListeners('clipboard-candidate-detected');
  },
  removeClipboardBufferStatusListeners: () => {
    ipcRenderer.removeAllListeners('clipboard-buffer-status');
  },
  removeClipboardAssociationListeners: () => {
    ipcRenderer.removeAllListeners('clipboard-association-detected');
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
  i18nT: (key, params) => ipcRenderer.invoke('i18n-t', key, params),

  // 本地文件索引
  localFilesIndex: (params) => ipcRenderer.invoke('local-files:index', params),
  localFilesSearch: (params) => ipcRenderer.invoke('local-files:search', params),
  localFilesIndexStatus: () => ipcRenderer.invoke('local-files:index-status'),
  localFilesOpen: (filePath) => ipcRenderer.invoke('local-files:open', filePath),
  localFilesReveal: (filePath) => ipcRenderer.invoke('local-files:reveal', filePath),
  localFilesSelectDirectory: () => ipcRenderer.invoke('local-files:select-directory'),
  localFilesGetCustomDirs: () => ipcRenderer.invoke('local-files:get-custom-dirs'),
  localFilesAddCustomDir: (data) => ipcRenderer.invoke('local-files:add-custom-dir', data),
  localFilesRemoveCustomDir: (data) => ipcRenderer.invoke('local-files:remove-custom-dir', data),

  // v2.3 洞察模块（异步任务模式）
  insightGetActivations: () => ipcRenderer.invoke('insight:get-activations'),
  insightAnalyzeGaps: () => ipcRenderer.invoke('insight:analyze-gaps'),
  insightGetEvolutions: () => ipcRenderer.invoke('insight:get-evolutions'),
  insightGetConflicts: () => ipcRenderer.invoke('insight:get-conflicts'),
  insightDetectConflicts: () => ipcRenderer.invoke('insight:detect-conflicts'),
  insightResolveConflict: (data) => ipcRenderer.invoke('insight:resolve-conflict', data),
  // 异步任务：发起后立即返回 taskId，完成后通过 IPC 推送
  insightStartTask: (taskType) => ipcRenderer.invoke('insight:start-task', { taskType }),
  insightGetCachedResult: (taskType) => ipcRenderer.invoke('insight:get-cached-result', { taskType }),
  insightGetTaskStatus: (taskType) => ipcRenderer.invoke('insight:get-task-status', { taskType }),
  insightInjectTestData: (data) => ipcRenderer.invoke('insight:inject-test-data', data),
  onInsightTaskComplete: (callback) => {
    ipcRenderer.on('insight:task-complete', (event, data) => callback(data));
  },
  onInsightTaskProgress: (callback) => {
    ipcRenderer.on('insight:task-progress', (event, data) => callback(data));
  },

  // v2.3 多模态知识库
  multimodalImport: (options) => ipcRenderer.invoke('multimodal:import', options),
  multimodalSaveUrl: (options) => ipcRenderer.invoke('multimodal:save-url', options),
  multimodalSaveMeeting: (options) => ipcRenderer.invoke('multimodal:save-meeting', options),
  multimodalList: (options) => ipcRenderer.invoke('multimodal:list', options),
  multimodalGet: (id) => ipcRenderer.invoke('multimodal:get', id),
  multimodalDelete: (id) => ipcRenderer.invoke('multimodal:delete', id),
  multimodalUpdate: (id, updates) => ipcRenderer.invoke('multimodal:update', id, updates),
  multimodalStats: () => ipcRenderer.invoke('multimodal:stats'),
  multimodalProcess: (id) => ipcRenderer.invoke('multimodal:process', id),
  multimodalGenerateBook: (options) => ipcRenderer.invoke('multimodal:generate-book', options),
  multimodalGetBooks: () => ipcRenderer.invoke('multimodal:get-books'),
  multimodalOpenFile: (id) => ipcRenderer.invoke('multimodal:open-file', id),
  multimodalPickFiles: () => ipcRenderer.invoke('multimodal:pick-files'),
  multimodalImportBuffer: (options) => ipcRenderer.invoke('multimodal:import-buffer', options),

  // 数据导出/导入
  dataExport: (password) => ipcRenderer.invoke('data:export', { password }),
  dataImport: (password, filePath) => ipcRenderer.invoke('data:import', { password, filePath }),
  dataImportConfirm: (importData, mergeMode) => ipcRenderer.invoke('data:import-confirm', { importData, mergeMode }),

  // v2.1 云端同步
  sync: {
    registerDevice: (data) => ipcRenderer.invoke('sync:register-device', data),
    getDeviceList: () => ipcRenderer.invoke('sync:get-device-list'),
    deactivateDevice: (data) => ipcRenderer.invoke('sync:deactivate-device', data),
    full: (data) => ipcRenderer.invoke('sync:full', data),
    push: (data) => ipcRenderer.invoke('sync:push', data),
    pull: (data) => ipcRenderer.invoke('sync:pull', data),
    resolve: (data) => ipcRenderer.invoke('sync:resolve', data),
    getStatus: () => ipcRenderer.invoke('sync:get-status'),
  },
  // 兼容旧调用方式（App.js 中使用 window.electronAPI.syncXxx）
  syncRegisterDevice: (data) => ipcRenderer.invoke('sync:register-device', data),
  syncGetDeviceList: () => ipcRenderer.invoke('sync:get-device-list'),
  syncDeactivateDevice: (data) => ipcRenderer.invoke('sync:deactivate-device', data),
  syncFull: (data) => ipcRenderer.invoke('sync:full', data),
  syncPush: (data) => ipcRenderer.invoke('sync:push', data),
  syncPull: (data) => ipcRenderer.invoke('sync:pull', data),
  syncResolve: (data) => ipcRenderer.invoke('sync:resolve', data),
  syncGetStatus: () => ipcRenderer.invoke('sync:get-status'),
  onSyncStatusChanged: (callback) => {
    ipcRenderer.on('sync:status-changed', (event, data) => callback(data));
  },
});