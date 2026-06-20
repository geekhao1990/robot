// server/src/auth.js —— 小程序端登录 token 共享存储
const appTokens = new Map(); // token -> userId

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

module.exports = { appTokens, issue, userIdFor };
