// server/src/auth.js —— 持久化登录令牌，服务器重启后仍然有效。
const crypto = require('crypto');
const db = require('./db');
const APP_TTL = 30 * 24 * 60 * 60 * 1000;
const ADMIN_TTL = 12 * 60 * 60 * 1000;

function sessions() {
  const data = db.get();
  data.sessions = data.sessions || { app: {}, admin: {} };
  data.sessions.app = data.sessions.app || {};
  data.sessions.admin = data.sessions.admin || {};
  return data.sessions;
}

function gen(prefix) {
  return prefix + '_' + crypto.randomBytes(32).toString('hex');
}

function issue(userId) {
  const token = gen('app');
  sessions().app[token] = { userId, createdAt: Date.now(), expiresAt: Date.now() + APP_TTL };
  db.save();
  return token;
}

function userIdFor(authorization) {
  const token = (authorization || '').replace(/^Bearer\s+/i, '');
  const record = sessions().app[token];
  if (!record) return null;
  if (record.expiresAt <= Date.now()) {
    delete sessions().app[token];
    db.save();
    return null;
  }
  return record.userId;
}

// 管理后台 token
function issueAdmin(username) {
  const token = gen('adm');
  sessions().admin[token] = { username: username || 'admin', createdAt: Date.now(), expiresAt: Date.now() + ADMIN_TTL };
  db.save();
  return token;
}

function isAdmin(authorization) {
  const token = (authorization || '').replace(/^Bearer\s+/i, '');
  return !!adminUserFor(authorization);
}

function adminUserFor(authorization) {
  const token = (authorization || '').replace(/^Bearer\s+/i, '');
  const record = sessions().admin[token];
  if (!record) return null;
  if (record.expiresAt <= Date.now()) {
    delete sessions().admin[token];
    db.save();
    return null;
  }
  return record.username;
}

module.exports = { issue, userIdFor, issueAdmin, isAdmin, adminUserFor };

