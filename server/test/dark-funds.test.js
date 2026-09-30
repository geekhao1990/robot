const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRouter, HttpError } = require('../src/router');
const { latestTradingDate } = require('../src/trading-date');

function setup(options = {}) {
  const data = {
    users: [
      { id: 'u1', name: '查询用户', wxOpenId: 'openid-1', vip: false, darkFundEnabled: true, darkFundRemaining: 2 },
      { id: 'u2', name: '其他用户', wxOpenId: 'openid-2', vip: false, darkFundEnabled: false, darkFundRemaining: 0 },
    ],
    notes: [], paymentOrders: [], darkFundOrders: [],
  };
  const db = { get: () => data, save: () => {}, flush: async () => {} };
  const collector = {
    callbackAuthorized: (headers) => headers['x-stock-callback-token'] === 'callback-secret',
    dispatchStockAnalysis: async (order) => {
      if (options.dispatchError) throw Object.assign(new Error('采集机离线'), { status: 502 });
      assert.match(order.tradeDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(typeof order.createdAt, 'number');
      return { ok: true, order_id: order.id, status: 'queued' };
    },
  };
  const collectorImages = {
    persistCollectorImages: () => [
      'https://app.nankaitechschool.com/uploads/fund.png',
      'https://app.nankaitechschool.com/uploads/guide.jpg',
    ],
  };
  const mod = { exports: {} };
  const dependencyMap = {
    '../db': db,
    '../auth': { userIdFor: (token) => token === 'Bearer u2' ? 'u2' : (token === 'Bearer u1' ? 'u1' : ''), isAdmin: (token) => token === 'admin' },
    '../membership': require('../src/membership'), '../util': require('../src/util'),
    '../trading-date': require('../src/trading-date'), '../dark-fund-orders': require('../src/dark-fund-orders'),
    '../collector-client': collector, '../collector-images': collectorImages,
    '../notifications': require('../src/notifications'),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/routes/payment.js'), 'utf8'), {
    module: mod, require: (id) => dependencyMap[id] || require(id), process,
  });
  const router = createRouter();
  mod.exports(router, HttpError);
  const call = (method, url, body = {}, token = 'Bearer u1', extraHeaders = {}, query = {}) => Promise.resolve().then(() => {
    const match = router.match(method, url);
    assert(match, `${method} ${url} route missing`);
    return match.handler({ body, headers: { authorization: token, ...extraHeaders }, query, params: match.params, rawBody: '' });
  });
  return { data, call };
}

function successCallback(order) {
  return {
    order_id: order.id, stock_code: order.stockCode, stock_name: '永鼎股份', trading_date: order.tradeDate,
    captured_at: '2026-09-19T15:05:00+08:00', latest_price: 46.47, pct_change: 2.95, fund_unit: 1,
    main_net: 9.15, bright_net: 2.26, dark_net: 6.89, source: 'cache',
    images: { fund: { mime_type: 'image/png', data_base64: 'AA==' }, guide: { mime_type: 'image/jpeg', data_base64: 'AA==' } },
    analysis: {
      title: '【暗盘追踪】明暗同步流入，资金表现如何？', score: 9.5,
      paragraph_1: '第一段', paragraph_2: '第二段', paragraph_3: '第三段',
    },
  };
}

test('latest trading date skips the 2026 Mid-Autumn holiday and weekend', () => {
  assert.equal(latestTradingDate(Date.parse('2026-09-26T04:00:00Z')), '2026-09-24');
});

