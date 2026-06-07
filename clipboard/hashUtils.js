/**
 * 哈希工具函数 — 替代 String.prototype.hashCode 全局污染
 */

function hashString(str) {
  if (!str) return '0';
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString();
}

function getClipboardHash(text) {
  return hashString(text.trim().toLowerCase());
}

module.exports = { hashString, getClipboardHash };
