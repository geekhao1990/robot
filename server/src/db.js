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

const LIFESTYLE_NOTE_UPDATES = Object.freeze({
  n1: {
    title: '周末慢早餐｜给自己半小时的仪式感',
    content: '周末不用赶时间，给自己做一份慢早餐。热一杯牛奶、煎个鸡蛋，再把窗帘拉开，普通的一天也会变得很柔软。',
    tags: ['慢早餐', '生活记录', '周末'], likes: 58, collects: 26, imageSeeds: ['slow-breakfast', 'weekend-coffee'],
  },
  n2: {
    title: '十分钟收纳桌面，工作心情都变好了',
    content: '不需要买很多收纳工具：把每天都要用的东西留在手边，其他物品收进抽屉。下班前花十分钟整理，第二天打开电脑会轻松很多。',
    tags: ['桌面收纳', '居家办公', '生活小技巧'], likes: 43, collects: 31, imageSeeds: ['tidy-desk'],
  },
  n4: {
    title: '通勤包里一直带着的五样小物',
    content: '一把折叠伞、一支润唇膏、耳机、小水杯和纸巾。都是不贵的小东西，但每天出门时都能带来一点踏实感。',
    tags: ['通勤日常', '好物分享', '生活方式'], likes: 67, collects: 38, imageSeeds: ['commute-bag', 'daily-essentials'],
  },
  n5: {
    title: '下班后的热汤面，简单但很治愈',
    content: '冰箱里常备鸡蛋和青菜，十分钟煮一碗热汤面。认真吃完晚饭，再慢慢收拾厨房，就是我的下班仪式。',
    tags: ['一人食', '下班日常', '简单料理'], likes: 52, collects: 29, imageSeeds: ['noodle-soup', 'home-dinner'],
  },
  n6: {
    title: '耳机用了三个月，通勤体验分享',
    content: '通勤路上最离不开的就是耳机。降噪够用、佩戴轻松，地铁里听播客也很清楚。适合想提升通勤幸福感的人。',
    tags: ['通勤好物', '数码日常', '耳机'], likes: 34, collects: 22, imageSeeds: ['commute-headphones'],
  },
  n7: {
    title: '手机拍照构图入门课｜日常也能拍得更好看',
    content: '从光线、角度到画面留白，整理了几种日常最常用的手机拍照方法。通勤、吃饭和旅行时都能马上用上。',
    tags: ['手机摄影', '拍照技巧', '课程'], likes: 76, collects: 47, imageSeeds: ['phone-photography'],
  },
  n8: {
    title: '周末在家做一份巴斯克蛋糕',
    content: '不追求完美的裂纹，刚出炉时的焦香就已经很满足。配一杯咖啡，周末下午会变得特别慢。',
    tags: ['烘焙日常', '甜品', '周末生活'], likes: 61, collects: 42, imageSeeds: ['basque-cake', 'afternoon-coffee'],
  },
});

function applyLifestyleNotesMigration() {
  db.contentMigrations = db.contentMigrations || {};
  if (db.contentMigrations.lifestyleNotesV1 === true) return false;
  let changed = false;
  (db.notes || []).forEach((note) => {
    // 隐藏的金手指入口保留内容，仅重置互动初始值。
    if (note.type === 'gold' && note.visible === false) {
      note.likes = 42;
      note.collects = 28;
      delete note.comments;
      delete note.commentList;
      changed = true;
      return;
    }
    const update = LIFESTYLE_NOTE_UPDATES[note.id];
    if (!update) return;
    const ratio = Number(note.coverRatio) || 1.25;
    Object.assign(note, {
      title: update.title,
      content: update.content,
      tags: update.tags,
      likes: update.likes,
      collects: update.collects,
      riskDisclaimerEnabled: false,
      images: update.imageSeeds.map((seed) => `https://picsum.photos/seed/${seed}/800/${Math.round(800 * ratio)}`),
      cover: `https://picsum.photos/seed/${update.imageSeeds[0]}/400/${Math.round(400 * ratio)}`,
    });
    delete note.comments;
    delete note.commentList;
    changed = true;
  });
  (db.notes || []).forEach((note) => {
    if (Object.prototype.hasOwnProperty.call(note, 'comments')) {
      delete note.comments;
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(note, 'commentList')) {
      delete note.commentList;
      changed = true;
    }
  });
  const lifestyleAuthor = (db.users || []).find((user) => user.id === 'u4');
  if (lifestyleAuthor && lifestyleAuthor.name === '金融小课堂') {
    lifestyleAuthor.name = '日常小课堂';
    lifestyleAuthor.desc = '记录实用的生活灵感';
    (db.notes || []).filter((note) => note.authorId === lifestyleAuthor.id).forEach((note) => {
      note.author = { id: lifestyleAuthor.id, name: lifestyleAuthor.name, avatar: lifestyleAuthor.avatar };
    });
    changed = true;
  }
  db.contentMigrations.lifestyleNotesV1 = true;
  return true;
}

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
  const lifestyleChanged = applyLifestyleNotesMigration();
  if (mysqlEnabled()) {
    await save();
  } else if (contentChanged || settingsChanged || lifestyleChanged || !fs.existsSync(FILE)) {
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
