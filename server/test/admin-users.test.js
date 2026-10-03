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
    '../dark-fund-orders': require('../src/dark-fund-orders'),
    '../gold-finger-sync': { getStatus: () => ({ enabled: false, configured: false, running: false, schedule: [], state: null }), manualSync: async () => ({}) },
    '../notifications': require('../src/notifications'),
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
  assert.equal(opened.darkFundManualRemaining, 5);
  await assert.rejects(call('PUT', '/api/admin/users/u1/gold', { action: 'open' }), { status: 409 });
  const cancelled = await call('PUT', '/api/admin/users/u1/gold', { action: 'cancel' });
  assert.equal(cancelled.goldExpire, 0);
  assert.equal(data.users[0].goldExpire, 0);
  await assert.rejects(call('PUT', '/api/admin/users/u1/gold', { action: 'cancel' }), { status: 409 });
});

test('admin can set a custom service package expiry date for legacy subscribers', async () => {
  const { data, call } = setup();
  await assert.rejects(call('PUT', '/api/admin/users/u1/service', { action: 'set', expireDate: '2099-12-31' }, ''), { status: 401 });
  const service = await call('PUT', '/api/admin/users/u1/service', { action: 'set', expireDate: '2099-12-31' });
  assert.equal(service.servicePlan, 'service_custom');
  assert.equal(service.serviceExpire, Date.parse('2099-12-31T23:59:59.999+08:00'));
  assert.equal(service.darkFundServiceRemaining, 15);
  assert.equal(service.darkFundEnabled, true);
  assert.equal(data.users[0].servicePlan, 'service_custom');
  await assert.rejects(call('PUT', '/api/admin/users/u1/service', { action: 'set', expireDate: '2099-02-31' }), { status: 400 });
  const cancelled = await call('PUT', '/api/admin/users/u1/service', { action: 'cancel' });
  assert.equal(cancelled.serviceExpire, 0);
  assert.equal(cancelled.servicePlan, '');
  assert.equal(cancelled.darkFundServiceRemaining, 0);
});

test('admin can mark a manually dated service package as an annual plan', async () => {
  const { data, call } = setup();
  const service = await call('PUT', '/api/admin/users/u1/service', {
    action: 'set',
    expireDate: '2099-12-31',
    plan: 'service_year',
  });
  assert.equal(service.servicePlan, 'service_year');
  assert.equal(service.darkFundServiceRemaining, 15);
  assert.equal(data.users[0].servicePlan, 'service_year');
  await assert.rejects(call('PUT', '/api/admin/users/u1/service', {
    action: 'set',
    expireDate: '2099-12-31',
    plan: 'calendar_month',
  }), { status: 400 });
});

test('legacy VIP administration endpoint is removed', async () => {
  const { call } = setup();
  await assert.rejects(call('PUT', '/api/admin/users/u1/vip', { plan: 'month' }), /handler/);
});

test('admin can maintain close data source without exposing or clearing its password', async () => {
  const { data, call } = setup();
  data.notes.push({ id: 'gold-entry', type: 'gold' });
  data.settings = { featuredNoteId: 'gold-entry' };
  const payload = {
    rewardedAdEnabled: true,
    featuredNoteId: 'gold-entry',
    hotSearch: [],
    darkFundCloseApiUrl: 'https://fundflow.shiluan.space/',
    darkFundCloseUsername: ' test15 ',
    darkFundClosePassword: 'test-password',
  };
  await assert.rejects(call('PUT', '/api/admin/settings', payload, ''), { status: 401 });
  const saved = await call('PUT', '/api/admin/settings', payload);
  assert.equal(data.settings.darkFundCloseApiUrl, 'https://fundflow.shiluan.space');
  assert.equal(data.settings.darkFundCloseUsername, 'test15');
  assert.equal(data.settings.darkFundClosePassword, 'test-password');
  assert.equal(saved.darkFundClosePasswordConfigured, true);
  assert.equal(Object.prototype.hasOwnProperty.call(saved, 'darkFundClosePassword'), false);

  const kept = await call('PUT', '/api/admin/settings', { ...payload, darkFundClosePassword: '' });
  assert.equal(data.settings.darkFundClosePassword, 'test-password');
  assert.equal(kept.darkFundClosePasswordConfigured, true);
  const fetched = await call('GET', '/api/admin/settings');
  assert.equal(fetched.darkFundCloseUsername, 'test15');
  assert.equal(Object.prototype.hasOwnProperty.call(fetched, 'darkFundClosePassword'), false);
});

test('admin can save a trimmed user remark with a length limit', async () => {
  const { data, call } = setup();
  await assert.rejects(call('PUT', '/api/admin/users/u1', { remark: '重点客户' }, ''), { status: 401 });
  const updated = await call('PUT', '/api/admin/users/u1', { remark: '  历史订阅客户  ' });
  assert.equal(updated.remark, '历史订阅客户');
  assert.equal(data.users[0].remark, '历史订阅客户');
  await assert.rejects(call('PUT', '/api/admin/users/u1', { remark: 'a'.repeat(201) }), { status: 400 });
});

test('admin can bind a unique phone number for SaaS SMS login', async () => {
  const { data, call } = setup();
  const updated = await call('PUT', '/api/admin/users/u1', { phone: '138 0013 8000' });
  assert.equal(updated.phone, '13800138000');
  assert.equal(data.users[0].phone, '13800138000');
  await assert.rejects(call('PUT', '/api/admin/users/u1', { phone: '123' }), { status: 400 });
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

test('admin controls decision pioneer independently from close queries', async () => {
  const { data, call } = setup();
  await assert.rejects(call('PUT', '/api/admin/users/u1/decision-pioneer', { action: 'open' }), { status: 409 });
  data.users[0].darkFundEnabled = true;
  await assert.rejects(call('PUT', '/api/admin/users/u1/decision-pioneer', { action: 'open' }, ''), { status: 401 });
  const opened = await call('PUT', '/api/admin/users/u1/decision-pioneer', { action: 'open' });
  assert.equal(opened.decisionPioneerEnabled, true);
  await assert.rejects(call('PUT', '/api/admin/users/u1/decision-pioneer', { action: 'open' }), { status: 409 });
  const closed = await call('PUT', '/api/admin/users/u1/decision-pioneer', { action: 'cancel' });
  assert.equal(closed.decisionPioneerEnabled, false);
});
