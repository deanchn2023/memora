// 记忆系统存储模块
const path = require('path');
const { app } = require('electron');

// 记忆类型
const MEMORY_TYPES = {
  INSTANT: 'instant',      // 瞬时记忆（5分钟~1小时）
  SHORT: 'short',          // 短期记忆（1天~7天）
  LONG: 'long'             // 长期记忆（数月）
};

// 记忆分类类型
const MEMORY_CATEGORIES = {
  TASK: 'task',
  INTEREST: 'interest',
  PERSON: 'person',
  PROJECT: 'project',
  GOAL: 'goal',
  KNOWLEDGE: 'knowledge',
  ACTION: 'action',
  CLIPBOARD: 'clipboard' // 剪贴板日志
};

// 记忆存储路径：打包后必须使用 userData 目录（ASAR 内只读）
const MEMORY_PATH = app.isPackaged
  ? path.join(app.getPath('userData'), 'memory')
  : path.join(__dirname, 'memory');

class MemoryStore {
  constructor() {
    this.memories = [];
    this.entityGraph = {}; // 实体图谱
    this.loadMemories();
  }

  loadMemories() {
    try {
      const fs = require('fs');
      if (!fs.existsSync(MEMORY_PATH)) {
        fs.mkdirSync(MEMORY_PATH, { recursive: true });
      }
      
      const memoryFile = path.join(MEMORY_PATH, 'memories.json');
      if (fs.existsSync(memoryFile)) {
        this.memories = JSON.parse(fs.readFileSync(memoryFile, 'utf8'));
      }
      
      const graphFile = path.join(MEMORY_PATH, 'entity-graph.json');
      if (fs.existsSync(graphFile)) {
        this.entityGraph = JSON.parse(fs.readFileSync(graphFile, 'utf8'));
      }
    } catch (e) {
      console.error('[Memory] Load error:', e);
      this.memories = [];
      this.entityGraph = {};
    }
  }

  saveMemories() {
    try {
      const fs = require('fs');
      const memoryFile = path.join(MEMORY_PATH, 'memories.json');
      fs.writeFileSync(memoryFile, JSON.stringify(this.memories, null, 2));
      
      const graphFile = path.join(MEMORY_PATH, 'entity-graph.json');
      fs.writeFileSync(graphFile, JSON.stringify(this.entityGraph, null, 2));
    } catch (e) {
      console.error('[Memory] Save error:', e);
    }
  }

  // 添加记忆
  addMemory(memory) {
    const newMemory = {
      id: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9),
      type: memory.type || MEMORY_TYPES.SHORT,
      category: memory.category || MEMORY_CATEGORIES.KNOWLEDGE,
      content: memory.content,
      metadata: memory.metadata || {},
      confidence: memory.confidence || 0.8,
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      importance: memory.importance || 'normal'
    };
    
    this.memories.unshift(newMemory);
    
    // 更新实体图谱
    this.updateEntityGraph(newMemory);
    
    // 压缩记忆（保留最近的）
    this.compressMemories();
    
