const crypto = require('crypto');

const MIN_LENGTH = 6;
const MAX_LENGTH = 64;

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < MIN_LENGTH) throw new Error(`密码至少${MIN_LENGTH}位`);
  if (value.length > MAX_LENGTH) throw new Error(`密码最多${MAX_LENGTH}位`);
  return value;
}

function setPassword(user, password) {
  const value = validatePassword(password);
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(value, salt, 64).toString('hex');
  user.webPasswordSalt = salt;
  user.webPasswordHash = hash;
  user.webPasswordUpdatedAt = Date.now();
}

function verifyPassword(user, password) {
  const salt = String(user && user.webPasswordSalt || '');
  const stored = String(user && user.webPasswordHash || '');
  if (!salt || !/^[a-f0-9]{128}$/i.test(stored)) return false;
  let actual;
  try {
    actual = crypto.scryptSync(String(password || ''), salt, 64);
  } catch (_) {
    return false;
  }
  const expected = Buffer.from(stored, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function generateTemporaryPassword() {
  return 'Aa9!' + crypto.randomBytes(15).toString('hex');
}

module.exports = { MIN_LENGTH, MAX_LENGTH, setPassword, verifyPassword, generateTemporaryPassword };
