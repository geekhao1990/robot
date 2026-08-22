// server/src/db.js
// 极简 JSON 文件数据库。首次启动用 seed 初始化，写操作落盘。
// 生产可替换为 MongoDB / MySQL：保持下方导出的方法签名即可。

const fs = require('fs');
const path = require('path');
const { CONTENT_TYPES, TYPE_LABELS, typeLabel } = require('./content-types');

const FILE = path.join(__dirname, '../data/db.json');
let db = null;

function ensureContentTypes() {
  let changed = false;
  if (!Array.isArray(db.notes)) {
    db.notes = [];
    changed = true;
  }
  db.notes.forEach((note) => {
    if (!CONTENT_TYPES.includes(note.type)) {
      note.type = 'material';
      changed = true;
    }
    const category = typeLabel(note.type);
    if (note.category !== category) {
      note.category = category;
      changed = true;
    }
    if (note.type === 'gold' && note.courseUrl) {
      note.courseUrl = '';
      changed = true;
    }
  });
  const categories = Object.values(TYPE_LABELS);
  if (!Array.isArray(db.categories) || JSON.stringify(db.categories) !== JSON.stringify(categories)) {
    db.categories = categories;
    changed = true;
  }
  if (!Array.isArray(db.users)) {
    db.users = [];
    changed = true;
  }
  const existingAuthors = new Set(db.notes.map((note) => note.authorId).filter(Boolean));
  db.users.forEach((user) => {
    if (typeof user.official !== 'boolean') {
      user.official = !user.wxOpenId && existingAuthors.has(user.id);
      changed = true;
    }
    if (!Number.isFinite(user.createdAt)) {
      user.createdAt = user.wxOpenId ? Date.now() : 0;
      changed = true;
    }
    if (!Array.isArray(user.tags)) {
      user.tags = user.wxOpenId && !user.vip ? ['new'] : [];
      changed = true;
    }
    if (typeof user.vipPermanent !== 'boolean') {
      user.vipPermanent = user.vipPlan === 'lifetime';
      changed = true;
    }
  });
  if (!Array.isArray(db.paymentOrders)) {
    db.paymentOrders = [];
    changed = true;
  }
  if (!Array.isArray(db.invites)) {
    db.invites = [];
    changed = true;
  }
  return changed;
}

function ensureSettings() {
  const notes = Array.isArray(db.notes) ? db.notes : [];
  let changed = false;
  if (!db.settings || typeof db.settings !== 'object') {
    db.settings = {};
    changed = true;
  }
  if (typeof db.settings.rewardedAdEnabled !== 'boolean') {
    db.settings.rewardedAdEnabled = false;
    changed = true;
  }
  const configured = notes.find((n) => n.id === db.settings.featuredNoteId);
  let goldNote = configured && configured.type === 'gold'
    ? configured
    : notes.find((n) => n.type === 'gold');
  if (!goldNote) {
    goldNote = configured || notes.find((n) => n.type === 'course') || notes[0];
    if (goldNote) {
      goldNote.type = 'gold';
      goldNote.category = typeLabel('gold');
      changed = true;
    }
  }
  if (goldNote && goldNote.courseUrl) {
    goldNote.courseUrl = '';
    changed = true;
  }
  if (db.settings.featuredNoteId !== (goldNote ? goldNote.id : '')) {
    db.settings.featuredNoteId = goldNote ? goldNote.id : '';
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
  const contentChanged = ensureContentTypes();
  const settingsChanged = ensureSettings();
  if (contentChanged || settingsChanged || !fs.existsSync(FILE)) save();
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