test('dark fund order history uses fixed pages of 10 while preserving the legacy list response', async () => {
  const { data, call } = setup();
  for (let index = 1; index <= 23; index += 1) {
    data.darkFundOrders.push({
      id: `DF${index}`,
      userId: 'u1',
      stockCode: String(600000 + index),
      tradeDate: '2026-09-30',
      status: index <= 2 ? 'READY' : 'QUEUED',
      viewedAt: 0,
      createdAt: index,
    });
  }
  const second = await call('GET', '/api/dark-funds/orders', {}, 'Bearer u1', {}, { page: '2' });
  assert.equal(second.list.length, 10);
  assert.equal(second.page, 2);
  assert.equal(second.pageSize, 10);
  assert.equal(second.total, 23);
  assert.equal(second.totalPages, 3);
  assert.equal(second.unread, 2);
  assert.equal(second.list[0].id, 'DF13');
  const legacy = await call('GET', '/api/dark-funds/orders');
  assert.equal(Array.isArray(legacy), true);
  assert.equal(legacy.length, 23);
});

test('online membership payment routes are removed', () => {
  const data = { users: [] };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/routes/payment.js'), 'utf8'), {
    module: mod,
    require: (id) => ({
      '../db': { get: () => data },
      '../auth': {},
      '../membership': require('../src/membership'),
      '../trading-date': require('../src/trading-date'),
      '../dark-fund-orders': require('../src/dark-fund-orders'),
      '../collector-client': { callbackAuthorized: () => false, dispatchStockAnalysis: async () => ({}) },
      '../collector-images': { persistCollectorImages: () => [] },
      '../notifications': require('../src/notifications'),
    }[id] || require(id)),
    process,
  });
  const router = createRouter();
  mod.exports(router, HttpError);
  assert.equal(router.match('POST', '/api/payments/orders'), null);
  assert.equal(router.match('POST', '/api/payments/notify'), null);
});

test('query dispatches immediately and authenticated callback completes it idempotently', async () => {
  const { data, call } = setup();
  const quota = await call('GET', '/api/dark-funds/trade-date');
  assert.equal(quota.remaining, 2);
  assert.equal(quota.expiringRemaining, 0);
  assert.equal(quota.permanentRemaining, 2);
  await assert.rejects(call('POST', '/api/dark-funds/orders', { stockCode: '123' }), { status: 400 });
  const created = await call('POST', '/api/dark-funds/orders', { stockCode: '600105' });
  assert.equal(created.status, 'QUEUED');
  assert.equal(created.ready, false);
  assert.equal(created.remaining, 1);
  assert.equal(created.expiringRemaining, 0);
  assert.equal(created.permanentRemaining, 1);
  await assert.rejects(call('POST', '/api/stock-analysis/callback', successCallback(data.darkFundOrders[0]), '', {}), { status: 401 });
  assert.equal((await call('POST', '/api/stock-analysis/callback', successCallback(data.darkFundOrders[0]), '', { 'x-stock-callback-token': 'callback-secret' })).ok, true);
  assert.equal(data.darkFundOrders[0].status, 'READY');
  assert.equal(data.systemNotifications.u1.length, 1);
  assert.equal(data.systemNotifications.u1[0].type, 'dark_ready');
  assert.equal(data.systemNotifications.u1[0].targetType, 'dark_history');
  assert.equal(data.notes[0].title, '【暗盘追踪】明暗同步流入，资金表现如何？');
  assert.equal(data.notes[0].visibility, 'private');
  assert.equal(data.notes[0].ownerUserId, 'u1');
  assert.equal(data.notes[0].content, '第一段\n\n第二段\n\n第三段');
  assert.deepEqual(data.notes[0].tags, ['暗盘资金', '600105', 'score9.5']);
  assert.deepEqual(data.notes[0].images, [
    'https://app.nankaitechschool.com/uploads/fund.png',
    'https://app.nankaitechschool.com/uploads/guide.jpg',
  ]);
  const refreshed = successCallback(data.darkFundOrders[0]);
  refreshed.analysis.title = '【暗盘追踪】新标题';
  refreshed.analysis.score = 8;
  assert.equal((await call('POST', '/api/stock-analysis/callback', refreshed, '', { 'x-stock-callback-token': 'callback-secret' })).duplicate, true);
  assert.equal(data.notes[0].title, '【暗盘追踪】新标题');
  assert.deepEqual(data.notes[0].tags, ['暗盘资金', '600105', 'score8']);
  const viewed = await call('GET', `/api/dark-funds/orders/${created.orderId}`);
  assert.equal(viewed.unread, false);
  await assert.rejects(call('GET', `/api/dark-funds/orders/${created.orderId}`, {}, 'Bearer u2'), { status: 404 });
});

