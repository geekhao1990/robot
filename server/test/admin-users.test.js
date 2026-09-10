const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRouter, HttpError } = require('../src/router');

function setup() {
  const data = {
    users: [{ id: 'u1', name: '测试用户', goldExpire: 0 }],
    admins: [], notes: [], categories: [], userState: {}, withdrawals: [],
    pointAnomalies: [], paymentOrders: [], giftCards: [], adminOperationLogs: [],
  };
  const db = { get: () => data, save: () => {} };
  const mod = { exports: {} };
  const dependencyMap = {
    '../db': db,
    '../auth': { isAdmin: (token) => token === 'admin', issueAdmin: () => 'admin' },
    '../util': require('../src/util'),
    '../content-types': require('../src/content-types'),
    '../membership': require('../src/membership'),
    '../resource-links': require('../src/resource-links'),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/routes/admin.js'), 'utf8'), {
    module: mod,
    require: (id) => dependencyMap[id] || require(id),
    process,
  });
  const router = createRouter();
  mod.exports(router, HttpError);
  const call = (method, url, body = {}, token = 'admin') => Promise.resolve().then(() => {
    const match = router.match(method, url);
    return match.handler({ body, headers: { authorization: token }, query: {}, params: match.params });
  });
  return { data, call };
}

test('admin gold entitlement enforces open and cancel states', async () => {
  const { data, call } = setup();
  await assert.rejects(call('PUT', '/api/admin/users/u1/gold', { action: 'open' }, ''), { status: 401 });
  const before = Date.now();
  const opened = await call('PUT', '/api/admin/users/u1/gold', { action: 'open' });
  assert(opened.goldExpire >= before + 360 * 24 * 3600 * 1000);
  await assert.rejects(call('PUT', '/api/admin/users/u1/gold', { action: 'open' }), { status: 409 });
  const cancelled = await call('PUT', '/api/admin/users/u1/gold', { action: 'cancel' });
  assert.equal(cancelled.goldExpire, 0);
  assert.equal(data.users[0].goldExpire, 0);
  await assert.rejects(call('PUT', '/api/admin/users/u1/gold', { action: 'cancel' }), { status: 409 });
});

test('admin user endpoint no longer allows opening a monthly VIP directly', async () => {
  const { call } = setup();
  await assert.rejects(call('PUT', '/api/admin/users/u1/vip', { plan: 'month' }), { status: 400 });
});
