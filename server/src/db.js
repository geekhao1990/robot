// server/src/db.js
// 极简 JSON 文件数据库。首次启动用 seed 初始化，写操作落盘。
// 生产可替换为 MongoDB / MySQL：保持下方导出的方法签名即可。

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { CONTENT_TYPES, TYPE_LABELS, typeLabel, typeForCategory } = require('./content-types');
const { normalizeResourceLinks } = require('./resource-links');
const { refreshDarkFundQuota } = require('./membership');

const FILE = path.join(__dirname, '../data/db.json');
let db = null;
let pool = null;
let saveChain = Promise.resolve();
let lastOrdersSignature = null;
let lastEntitlementsSignature = null;
let lastReactionsSignature = null;

const ENTITLEMENT_KEYS = Object.freeze([
  'goldExpire', 'goldQuotaGiftMigrated', 'serviceExpire', 'servicePlan',
  'courseAccessPermanent', 'darkFundEnabled', 'decisionPioneerEnabled', 'darkFundRemaining',
  'darkFundManualRemaining', 'darkFundServiceRemaining',
  'darkFundServicePeriodStart', 'darkFundServicePeriodExpire', 'darkFundCloseExpire',
]);

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

const HOSTED_AVATAR_IDS = new Set(['1', '5', '11', '12', '15', '20', '33', '68']);

function hostedAvatarUrl(value) {
  const match = String(value || '').match(/^https:\/\/i\.pravatar\.cc\/150\?img=(\d+)$/i);
  if (!match || !HOSTED_AVATAR_IDS.has(match[1])) return String(value || '');
  return `https://app.nankaitechschool.com/assets/avatars/author-${match[1]}.jpg`;
}

