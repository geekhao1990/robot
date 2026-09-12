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
    pointAnomalies: [], paymentOrders: [], darkFundOrders: [], giftCards: [], adminOperationLogs: [],
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
    '../deepseek-vision': require('../src/deepseek-vision'),
    '../voice-alert': { notifyQuestionableOrder: async () => ({ sent: false, configured: false }) },
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

test('only admin can inspect dark fund query records', async () => {
  const { data, call } = setup();
  data.darkFundOrders.push({ id: 'DF1', userId: 'u1', status: 'SUCCESS', snapshot: { note: { title: '私有快照' } }, createdAt: 1 });
  await assert.rejects(call('GET', '/api/admin/dark-fund-orders', {}, ''), { status: 401 });
  const rows = await call('GET', '/api/admin/dark-fund-orders');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].snapshot.note.title, '私有快照');
});

test('admin controls dark fund entry and can set exact remaining quota', async () => {
  const { data, call } = setup();
  await assert.rejects(call('PUT', '/api/admin/users/u1/dark-funds', { action: 'open' }, ''), { status: 401 });
  const opened = await call('PUT', '/api/admin/users/u1/dark-funds', { action: 'open' });
  assert.equal(opened.darkFundEnabled, true);
  assert.equal(opened.darkFundRemaining, 10);
  await assert.rejects(call('PUT', '/api/admin/users/u1/dark-funds', { action: 'open' }), { status: 409 });
  const quota = await call('PUT', '/api/admin/users/u1/dark-funds/quota', { remaining: 23 });
  assert.equal(quota.darkFundRemaining, 23);
  assert.equal(data.users[0].darkFundRemaining, 23);
  await assert.rejects(call('PUT', '/api/admin/users/u1/dark-funds/quota', { remaining: -1 }), { status: 400 });
  const closed = await call('PUT', '/api/admin/users/u1/dark-funds', { action: 'cancel' });
  assert.equal(closed.darkFundEnabled, false);
});

test('admin work order review validates editable AI fields and completes the draft text', async () => {
  const { data, call } = setup();
  data.darkFundOrders.push({ id: 'DF-AI-1', userId: 'u1', stockCode: '600410', tradeDate: '2026-09-11', status: 'PENDING', createdAt: 1789000000000 });
  const response = await call('POST', '/api/admin/dark-fund-orders/DF-AI-1/ai-review', {
    imageUrl: '/uploads/test.jpg',
    analysis: {
      stockName: '华胜天成', capturedAt: '11:24', quoteType: '盘中', price: 20.48,
      pctChange: -9.98, turnoverAmount: 8.16, turnoverAmountUnit: '万元', turnoverRate: 5.25,
      unit: '亿元', mainNet: -16.98, visibleNet: -9.73, darkNet: -7.25, retailNet: 16.98,
    },
  });
  assert.equal(response.result.validation.passed, true);
  assert.match(response.draftText, /华胜天成（600410）/);
  assert.doesNotMatch(response.draftText, /【|】/);
  assert.equal(data.darkFundOrders[0].aiReviewStatus, 'PASS');
});
