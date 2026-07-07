/**
 * 设置 MCP Server 启动脚本（stdio 模式）
 */

const SettingsMCPServer = require('./settings-mcp-server');

const server = new SettingsMCPServer();

const settingsPath = process.env.SETTINGS_PATH || '';

class SimpleSettings {
  constructor() {
    this.settings = {};
  }

  _load() {
    if (!settingsPath) return;
    try {
      const fs = require('fs');
      const raw = fs.readFileSync(settingsPath, 'utf8');
      this.settings = JSON.parse(raw);
    } catch (_) {}
  }

  _save() {
    if (!settingsPath) return;
    try {
      const fs = require('fs');
      fs.writeFileSync(settingsPath, JSON.stringify(this.settings, null, 2));
    } catch (_) {}
  }

  get(key) {
    return this.settings[key];
  }

  set(key, value) {
    this.settings[key] = value;
    this._save();
    return true;
  }

  delete(key) {
    const exists = key in this.settings;
    delete this.settings[key];
    this._save();
    return exists;
  }

  list() {
    return Object.keys(this.settings).map(key => ({
      key,
      value: this.settings[key]
    }));
  }
}

const settings = new SimpleSettings();
settings._load();

const getSetting = (key) => settings.get(key);
const setSetting = (key, value) => settings.set(key, value);
const deleteSetting = (key) => settings.delete(key);

server.setDependencies(getSetting, setSetting, deleteSetting, {}, { isLoggedIn: false });
server.registerTools();
server.start('stdio');