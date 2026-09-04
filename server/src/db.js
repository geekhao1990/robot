// server/src/db.js
// 极简 JSON 文件数据库。首次启动用 seed 初始化，写操作落盘。
// 生产可替换为 MongoDB / MySQL：保持下方导出的方法签名即可。

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { CONTENT_TYPES, TYPE_LABELS, typeLabel, typeForCategory } = require('./content-types');
const { normalizeResourceLinks } = require('./resource-links');

const FILE = path.join(__dirname, '../data/db.json');
let db = null;
let pool = null;
let saveChain = Promise.resolve();

function mysqlEnabled() {
  return !!String(process.env.MYSQL_DATABASE || '').trim();
}

function mysqlConfig() {
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT) || 5,
    queueLimit: 0,
  };
}

function ensureContentTypes() {
  let changed = false;
  if (!Array.isArray(db.notes)) {
    db.notes = [];
    changed = true;
  }
  const baseCategories = Object.values(TYPE_LABELS);
  const savedCategories = Array.isArray(db.categories) ? db.categories : [];
  const customCategories = [...savedCategories, ...db.notes.map((note) => note.category)]
    .map((name) => String(name || '').trim())
    .filter((name, index, list) => name && !baseCategories.includes(name) && list.indexOf(name) === index);
  const categories = [...baseCategories, ...customCategories];
  if (!Array.isArray(db.categories) || JSON.stringify(db.categories) !== JSON.stringify(categories)) {
    db.categories = categories;
    changed = true;
  }
  db.notes.forEach((note) => {
    if (typeof note.visible !== 'boolean') {
      note.visible = true;
      changed = true;
    }
    if (typeof note.free !== 'boolean') {
      // 默认会员专享；管理员可逐篇改为“免费（看广告领取）”。
      note.free = false;
      changed = true;
    }
    const category = String(note.category || '').trim();
    const nextCategory = categories.includes(category) ? category : typeLabel(note.type);
    const nextType = typeForCategory(nextCategory);
    if (!CONTENT_TYPES.includes(note.type) || note.type !== nextType) {
      note.type = nextType;
      changed = true;
    }
    if (note.category !== nextCategory) {
      note.category = nextCategory;
      changed = true;
    }
    const links = normalizeResourceLinks(note, note.type, true);
    if (note.baiduUrl !== links.baiduUrl || note.quarkUrl !== links.quarkUrl || note.courseUrl !== links.courseUrl) {
      Object.assign(note, links);
      changed = true;
    }
  });
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
  if (!Array.isArray(db.withdrawals)) {
    db.withdrawals = [];
    changed = true;
  }
  if (!Array.isArray(db.pointAnomalies)) {
    db.pointAnomalies = [];
    changed = true;
  }
  if (!db.sessions || typeof db.sessions !== 'object') {
    db.sessions = { app: {}, admin: {} };
    changed = true;
  }
  if (!db.sessions.app || typeof db.sessions.app !== 'object') {
    db.sessions.app = {};
    changed = true;
  }
  if (!db.sessions.admin || typeof db.sessions.admin !== 'object') {
    db.sessions.admin = {};
    changed = true;
  }
  if (!Array.isArray(db.adminOperationLogs)) {
    db.adminOperationLogs = [];
    changed = true;
  }
  if (!Array.isArray(db.goldFingerRecords)) {
    db.goldFingerRecords = [];
    changed = true;
  }
  if (!Array.isArray(db.goldFingerBanners)) {
    db.goldFingerBanners = [];
    changed = true;
  }
  if (typeof db.goldFingerImportInitialized !== 'boolean') {
    db.goldFingerImportInitialized = false;
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
  if (typeof db.settings.vipEnabled !== 'boolean') {
    db.settings.vipEnabled = false;
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
  if (goldNote && (goldNote.courseUrl || goldNote.baiduUrl || goldNote.quarkUrl)) {
    Object.assign(goldNote, normalizeResourceLinks(goldNote, 'gold'));
    changed = true;
  }
  if (db.settings.featuredNoteId !== (goldNote ? goldNote.id : '')) {
    db.settings.featuredNoteId = goldNote ? goldNote.id : '';
    changed = true;
  }
  return changed;
}

async function load() {
  if (mysqlEnabled()) {
    pool = mysql.createPool(mysqlConfig());
    await pool.query(`CREATE TABLE IF NOT EXISTS app_state (
      state_key VARCHAR(80) NOT NULL PRIMARY KEY,
      state_value LONGTEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const [rows] = await pool.query('SELECT state_key, state_value FROM app_state');
    if (rows.length) {
      db = {};
      rows.forEach((row) => {
        try { db[row.state_key] = JSON.parse(row.state_value); } catch (error) { throw new Error(`MySQL 状态损坏：${row.state_key}`); }
      });
    } else if (fs.existsSync(FILE)) {
      db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } else {
      db = require('./seed')();
    }
  } else if (fs.existsSync(FILE)) {
    db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } else {
    db = require('./seed')();
  }
  const contentChanged = ensureContentTypes();
  const settingsChanged = ensureSettings();
  if (mysqlEnabled()) {
    await save();
  } else if (contentChanged || settingsChanged || !fs.existsSync(FILE)) {
    save();
  }
  return db;
}

function save() {
  if (mysqlEnabled()) {
    const snapshot = Object.entries(db).map(([key, value]) => [key, JSON.stringify(value)]);
    saveChain = saveChain.catch(() => {}).then(async () => {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        for (const [key, value] of snapshot) {
          await connection.execute(
            'INSERT INTO app_state (state_key, state_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE state_value = VALUES(state_value)',
            [key, value]
          );
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    });
    return saveChain;
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
  return Promise.resolve();
}

function get() {
  if (!db) throw new Error('数据库尚未初始化');
  return db;
}

function flush() {
  return saveChain;
}

async function close() {
  await flush();
  if (pool) await pool.end();
}

module.exports = { load, save, flush, close, get, mysqlEnabled };