function applyHostedAuthorAvatarMigration() {
  db.contentMigrations = db.contentMigrations || {};
  if (db.contentMigrations.hostedAuthorAvatarsV1 === true) return false;
  let changed = false;
  (db.users || []).forEach((user) => {
    const avatar = hostedAvatarUrl(user.avatar);
    if (avatar && avatar !== user.avatar) {
      user.avatar = avatar;
      changed = true;
    }
  });
  (db.notes || []).forEach((note) => {
    const author = (db.users || []).find((user) => user.id === note.authorId);
    if (!author) return;
    note.author = note.author || { id: author.id, name: author.name };
    if (note.author.avatar !== author.avatar) {
      note.author.avatar = author.avatar;
      changed = true;
    }
  });
  db.contentMigrations.hostedAuthorAvatarsV1 = true;
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

async function ensureDomainTables() {
  await pool.query(`CREATE TABLE IF NOT EXISTS dark_fund_orders (
    order_id VARCHAR(80) NOT NULL PRIMARY KEY,
    user_id VARCHAR(80) NOT NULL,
    client_request_id VARCHAR(80) NULL,
    status VARCHAR(32) NOT NULL,
    created_at BIGINT NOT NULL DEFAULT 0,
    payload_json LONGTEXT NOT NULL,
    UNIQUE KEY uniq_dark_fund_request (user_id, client_request_id),
    KEY idx_dark_fund_user_created (user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS user_entitlements (
    user_id VARCHAR(80) NOT NULL PRIMARY KEY,
    gold_expire BIGINT NOT NULL DEFAULT 0,
    service_expire BIGINT NOT NULL DEFAULT 0,
    service_plan VARCHAR(40) NOT NULL DEFAULT '',
    dark_fund_enabled TINYINT(1) NOT NULL DEFAULT 0,
    dark_manual_remaining INT NOT NULL DEFAULT 0,
    dark_service_remaining INT NOT NULL DEFAULT 0,
    dark_service_expire_at BIGINT NOT NULL DEFAULT 0,
    payload_json LONGTEXT NOT NULL,
    updated_at BIGINT NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS note_reactions (
    user_id VARCHAR(80) NOT NULL,
    note_id VARCHAR(80) NOT NULL,
    liked TINYINT(1) NOT NULL DEFAULT 0,
    collected TINYINT(1) NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, note_id),
    KEY idx_note_reactions_note (note_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

function entitlementOf(user) {
  const value = {};
  ENTITLEMENT_KEYS.forEach((key) => { value[key] = user[key]; });
  return value;
}

function normalizedStateSnapshot(source) {
  const orders = (source.darkFundOrders || []).map((order) => ({ ...order }));
  const entitlements = (source.users || []).filter((user) => user && user.id).map((user) => ({
    userId: user.id,
    ...entitlementOf(user),
  }));
  const reactions = [];
  Object.entries(source.userState || {}).forEach(([userId, userState]) => {
    const likes = userState.likes || {};
    const collects = userState.collects || {};
    const noteIds = new Set([...Object.keys(likes), ...Object.keys(collects)]);
    noteIds.forEach((noteId) => reactions.push({
      userId,
      noteId,
      liked: !!likes[noteId],
      collected: !!collects[noteId],
      updatedAt: Math.max(Number(likes[noteId]) || 0, Number(collects[noteId]) || 0),
    }));
  });
  orders.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  entitlements.sort((a, b) => String(a.userId).localeCompare(String(b.userId)));
  reactions.sort((a, b) => `${a.userId}:${a.noteId}`.localeCompare(`${b.userId}:${b.noteId}`));
  return { orders, entitlements, reactions };
}

function appStateSnapshot(source) {
  const result = {};
  Object.entries(source).forEach(([key, value]) => {
    if (key === 'darkFundOrders') return;
    if (key === 'users') {
      result.users = (value || []).map((user) => {
        const copy = { ...user };
        ENTITLEMENT_KEYS.forEach((field) => delete copy[field]);
        return copy;
      });
      return;
    }
    if (key === 'userState') {
      result.userState = {};
      Object.entries(value || {}).forEach(([userId, userState]) => {
        const copy = { ...userState };
        delete copy.likes;
        delete copy.collects;
        result.userState[userId] = copy;
      });
      return;
    }
    result[key] = value;
  });
  return result;
}

async function hydrateNormalizedState() {
  const [[orders], [entitlements], [reactions]] = await Promise.all([
    pool.query('SELECT payload_json FROM dark_fund_orders ORDER BY created_at ASC'),
    pool.query('SELECT user_id, payload_json FROM user_entitlements'),
    pool.query('SELECT user_id, note_id, liked, collected, updated_at FROM note_reactions'),
  ]);
  if (orders.length) {
    db.darkFundOrders = orders.map((row) => JSON.parse(row.payload_json));
  }
  if (entitlements.length) {
    const byId = new Map((db.users || []).map((user) => [user.id, user]));
    entitlements.forEach((row) => {
      const user = byId.get(row.user_id);
      if (!user) return;
      let payload = {};
      try { payload = JSON.parse(row.payload_json); } catch (error) {}
      Object.assign(user, payload);
    });
  }
  if (reactions.length) {
    db.userState = db.userState || {};
    reactions.forEach((row) => {
      const userState = db.userState[row.user_id] || (db.userState[row.user_id] = { follows: {} });
      userState.likes = userState.likes || {};
      userState.collects = userState.collects || {};
      if (row.liked) userState.likes[row.note_id] = Number(row.updated_at) || 1;
      if (row.collected) userState.collects[row.note_id] = Number(row.updated_at) || 1;
    });
  }
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
  const darkFundAuthorId = 'u1787979756047';
  let darkFundAuthor = db.users.find((user) => user.id === darkFundAuthorId);
  if (!darkFundAuthor) {
    darkFundAuthor = {
      id: darkFundAuthorId,
      name: '暗盘',
      avatar: '/images/profile-dark-funds.png',
      desc: '暗盘资金数据',
      fans: 0,
      follows: 0,
      likes: 0,
      goldExpire: 0,
      goldQuotaGiftMigrated: true,
      serviceExpire: 0,
      servicePlan: '',
      courseAccessPermanent: false,
      official: true,
      darkFundEnabled: false,
      darkFundRemaining: 0,
      darkFundManualRemaining: 0,
      darkFundServiceRemaining: 0,
      createdAt: 0,
      tags: [],
    };
    db.users.push(darkFundAuthor);
    changed = true;
  } else {
    if (darkFundAuthor.name !== '暗盘') { darkFundAuthor.name = '暗盘'; changed = true; }
    if (darkFundAuthor.official !== true) { darkFundAuthor.official = true; changed = true; }
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
      user.tags = user.wxOpenId ? ['new'] : [];
      changed = true;
    }
    if (!Number.isFinite(Number(user.goldExpire))) {
      user.goldExpire = 0;
      changed = true;
    }
    if (!Number.isFinite(Number(user.serviceExpire))) { user.serviceExpire = 0; changed = true; }
    if (typeof user.servicePlan !== 'string') { user.servicePlan = ''; changed = true; }
    if (typeof user.courseAccessPermanent !== 'boolean') { user.courseAccessPermanent = false; changed = true; }
    // 一次性把仍有效的旧会员权益迁移为金手指卡，避免历史用户权益丢失。
    const now = Date.now();
    const legacyVipActive = user.vip === true && (user.vipPermanent === true || Number(user.vipExpire) > now);
    if (legacyVipActive) {
      const legacyExpire = user.vipPermanent === true ? Date.UTC(2099, 11, 31) : Number(user.vipExpire);
      if (legacyExpire > Number(user.goldExpire || 0)) user.goldExpire = legacyExpire;
      changed = true;
    }
    for (const key of ['vip', 'vipPlan', 'vipExpire', 'vipPermanent', 'vipActivatedAt']) {
      if (Object.prototype.hasOwnProperty.call(user, key)) { delete user[key]; changed = true; }
    }
    if (typeof user.darkFundEnabled !== 'boolean') {
      user.darkFundEnabled = false;
      changed = true;
    }
    if (typeof user.decisionPioneerEnabled !== 'boolean') {
      user.decisionPioneerEnabled = false;
      changed = true;
    }
    if (!Number.isFinite(Number(user.darkFundCloseExpire))) { user.darkFundCloseExpire = 0; changed = true; }
    if (refreshDarkFundQuota(user).changed) changed = true;
    if (typeof user.goldQuotaGiftMigrated !== 'boolean') {
      if (Number(user.goldExpire) > Date.now()) {
        user.darkFundManualRemaining = Math.max(0, Number(user.darkFundManualRemaining) || 0) + 5;
        user.darkFundEnabled = true;
        refreshDarkFundQuota(user);
      }
      user.goldQuotaGiftMigrated = true;
      changed = true;
    }
  });
  if (!Array.isArray(db.paymentOrders)) {
    db.paymentOrders = [];
    changed = true;
  }
  if (!Array.isArray(db.darkFundOrders)) {
    db.darkFundOrders = [];
    changed = true;
  }
  if (!Array.isArray(db.analyticsEvents)) {
    db.analyticsEvents = [];
    changed = true;
  }
  db.darkFundOrders.forEach((order) => {
    const noteId = order.noteId || (order.snapshot && order.snapshot.note && order.snapshot.note.id) || `dark_${order.id}`;
    const note = db.notes.find((item) => item.id === noteId);
    if (!note) return;
    if (note.visibility !== 'private') {
      note.visibility = 'private';
      changed = true;
    }
    if (note.ownerUserId !== order.userId) {
      note.ownerUserId = order.userId;
      changed = true;
    }
    if (order.snapshot && order.snapshot.note) {
      if (order.snapshot.note.visibility !== 'private') {
        order.snapshot.note.visibility = 'private';
        changed = true;
      }
      if (order.snapshot.note.ownerUserId !== order.userId) {
        order.snapshot.note.ownerUserId = order.userId;
        changed = true;
      }
    }
  });
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
  if (Object.prototype.hasOwnProperty.call(db.settings, 'vipEnabled')) {
    delete db.settings.vipEnabled;
    changed = true;
  }
  if (typeof db.settings.goldFingerEntryEnabled !== 'boolean') {
    db.settings.goldFingerEntryEnabled = true;
    changed = true;
  }
  const configured = notes.find((n) => n.id === db.settings.featuredNoteId);
  const goldNote = configured && configured.type === 'gold'
    ? configured
    : notes.find((n) => n.type === 'gold');
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
    await ensureDomainTables();
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
    await hydrateNormalizedState();
  } else if (fs.existsSync(FILE)) {
    db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } else {
    db = require('./seed')();
  }
  const contentChanged = ensureContentTypes();
  const settingsChanged = ensureSettings();
  const lifestyleChanged = applyLifestyleNotesMigration();
  const avatarChanged = applyHostedAuthorAvatarMigration();
  if (mysqlEnabled()) {
    await save();
  } else if (contentChanged || settingsChanged || lifestyleChanged || avatarChanged || !fs.existsSync(FILE)) {
    save();
  }
  return db;
}

function save() {
  if (mysqlEnabled()) {
    const snapshot = Object.entries(appStateSnapshot(db)).map(([key, value]) => [key, JSON.stringify(value)]);
    const normalized = normalizedStateSnapshot(db);
    const ordersSignature = JSON.stringify(normalized.orders);
    const entitlementsSignature = JSON.stringify(normalized.entitlements);
    const reactionsSignature = JSON.stringify(normalized.reactions);
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
        await connection.execute("DELETE FROM app_state WHERE state_key = 'darkFundOrders'");
        if (ordersSignature !== lastOrdersSignature) {
          for (const order of normalized.orders) {
            await connection.execute(
              `INSERT INTO dark_fund_orders
              (order_id, user_id, client_request_id, status, created_at, payload_json)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE status = VALUES(status), payload_json = VALUES(payload_json)`,
              [order.id, order.userId, order.clientRequestId || null, order.status || '', Number(order.createdAt) || 0, JSON.stringify(order)]
            );
          }
        }
        if (entitlementsSignature !== lastEntitlementsSignature) {
          for (const item of normalized.entitlements) {
            await connection.execute(
              `INSERT INTO user_entitlements
              (user_id, gold_expire, service_expire, service_plan, dark_fund_enabled,
               dark_manual_remaining, dark_service_remaining, dark_service_expire_at, payload_json, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE gold_expire = VALUES(gold_expire), service_expire = VALUES(service_expire),
               service_plan = VALUES(service_plan), dark_fund_enabled = VALUES(dark_fund_enabled),
               dark_manual_remaining = VALUES(dark_manual_remaining), dark_service_remaining = VALUES(dark_service_remaining),
               dark_service_expire_at = VALUES(dark_service_expire_at), payload_json = VALUES(payload_json),
               updated_at = VALUES(updated_at)`,
              [item.userId, Number(item.goldExpire) || 0, Number(item.serviceExpire) || 0, item.servicePlan || '',
                item.darkFundEnabled ? 1 : 0, Number(item.darkFundManualRemaining) || 0,
                Number(item.darkFundServiceRemaining) || 0, Number(item.darkFundServicePeriodExpire) || 0,
                JSON.stringify(item), Date.now()]
            );
          }
        }
        if (reactionsSignature !== lastReactionsSignature) {
          // 当前状态是权威快照；仅互动状态变化时才替换，普通业务写入不会反复扫描该表。
          await connection.execute('DELETE FROM note_reactions');
          for (const item of normalized.reactions) {
            await connection.execute(
              'INSERT INTO note_reactions (user_id, note_id, liked, collected, updated_at) VALUES (?, ?, ?, ?, ?)',
              [item.userId, item.noteId, item.liked ? 1 : 0, item.collected ? 1 : 0, item.updatedAt]
            );
          }
        }
        await connection.commit();
        lastOrdersSignature = ordersSignature;
        lastEntitlementsSignature = entitlementsSignature;
        lastReactionsSignature = reactionsSignature;
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

module.exports = {
  load, save, flush, close, get, mysqlEnabled,
  _testing: { appStateSnapshot, normalizedStateSnapshot },
};
