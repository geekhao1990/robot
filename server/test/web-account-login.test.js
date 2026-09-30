const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRouter, HttpError } = require('../src/router');

function setup() {
  const data = {
    users: [{ id: 'wx_example123', name: '测试用户', avatar: '/avatar.jpg', goldExpire: 0, serviceExpire: 0 }],
    userState: {}, notes: [{ id: 'n1', likes: 10, collects: 4 }], categories: [], invites: [], pointAccounts: {}, pointTransactions: [],
  };
  const db = { get: () => data, save: () => {} };
  const auth = {
    userIdFor: (authorization) => authorization === 'mini-token' ? 'wx_example123' : null,
    issue: (userId) => `token:${userId}`,
  };
  const mod = { exports: {} };
  const dependencies = {
    '../db': db,
    '../auth': auth,
    '../util': require('../src/util'),
    '../wechat': { code2Session: async () => ({ openid: 'unused' }) },
    '../web-wechat-login': { configured: () => false },
    '../note-access': { canViewNote: () => true },
    '../user-password': require('../src/user-password'),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/routes/app.js'), 'utf8'), {
    module: mod,
    require: (id) => dependencies[id] || require(id),
    process,
    Buffer,
  });
  const router = createRouter();
  mod.exports(router, HttpError);
  const call = (method, url, body = {}, authorization = '') => Promise.resolve().then(() => {
    const match = router.match(method, url);
    return match.handler({ body, headers: { authorization }, query: {}, params: match.params });
  });
  return { data, call };
}

test('mini-program user can set a password and log into Web with the same user ID', async () => {
  const { data, call } = setup();
  const updated = await call('PUT', '/api/me/profile', {
    name: '测试用户', avatar: '/avatar.jpg', password: 'safe-pass-123', confirmPassword: 'safe-pass-123',
  }, 'mini-token');
  assert.equal(updated.user.id, 'wx_example123');
  assert.equal(updated.user.webPasswordSet, true);
  assert.equal('webPasswordHash' in updated.user, false);
  assert.notEqual(data.users[0].webPasswordHash, 'safe-pass-123');

  const loggedIn = await call('POST', '/api/web/login', { userId: 'wx_example123', password: 'safe-pass-123' });
  assert.equal(loggedIn.token, 'token:wx_example123');
  assert.equal(loggedIn.user.id, 'wx_example123');
  await assert.rejects(call('POST', '/api/web/login', { userId: 'wx_example123', password: 'wrong-pass' }), { status: 401 });
});

test('password confirmation and minimum length are enforced', async () => {
  const { call } = setup();
  await assert.rejects(call('PUT', '/api/me/profile', {
    name: '测试用户', avatar: '/avatar.jpg', password: '123456', confirmPassword: '654321',
  }, 'mini-token'), { status: 400 });
  await assert.rejects(call('PUT', '/api/me/profile', {
    name: '测试用户', avatar: '/avatar.jpg', password: '123', confirmPassword: '123',
  }, 'mini-token'), { status: 400 });
});

test('reaction batch writes final states idempotently instead of toggling twice', async () => {
  const { data, call } = setup();
  const body = { items: [{ noteId: 'n1', liked: true, collected: true, updatedAt: 1000 }] };
  const first = await call('POST', '/api/reactions/batch', body, 'mini-token');
  const retry = await call('POST', '/api/reactions/batch', body, 'mini-token');
  assert.equal(first.applied, 1);
  assert.equal(retry.applied, 1);
  assert.equal(data.notes[0].likes, 11);
  assert.equal(data.notes[0].collects, 5);
  assert.equal(Boolean(data.userState.wx_example123.likes.n1), true);
  assert.equal(Boolean(data.userState.wx_example123.collects.n1), true);

  await call('POST', '/api/reactions/batch', {
    items: [{ noteId: 'n1', liked: false, collected: true, updatedAt: 2000 }],
  }, 'mini-token');
  assert.equal(data.notes[0].likes, 10);
  assert.equal(data.notes[0].collects, 5);
});
