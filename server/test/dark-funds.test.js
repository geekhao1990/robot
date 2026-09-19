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
  const wechatPay = {
    requireConfig: () => ({}), createJsapiPayment: async () => ({ prepayId: 'prepay-id', payment: {} }),
    queryPayment: async (id) => ({
      trade_state: 'SUCCESS', appid: process.env.WECHAT_APP_ID, mchid: process.env.WECHAT_PAY_MCH_ID,
      out_trade_no: id, transaction_id: 'wx-transaction', amount: { total: 100, currency: 'CNY' },
    }),
    verifyAndDecryptNotification: () => null,
  };
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
    '../membership': require('../src/membership'), '../wechat-pay': wechatPay, '../util': require('../src/util'),
    '../trading-date': require('../src/trading-date'), '../dark-fund-orders': require('../src/dark-fund-orders'),
    '../collector-client': collector, '../collector-images': collectorImages,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/routes/payment.js'), 'utf8'), {
    module: mod, require: (id) => dependencyMap[id] || require(id), process,
  });
  const router = createRouter();
  mod.exports(router, HttpError);
  const call = (method, url, body = {}, token = 'Bearer u1', extraHeaders = {}) => Promise.resolve().then(() => {
    const match = router.match(method, url);
    assert(match, `${method} ${url} route missing`);
    return match.handler({ body, headers: { authorization: token, ...extraHeaders }, query: {}, params: match.params, rawBody: '' });
  });
  return { data, call };
}

function successCallback(order) {
  return {
    order_id: order.id, stock_code: order.stockCode, stock_name: '永鼎股份', trading_date: order.tradeDate,
    captured_at: '2026-09-19T15:05:00+08:00', latest_price: 46.47, pct_change: 2.95, fund_unit: 1,
    main_net: 9.15, bright_net: 2.26, dark_net: 6.89, source: 'cache',
    images: { fund: { mime_type: 'image/png', data_base64: 'AA==' }, guide: { mime_type: 'image/jpeg', data_base64: 'AA==' } },
    analysis: { paragraph_1: '第一段', paragraph_2: '第二段', paragraph_3: '第三段' },
  };
}

test('latest trading date skips the 2026 Mid-Autumn holiday and weekend', () => {
  assert.equal(latestTradingDate(Date.parse('2026-09-26T04:00:00Z')), '2026-09-24');
});

test('query dispatches immediately and authenticated callback completes it idempotently', async () => {
  const { data, call } = setup();
  await assert.rejects(call('POST', '/api/dark-funds/orders', { stockCode: '123' }), { status: 400 });
  const created = await call('POST', '/api/dark-funds/orders', { stockCode: '600105' });
  assert.equal(created.status, 'QUEUED');
  assert.equal(created.ready, false);
  assert.equal(created.remaining, 1);
  await assert.rejects(call('POST', '/api/stock-analysis/callback', successCallback(data.darkFundOrders[0]), '', {}), { status: 401 });
  assert.equal((await call('POST', '/api/stock-analysis/callback', successCallback(data.darkFundOrders[0]), '', { 'x-stock-callback-token': 'callback-secret' })).ok, true);
  assert.equal(data.darkFundOrders[0].status, 'READY');
  assert.equal(data.notes[0].title, `永鼎股份（600105）｜${created.compactTradeDate}暗盘数据`);
  assert.equal(data.notes[0].content, '第一段\n\n第二段\n\n第三段');
  assert.deepEqual(data.notes[0].images, [
    'https://app.nankaitechschool.com/uploads/fund.png',
    'https://app.nankaitechschool.com/uploads/guide.jpg',
  ]);
  assert.equal((await call('POST', '/api/stock-analysis/callback', successCallback(data.darkFundOrders[0]), '', { 'x-stock-callback-token': 'callback-secret' })).duplicate, true);
  const viewed = await call('GET', `/api/dark-funds/orders/${created.orderId}`);
  assert.equal(viewed.unread, false);
  await assert.rejects(call('GET', `/api/dark-funds/orders/${created.orderId}`, {}, 'Bearer u2'), { status: 404 });
});

test('invalid or failed collector results do not silently complete an order', async () => {
  const { data, call } = setup();
  const created = await call('POST', '/api/dark-funds/orders', { stockCode: '600105' });
  const bad = successCallback(data.darkFundOrders[0]);
  bad.dark_net = 1;
  await assert.rejects(call('POST', '/api/stock-analysis/callback', bad, '', { 'x-stock-callback-token': 'callback-secret' }), { status: 400 });
  assert.equal(data.darkFundOrders[0].status, 'QUEUED');
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
