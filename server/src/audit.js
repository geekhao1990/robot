const crypto = require('crypto');
const db = require('./db');
const auth = require('./auth');

function cleanValue(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, 500);
  if (depth >= 2) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => cleanValue(item, depth + 1));
  if (typeof value === 'object') {
    const result = {};
    Object.keys(value).slice(0, 30).forEach((key) => {
      result[key] = /password|secret|token|private|key/i.test(key) ? '[REDACTED]' : cleanValue(value[key], depth + 1);
    });
    return result;
  }
  return String(value).slice(0, 500);
}

function cleanBody(body) {
  return body && typeof body === 'object' ? cleanValue(body) : {};
}

function record(ctx, action, outcome = 'SUCCESS', error = '') {
  const username = auth.adminUserFor(ctx.headers && ctx.headers.authorization);
  if (!username) return;
  const data = db.get();
  data.adminOperationLogs = Array.isArray(data.adminOperationLogs) ? data.adminOperationLogs : [];
  data.adminOperationLogs.unshift({
    id: 'al_' + Date.now() + crypto.randomBytes(3).toString('hex'),
    username,
    method: action.method,
    path: action.path,
    outcome,
    body: cleanBody(ctx.body),
    ip: String(ctx.remoteAddress || ''),
    error: String(error || '').slice(0, 500),
    createdAt: Date.now(),
  });
  data.adminOperationLogs = data.adminOperationLogs.slice(0, 10000);
  db.save();
}

module.exports = { record };
