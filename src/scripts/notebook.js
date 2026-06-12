const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

// 记事本存储路径：打包后必须使用 userData 目录（ASAR 内只读）
const NOTEBOOK_PATH = path.join(app.getPath('userData'), 'notebook');

// 确保目录存在
if (!fs.existsSync(NOTEBOOK_PATH)) {
  fs.mkdirSync(NOTEBOOK_PATH, { recursive: true });
}

class Notebook {
  constructor() {
    this.notes = [];
    this.customCategories = {};
    this.loadNotes();
    this.loadCustomCategories();
  }

  loadNotes() {
    try {
      const file = path.join(NOTEBOOK_PATH, 'notes.json');
      if (fs.existsSync(file)) {
        const data = fs.readFileSync(file, 'utf8');
        this.notes = JSON.parse(data);
        // 迁移：为缺少 contentHash 的旧笔记补充 hash
        let needSave = false;
        for (const note of this.notes) {
          if (!note.contentHash && note.content) {
            note.contentHash = this._hashContent(note.content);
            needSave = true;
          }
        }
        if (needSave) this.saveNotes();
      } else {
        this.notes = [];
      }
    } catch (e) {
      console.error('[Notebook] Load error:', e);
      this.notes = [];
    }
  }

  loadCustomCategories() {
    try {
      const file = path.join(NOTEBOOK_PATH, 'categories.json');
      if (fs.existsSync(file)) {
        const data = fs.readFileSync(file, 'utf8');
        this.customCategories = JSON.parse(data);
      } else {
        this.customCategories = {};
      }
    } catch (e) {
      console.error('[Notebook] Load categories error:', e);
      this.customCategories = {};
    }
  }

  getCustomCategories() {
    return this.customCategories || {};
  }

  saveCustomCategories(categories) {
    this.customCategories = categories || {};
    try {
      const file = path.join(NOTEBOOK_PATH, 'categories.json');
      fs.writeFileSync(file, JSON.stringify(this.customCategories, null, 2));
    } catch (e) {
      console.error('[Notebook] Save categories error:', e);
    }
  }

  saveNotes() {
    try {
      const file = path.join(NOTEBOOK_PATH, 'notes.json');
      fs.writeFileSync(file, JSON.stringify(this.notes, null, 2));
    } catch (e) {
      console.error('[Notebook] Save error:', e);
    }
  }

  addNote(note) {
    // 图片类笔记：用 imageHash 做像素级去重（比文本 contentHash 更精准）
    if (note.category === 'image' && note.imageHash) {
      if (this._isDuplicateImage(note.imageHash)) {
        console.log('[Notebook] Duplicate image, skipping:', note.imageHash.substring(0, 8));
        return null;
      }
    }

    // 文本类笔记：全局 hash 去重（相同内容不重复添加）
    const contentHash = this._hashContent(note.content);
    if (note.category !== 'image' && this._isDuplicate(contentHash)) {
      console.log('[Notebook] Duplicate content, skipping:', contentHash.substring(0, 8));
      return null;
    }

    const newNote = {
      id: note.id || (Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9)),
      content: note.content,
      title: note.title || this.extractTitle(note.content),
      category: note.category || 'general',
      tags: note.tags || [],
      contentHash: contentHash,
      createdAt: note.createdAt || new Date().toISOString(),
      updatedAt: note.updatedAt || new Date().toISOString(),
      analyzed: note.analyzed || false,
      analysis: note.analysis || null,
      relatedTasks: note.relatedTasks || []
    };

    // 图片专属字段（纯图片笔记 或 图文混合笔记）
    if (note.category === 'image' || note.imagePath) {
      newNote.imagePath = note.imagePath || null;
      newNote.serverImagePath = note.serverImagePath || '';
      newNote.imageHash = note.imageHash || null;
      newNote.imageWidth = note.imageWidth || null;
      newNote.imageHeight = note.imageHeight || null;
    }
    
    this.notes.unshift(newNote);
    this.saveNotes();
    return newNote;
  }

  /**
   * 计算内容的 SHA-256 hash（trim 后计算，忽略首尾空白差异）
   */
  _hashContent(content) {
    const trimmed = (content || '').trim();
    return crypto.createHash('sha256').update(trimmed, 'utf8').digest('hex');
  }

  /**
   * 检查是否已存在相同 hash 的记事项（全局去重，不限日期）
   */
  _isDuplicate(contentHash) {
    if (!contentHash) return false;
    return this.notes.some(note => {
      const noteHash = note.contentHash || this._hashContent(note.content);
      return noteHash === contentHash;
    });
  }

  /**
   * 检查是否已存在相同 imageHash 的图片记事项（像素级去重）
   */
  _isDuplicateImage(imageHash) {
    if (!imageHash) return false;
    return this.notes.some(note => note.imageHash === imageHash);
  }

  extractTitle(content) {
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length > 0) {
      return lines[0].substring(0, 50) + (lines[0].length > 50 ? '...' : '');
    }
    return '无标题';
  }

  searchNotes(query) {
    if (!query) return this.notes;
    
    const lowerQuery = query.toLowerCase();
    return this.notes.filter(note => 
      note.title.toLowerCase().includes(lowerQuery) ||
      note.content.toLowerCase().includes(lowerQuery) ||
      note.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }

  getNotesByCategory(category) {
    if (!category || category === 'all') return this.notes;
    return this.notes.filter(note => note.category === category);
  }

  getNoteById(id) {
    return this.notes.find(note => note.id === id);
  }

  updateNote(id, updates) {
    const index = this.notes.findIndex(note => note.id === id);
    if (index !== -1) {
      this.notes[index] = {
        ...this.notes[index],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      this.saveNotes();
      return this.notes[index];
    }
    return null;
  }

  deleteNote(id) {
    const index = this.notes.findIndex(note => note.id === id);
    if (index !== -1) {
      const deleted = this.notes.splice(index, 1)[0];
      this.saveNotes();
      return deleted;
    }
    return null;
  }
  
  deleteNotesByCategory(category) {
    const initialLength = this.notes.length;
    this.notes = this.notes.filter(note => note.category !== category);
    const deletedCount = initialLength - this.notes.length;
    this.saveNotes();
    return deletedCount;
  }

  getStats() {
    const stats = {
      total: this.notes.length,
      byCategory: {},
      analyzedCount: this.notes.filter(n => n.analyzed).length
    };
    
    this.notes.forEach(note => {
      const cat = note.category || 'general';
      stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
    });
    
    return stats;
  }
}

module.exports = { Notebook };
