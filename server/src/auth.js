// server/src/auth.js —— 登录 token 共享存储
const appTokens = new Map(); // 小程序端 token -> userId
const adminTokens = new Set(); // 管理后台 token

function gen() {
  return 'app_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function issue(userId) {
  const token = gen();
  appTokens.set(token, userId);
  return token;
}

function userIdFor(authorization) {
  const token = (authorization || '').replace(/^Bearer\s+/i, '');
  return appTokens.get(token) || null;
}

// 管理后台 token
function issueAdmin() {
  const token = 'adm_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  adminTokens.add(token);
  return token;
}

function isAdmin(authorization) {
  const token = (authorization || '').replace(/^Bearer\s+/i, '');
  return adminTokens.has(token);
}

module.exports = { appTokens, issue, userIdFor, adminTokens, issueAdmin, isAdmin };

