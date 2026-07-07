/**
 * 记事本 MCP Server 启动脚本（stdio 模式）
 */

const NotebookMCPServer = require('./notebook-mcp-server');

const server = new NotebookMCPServer();

const notesPath = process.env.NOTES_PATH || '';
const categoriesPath = process.env.CATEGORIES_PATH || '';

class SimpleNotebook {
  constructor() {
    this.notes = [];
    this.categories = ['默认'];
  }

  _loadNotes() {
    if (!notesPath) return;
    try {
      const fs = require('fs');
      const raw = fs.readFileSync(notesPath, 'utf8');
      this.notes = JSON.parse(raw);
    } catch (_) {}
  }

  _saveNotes() {
    if (!notesPath) return;
    try {
      const fs = require('fs');
      fs.writeFileSync(notesPath, JSON.stringify(this.notes, null, 2));
    } catch (_) {}
  }

  _loadCategories() {
    if (!categoriesPath) return;
    try {
      const fs = require('fs');
      const raw = fs.readFileSync(categoriesPath, 'utf8');
      this.categories = JSON.parse(raw);
    } catch (_) {}
  }

  _saveCategories() {
    if (!categoriesPath) return;
    try {
      const fs = require('fs');
      fs.writeFileSync(categoriesPath, JSON.stringify(this.categories, null, 2));
    } catch (_) {}
  }

  getAllNotes() {
    return this.notes;
  }

  getNote(id) {
    return this.notes.find(n => n.id === id);
  }

  createNote(note) {
    const newNote = {
      id: `note_${Date.now()}`,
      title: note.title || '无标题',
      content: note.content || '',
      category: note.category || '默认',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.notes.unshift(newNote);
    this._saveNotes();
    return newNote;
  }

  updateNote(id, updates) {
    const index = this.notes.findIndex(n => n.id === id);
    if (index !== -1) {
      this.notes[index] = {
        ...this.notes[index],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      this._saveNotes();
      return this.notes[index];
    }
    return null;
  }

  deleteNote(id) {
    const before = this.notes.length;
    this.notes = this.notes.filter(n => n.id !== id);
    this._saveNotes();
    return this.notes.length < before;
  }

  searchNotes(keyword) {
    const kw = keyword.toLowerCase();
    return this.notes.filter(n => 
      n.title.toLowerCase().includes(kw) || 
      n.content.toLowerCase().includes(kw)
    );
  }

  changeCategory(id, category) {
    const note = this.notes.find(n => n.id === id);
    if (note) {
      note.category = category;
      note.updatedAt = new Date().toISOString();
      this._saveNotes();
      return true;
    }
    return false;
  }

  batchChangeCategory(ids, category) {
    let changed = false;
    for (const id of ids) {
      const note = this.notes.find(n => n.id === id);
      if (note && note.category !== category) {
        note.category = category;
        note.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) this._saveNotes();
    return changed;
  }

  getCategories() {
    return this.categories;
  }

  saveCategories(categories) {
    this.categories = categories;
    this._saveCategories();
    return true;
  }

  deleteNotesByCategory(category) {
    const before = this.notes.length;
    this.notes = this.notes.filter(n => n.category !== category);
    this._saveNotes();
    return this.notes.length < before;
  }
}

const notebook = new SimpleNotebook();
notebook._loadNotes();
notebook._loadCategories();

server.setDependencies(notebook, null, null);
server.registerTools();
server.start('stdio');