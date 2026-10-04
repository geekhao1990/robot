const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRouter, HttpError } = require('../src/router');

function setup(options = {}) {
  const data = {
    users: [{
      id: 'u1', name: '新用户', wxOpenId: 'openid-u1', darkFundEnabled: false,
      darkFundRemaining: 0, darkFundManualRemaining: 0, darkFundServiceRemaining: 0,
    }],
    paymentOrders: [],
  };
  const db = { get: () => data, save: () => {} };
  const paymentInputs = [];
  const payment = {
    requireConfig: () => true,
    createJsapiPayment: async (input) => {
      assert.equal(input.openid, 'openid-u1');
      paymentInputs.push(input);
      return {
        prepayId: 'wx-prepay-id',
        payment: { timeStamp: '1', nonceStr: 'nonce', package: 'prepay_id=wx-prepay-id', signType: 'RSA', paySign: 'signature' },
      };
    },
    queryPayment: async (id) => ({
      trade_state: options.tradeState || 'SUCCESS',
      appid: 'wx-test-app', mchid: '1900000001', out_trade_no: id,
      transaction_id: 'wx-transaction-1', amount: { total: options.amount || 99, currency: 'CNY' },
    }),
    verifyAndDecryptNotification: () => options.notification || null,
  };
  const mod = { exports: {} };
  const dependencies = {
    '../db': db,
    '../auth': { userIdFor: (token) => token === 'Bearer u1' ? 'u1' : '' },
    '../wechat-pay': payment,
    '../membership': require('../src/membership'),
    '../util': require('../src/util'),
    '../notifications': require('../src/notifications'),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/routes/dark-fund-payment.js'), 'utf8'), {
    module: mod,
    require: (id) => dependencies[id] || require(id),
    process: { env: { WECHAT_APP_ID: 'wx-test-app', WECHAT_PAY_MCH_ID: '1900000001' } },
  });
  const router = createRouter();
  mod.exports(router, HttpError);
  const call = (method, url, body = {}, token = 'Bearer u1', headers = {}) => Promise.resolve().then(() => {
    const match = router.match(method, url);
    assert(match, `${method} ${url} route missing`);
    return match.handler({ body, rawBody: JSON.stringify(body), headers: { authorization: token, ...headers }, params: match.params, query: {} });
  });
  return { data, call, paymentInputs };
}

test('0.99 dark-fund payment creates a native mini-program payment order', async () => {
  const { data, call, paymentInputs } = setup();
  const created = await call('POST', '/api/dark-funds/purchase-orders');
  assert.equal(created.amount, 99);
  assert.equal(paymentInputs[0].amount, 99);
  assert.equal(paymentInputs[0].description, '暗盘单次查询');
  assert.equal(created.payment.signType, 'RSA');
  assert.equal(data.paymentOrders.length, 1);
  assert.equal(data.paymentOrders[0].product, 'dark_fund_once');
  assert.equal(data.paymentOrders[0].status, 'NOTPAY');
});

test('9.9 gold payment opens 360 days exactly once and uses a clear product description', async () => {
  const { data, call, paymentInputs } = setup({ amount: 990 });
  const before = Date.now();
  const created = await call('POST', '/api/gold/purchase-orders');
  assert.equal(created.amount, 990);
  assert.equal(paymentInputs[0].amount, 990);
  assert.equal(paymentInputs[0].description, '开通金手指（1年）');
  const first = await call('GET', `/api/gold/purchase-orders/${created.orderId}`);
  const expireAfterFirstCheck = data.users[0].goldExpire;
  const second = await call('GET', `/api/gold/purchase-orders/${created.orderId}`);
  assert.equal(first.status, 'SUCCESS');
  assert.equal(second.status, 'SUCCESS');
  assert.equal(data.users[0].goldExpire, expireAfterFirstCheck);
  assert.ok(expireAfterFirstCheck >= before + 360 * 24 * 3600 * 1000);
  assert.equal(data.systemNotifications.u1.length, 1);
  assert.equal(data.systemNotifications.u1[0].type, 'gold_opened');
});

test('successful payment adds exactly one permanent query even when checked twice', async () => {
  const { data, call } = setup();
  const created = await call('POST', '/api/dark-funds/purchase-orders');
  const first = await call('GET', `/api/dark-funds/purchase-orders/${created.orderId}`);
  const second = await call('GET', `/api/dark-funds/purchase-orders/${created.orderId}`);
  assert.equal(first.status, 'SUCCESS');
  assert.equal(second.status, 'SUCCESS');
  assert.equal(data.users[0].darkFundManualRemaining, 1);
  assert.equal(data.users[0].darkFundEnabled, true);
  assert.equal(data.systemNotifications.u1.length, 1);
});

test('mismatched paid amount never credits a query', async () => {
  const { data, call } = setup({ amount: 1 });
  const created = await call('POST', '/api/dark-funds/purchase-orders');
  await assert.rejects(call('GET', `/api/dark-funds/purchase-orders/${created.orderId}`), { status: 400 });
  assert.equal(data.users[0].darkFundManualRemaining, 0);
  assert.equal(data.users[0].darkFundEnabled, false);
});

test('verified payment notification is idempotent', async () => {
  const { data, call } = setup();
  const created = await call('POST', '/api/dark-funds/purchase-orders');
  const order = data.paymentOrders[0];
  const transaction = {
    trade_state: 'SUCCESS', appid: 'wx-test-app', mchid: '1900000001', out_trade_no: order.id,
    transaction_id: 'wx-notify-1', amount: { total: 99, currency: 'CNY' },
  };
  const notified = setup({ notification: transaction });
  notified.data.paymentOrders.push({ ...order });
  await notified.call('POST', '/api/payments/notify', {});
  await notified.call('POST', '/api/payments/notify', {});
  assert.equal(notified.data.users[0].darkFundManualRemaining, 1);
  assert.equal(notified.data.systemNotifications.u1.length, 1);
  assert.equal(created.amount, 99);
});
