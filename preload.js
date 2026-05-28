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
  notebookDeleteNote: (id) => ipcRenderer.invoke('notebook-delete-note', id),
  notebookDeleteNotesByCategory: (category) => ipcRenderer.invoke('notebook-delete-notes-by-category', category),
  notebookGetStats: () => ipcRenderer.invoke('notebook-get-stats'),
  
  // 反馈系统（用于持续优化）
  recordFeedback: (feedback) => ipcRenderer.invoke('record-feedback', feedback),
  optimizePrompts: () => ipcRenderer.invoke('optimize-prompts'),
  
  // 剪切板去重管理
  clearClipboardHashes: () => ipcRenderer.invoke('clear-clipboard-hashes'),
  getClipboardHashCount: () => ipcRenderer.invoke('get-clipboard-hash-count'),
  
  onClipboardTaskDetected: (callback) => {
    ipcRenderer.on('clipboard-task-detected', (event, data) => callback(data));
  },
  
  onStartPomodoro: (callback) => {
    ipcRenderer.on('start-pomodoro', () => callback());
  },
  
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close')
});