    this.saveMemories();
    return newMemory;
  }

  // 更新实体图谱
  updateEntityGraph(memory) {
    const entities = this.extractEntities(memory);
    
    entities.forEach(entity => {
      if (!this.entityGraph[entity.name]) {
        this.entityGraph[entity.name] = {
          type: entity.type,
          count: 0,
          related: [],
          lastSeen: new Date().toISOString()
        };
      }
      this.entityGraph[entity.name].count++;
      this.entityGraph[entity.name].lastSeen = new Date().toISOString();
      
      // 添加关联
      entities.filter(e => e.name !== entity.name).forEach(related => {
        if (!this.entityGraph[entity.name].related.includes(related.name)) {
          this.entityGraph[entity.name].related.push(related.name);
        }
      });
    });
  }

  // 从记忆中提取实体
  extractEntities(memory) {
    const entities = [];
    const content = memory.content.toLowerCase();
    
    // 简单的实体提取（可以扩展）
    if (memory.category === MEMORY_CATEGORIES.TASK) {
      entities.push({ name: memory.content.substring(0, 20), type: 'task' });
    }
    
    if (memory.metadata.person) {
      entities.push({ name: memory.metadata.person, type: 'person' });
    }
    
    if (memory.metadata.topic) {
      entities.push({ name: memory.metadata.topic, type: 'topic' });
    }
    
    if (memory.metadata.project) {
      entities.push({ name: memory.metadata.project, type: 'project' });
    }
    
    return entities;
  }

  // 压缩记忆
  compressMemories() {
    const now = new Date();
    
    // 瞬时记忆：保留最近1小时
    const instantLimit = new Date(now.getTime() - 60 * 60 * 1000);
    this.memories = this.memories.filter(m => {
      if (m.type === MEMORY_TYPES.INSTANT) {
        return new Date(m.createdAt) > instantLimit;
      }
      return true;
    });
    
    // 短期记忆：保留最近7天，最多500条
    const shortLimit = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    let shortCount = 0;
    this.memories = this.memories.filter(m => {
      if (m.type === MEMORY_TYPES.SHORT) {
        if (new Date(m.createdAt) < shortLimit) return false;
        shortCount++;
        return shortCount <= 500;
      }
      return true;
    });
    
    // 长期记忆：最多1000条
    let longCount = 0;
    this.memories = this.memories.filter(m => {
      if (m.type === MEMORY_TYPES.LONG) {
        longCount++;
        return longCount <= 1000;
      }
      return true;
    });
  }

  // 获取记忆
  getMemories(options = {}) {
    let result = [...this.memories];
    
    if (options.type) {
      result = result.filter(m => m.type === options.type);
    }
    
    if (options.category) {
      result = result.filter(m => m.category === options.category);
    }
    
    if (options.limit) {
      result = result.slice(0, options.limit);
    }
    
    return result;
  }

  // 获取实体图谱
  getEntityGraph() {
    return this.entityGraph;
  }

  // 删除记忆
  deleteMemory(id) {
    this.memories = this.memories.filter(m => m.id !== id);
    this.saveMemories();
  }
  
  // 更新记忆
  updateMemory(id, updates) {
    const index = this.memories.findIndex(m => m.id === id);
    if (index === -1) return null;
    
    this.memories[index] = {
      ...this.memories[index],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    
    this.saveMemories();
    return this.memories[index];
  }
  
  // 清空所有记忆
  clearAll() {
    this.memories = [];
    this.entityGraph = {};
    this.saveMemories();
  }

  // 搜索相关记忆
  searchRelated(content, limit = 5) {
    const keywords = content.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const scores = [];
    
    this.memories.forEach(memory => {
      let score = 0;
      const memoryContent = memory.content.toLowerCase();
      
      keywords.forEach(keyword => {
        if (memoryContent.includes(keyword)) {
          score += 1;
        }
      });
      
      if (score > 0) {
        scores.push({ memory, score });
      }
    });
    
    return scores.sort((a, b) => b.score - a.score).slice(0, limit).map(s => s.memory);
  }

  // 获取统计信息
  getStats() {
    const stats = {
      total: this.memories.length,
      byType: {
        instant: this.memories.filter(m => m.type === MEMORY_TYPES.INSTANT).length,
        short: this.memories.filter(m => m.type === MEMORY_TYPES.SHORT).length,
        long: this.memories.filter(m => m.type === MEMORY_TYPES.LONG).length
      },
      byCategory: {},
      entityCount: Object.keys(this.entityGraph).length
    };
    
    Object.values(MEMORY_CATEGORIES).forEach(cat => {
      stats.byCategory[cat] = this.memories.filter(m => m.category === cat).length;
    });
    
    return stats;
  }
}

module.exports = {
  MemoryStore,
  MEMORY_TYPES,
  MEMORY_CATEGORIES
};