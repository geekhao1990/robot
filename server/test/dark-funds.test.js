const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRouter, HttpError } = require('../src/router');
const { latestTradingDate } = require('../src/trading-date');

function setup() {
  const data = {
    users: [
      { id: 'u1', name: '查询用户', wxOpenId: 'openid-1', vip: false, darkFundEnabled: true, darkFundRemaining: 2 },
      { id: 'u2', name: '其他用户', wxOpenId: 'openid-2', vip: false, darkFundEnabled: false, darkFundRemaining: 0 },
    ],
    notes: [],
    paymentOrders: [],
    darkFundOrders: [],
  };
  const db = { get: () => data, save: () => {} };
  const wechatPay = {
    requireConfig: () => ({}),
    createJsapiPayment: async () => ({
      prepayId: 'prepay-id',
      payment: { timeStamp: '1', nonceStr: 'nonce', package: 'prepay_id=x', signType: 'RSA', paySign: 'sign' },
    }),
    queryPayment: async (id) => ({
      trade_state: 'SUCCESS',
      appid: process.env.WECHAT_APP_ID,
      mchid: process.env.WECHAT_PAY_MCH_ID,
      out_trade_no: id,
      transaction_id: 'wx-transaction',
      amount: { total: 100, currency: 'CNY' },
    }),
    verifyAndDecryptNotification: () => null,
  };
  const mod = { exports: {} };
  const dependencyMap = {
    '../db': db,
    '../auth': {
      userIdFor: (token) => token === 'Bearer u2' ? 'u2' : (token === 'Bearer u1' ? 'u1' : ''),
      isAdmin: (token) => token === 'admin',
    },
    '../membership': require('../src/membership'),
    '../wechat-pay': wechatPay,
    '../util': require('../src/util'),
    '../trading-date': require('../src/trading-date'),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/routes/payment.js'), 'utf8'), {
    module: mod,
    require: (id) => dependencyMap[id] || require(id),
    process,
  });
  const router = createRouter();
  mod.exports(router, HttpError);
  const call = (method, url, body = {}, token = 'Bearer u1') => Promise.resolve().then(() => {
    const match = router.match(method, url);
    assert(match, `${method} ${url} route missing`);
    return match.handler({ body, headers: { authorization: token }, query: {}, params: match.params, rawBody: '' });
  });
  return { data, call };
}

test('latest trading date skips the 2026 Mid-Autumn holiday and weekend', () => {
  const holidaySaturday = Date.parse('2026-09-26T04:00:00Z');
  assert.equal(latestTradingDate(holidaySaturday), '2026-09-24');
});

test('entitlement query creates a pending ticket, then admin completion notifies the user', async () => {
  const { data, call } = setup();
  await assert.rejects(call('POST', '/api/dark-funds/orders', { stockCode: '123' }), { status: 400 });
  const created = await call('POST', '/api/dark-funds/orders', { stockCode: '600105' });
  assert.equal(created.amount, 0);
  assert.equal(created.status, 'PENDING');
  assert.equal(created.ready, false);
  assert.equal(created.remaining, 1);
  assert.equal(created.stockCode, '600105');
  assert.equal(created.snapshot, null);
  assert.equal(data.notes.length, 0);
  assert.equal(data.users[0].darkFundRemaining, 1);
  const pending = await call('GET', '/api/dark-funds/orders');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].unread, false);
  await assert.rejects(call('GET', `/api/dark-funds/orders/${created.orderId}`), { status: 409 });
  await assert.rejects(call('PUT', `/api/admin/dark-fund-orders/${created.orderId}/complete`, { images: ['/uploads/result.png'] }, ''), { status: 401 });
  const completed = await call('PUT', `/api/admin/dark-fund-orders/${created.orderId}/complete`, {
    images: ['/uploads/result.png'],
    content: '暗盘资金查询结果',
  }, 'admin');
  assert.equal(completed.status, 'READY');
  assert.equal(completed.unread, true);
  assert.equal(completed.snapshot.note.visibility, 'public');
  assert.equal(completed.snapshot.note.authorId, 'u1787979756047');
  assert.equal(completed.snapshot.note.author.name, '暗盘');
  assert.equal(data.notes[0].id, completed.noteId);
  assert.equal(data.notes[0].visible, true);
  const ready = await call('GET', '/api/dark-funds/orders');
  assert.equal(ready[0].unread, true);
  const viewed = await call('GET', `/api/dark-funds/orders/${created.orderId}`);
  assert.equal(viewed.unread, false);
  assert.equal((await call('GET', '/api/dark-funds/orders'))[0].unread, false);
  await assert.rejects(call('GET', `/api/dark-funds/orders/${created.orderId}`, {}, 'Bearer u2'), { status: 404 });
});

test('dark fund entry is hidden by default and exhausted quota blocks query', async () => {
  const { data, call } = setup();
  await assert.rejects(call('GET', '/api/dark-funds/trade-date', {}, 'Bearer u2'), { status: 403 });
  data.users[0].darkFundRemaining = 0;
  await assert.rejects(call('POST', '/api/dark-funds/orders', { stockCode: '600105' }), { status: 403 });
});