test('same user and request_id returns the original order without consuming quota twice', async () => {
  const { data, call } = setup();
  const body = { stockCode: '600105', request_id: 'df_20260930_same_request' };
  const first = await call('POST', '/api/dark-funds/orders', body);
  const second = await call('POST', '/api/dark-funds/orders', body);
  assert.equal(second.orderId, first.orderId);
  assert.equal(second.duplicate, true);
  assert.equal(data.darkFundOrders.length, 1);
  assert.equal(data.users[0].darkFundRemaining, 1);
  await assert.rejects(call('POST', '/api/dark-funds/orders', { stockCode: '600106', request_id: body.request_id }), { status: 409 });
});

test('invalid or failed collector results do not silently complete an order', async () => {
  const { data, call } = setup();
  const created = await call('POST', '/api/dark-funds/orders', { stockCode: '600105' });
  const bad = successCallback(data.darkFundOrders[0]);
  bad.dark_net = 1;
  await assert.rejects(call('POST', '/api/stock-analysis/callback', bad, '', { 'x-stock-callback-token': 'callback-secret' }), { status: 400 });
  assert.equal(data.darkFundOrders[0].status, 'FAILED');
  assert.match(data.darkFundOrders[0].collectorError, /加总存在误差/);
  assert.equal(data.users[0].darkFundRemaining, 2);
  assert.equal((await call('POST', '/api/stock-analysis/callback', {
    order_id: created.orderId, stock_code: '600105', status: 'failed', error: '手机离线',
  }, '', { 'x-stock-callback-token': 'callback-secret' })).ok, true);
  assert.equal(data.darkFundOrders[0].status, 'FAILED');
  assert.equal(data.users[0].darkFundRemaining, 2);
});

test('a completed legacy order can receive its missing two images exactly once', async () => {
  const { data, call } = setup();
  const created = await call('POST', '/api/dark-funds/orders', { stockCode: '600105' });
  const payload = successCallback(data.darkFundOrders[0]);
  await call('POST', '/api/stock-analysis/callback', payload, '', { 'x-stock-callback-token': 'callback-secret' });
  const order = data.darkFundOrders[0];
  delete order.collectorResult.images;
  order.snapshot.result.images = [];
  order.snapshot.note.images = [];
  data.notes[0].images = [];
  data.notes[0].cover = '';
  const repaired = await call('POST', '/api/stock-analysis/callback', payload, '', { 'x-stock-callback-token': 'callback-secret' });
  assert.equal(repaired.imagesUpdated, true);
  assert.equal(data.notes[0].images.length, 2);
  const duplicate = await call('POST', '/api/stock-analysis/callback', payload, '', { 'x-stock-callback-token': 'callback-secret' });
  assert.equal(duplicate.imagesUpdated, false);
});

test('dispatch failure refunds quota and records a failed ticket', async () => {
  const { data, call } = setup({ dispatchError: true });
  await assert.rejects(call('POST', '/api/dark-funds/orders', { stockCode: '600105' }), /采集机离线/);
  assert.equal(data.users[0].darkFundRemaining, 2);
  assert.equal(data.darkFundOrders[0].status, 'DISPATCH_FAILED');
});

test('dark fund entry is hidden by default and exhausted quota blocks query', async () => {
  const { data, call } = setup();
  await assert.rejects(call('GET', '/api/dark-funds/trade-date', {}, 'Bearer u2'), { status: 403 });
  data.users[0].darkFundRemaining = 0;
  await assert.rejects(call('POST', '/api/dark-funds/orders', { stockCode: '600105' }), { status: 403 });
});
