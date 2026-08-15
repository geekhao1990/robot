// server/src/db.js
// 极简 JSON 文件数据库。首次启动用 seed 初始化，写操作落盘。
// 生产可替换为 MongoDB / MySQL：保持下方导出的方法签名即可。

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '../data/db.json');
let db = null;

function ensureSettings() {
  const notes = Array.isArray(db.notes) ? db.notes : [];
  const fallbackNote = notes.find((n) => n.type === 'course') || notes[0];
  let changed = false;
  if (!db.settings || typeof db.settings !== 'object') {
    db.settings = {};
    changed = true;
  }
  if (typeof db.settings.rewardedAdEnabled !== 'boolean') {
    db.settings.rewardedAdEnabled = false;
    changed = true;
  }
  const featuredExists = notes.some((n) => n.id === db.settings.featuredNoteId);
  if (!featuredExists) {
    db.settings.featuredNoteId = fallbackNote ? fallbackNote.id : '';
    changed = true;
  }
  return changed;
}

function load() {
  if (fs.existsSync(FILE)) {
    db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } else {
    db = require('./seed')();
  }
  if (ensureSettings() || !fs.existsSync(FILE)) save();
  return db;
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

function get() {
  if (!db) load();
  return db;
}

module.exports = { load, save, get };
