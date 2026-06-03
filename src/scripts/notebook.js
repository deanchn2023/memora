const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// 记事本存储路径：打包后必须使用 userData 目录（ASAR 内只读）
const NOTEBOOK_PATH = app.isPackaged
  ? path.join(app.getPath('userData'), 'notebook')
  : path.join(__dirname, 'notebook');

// 确保目录存在
if (!fs.existsSync(NOTEBOOK_PATH)) {
  fs.mkdirSync(NOTEBOOK_PATH, { recursive: true });
}

class Notebook {
  constructor() {
    this.notes = [];
    this.loadNotes();
  }

  loadNotes() {
    try {
      const file = path.join(NOTEBOOK_PATH, 'notes.json');
      if (fs.existsSync(file)) {
        const data = fs.readFileSync(file, 'utf8');
        this.notes = JSON.parse(data);
      } else {
        this.notes = [];
      }
    } catch (e) {
      console.error('[Notebook] Load error:', e);
      this.notes = [];
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
    const newNote = {
      id: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9),
      content: note.content,
      title: note.title || this.extractTitle(note.content),
      category: note.category || 'general',
      tags: note.tags || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      analyzed: note.analyzed || false,
      analysis: note.analysis || null,
      relatedTasks: note.relatedTasks || []
    };
    
    this.notes.unshift(newNote);
    this.saveNotes();
    return newNote;
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
