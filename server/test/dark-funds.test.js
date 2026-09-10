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
      { id: 'u1', name: '查询用户', wxOpenId: 'openid-1', vip: false },
      { id: 'u2', name: '其他用户', wxOpenId: 'openid-2', vip: false },
    ],
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
    '../auth': { userIdFor: (token) => token === 'Bearer u2' ? 'u2' : (token === 'Bearer u1' ? 'u1' : '') },
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

test('dark fund payment creates a private one-yuan note snapshot', async () => {
  const oldAppId = process.env.WECHAT_APP_ID;
  const oldMchId = process.env.WECHAT_PAY_MCH_ID;
  process.env.WECHAT_APP_ID = 'app-id';
  process.env.WECHAT_PAY_MCH_ID = 'mch-id';
  try {
    const { data, call } = setup();
    await assert.rejects(call('POST', '/api/dark-funds/orders', { stockCode: '123' }), { status: 400 });
    const created = await call('POST', '/api/dark-funds/orders', { stockCode: '600105' });
    assert.equal(created.amount, 100);
    assert.equal(created.stockCode, '600105');
    assert.equal((await call('GET', '/api/dark-funds/orders')).length, 0);

    const paid = await call('GET', `/api/dark-funds/orders/${created.orderId}`);
    assert.equal(paid.status, 'SUCCESS');
    assert.equal(paid.snapshot.note.title.includes('600105'), true);
    assert.equal(paid.snapshot.note.visibility, 'private');
    assert.equal(paid.snapshot.note.ownerId, 'u1');
    assert.deepEqual(Array.from(paid.snapshot.note.images), []);
    assert.equal(data.users[0].vip, false, '暗盘订单不得开通会员');
    assert.equal((await call('GET', '/api/dark-funds/orders')).length, 1);
    await assert.rejects(call('GET', `/api/dark-funds/orders/${created.orderId}`, {}, 'Bearer u2'), { status: 404 });
  } finally {
    if (oldAppId === undefined) delete process.env.WECHAT_APP_ID; else process.env.WECHAT_APP_ID = oldAppId;
    if (oldMchId === undefined) delete process.env.WECHAT_PAY_MCH_ID; else process.env.WECHAT_PAY_MCH_ID = oldMchId;
  }
});
