const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRouter, HttpError } = require('../src/router');
const membership = require('../src/membership');
const { pubUser } = require('../src/util');

function setup(data = { users: [{ id: 'a' }, { id: 'b' }] }) {
  const db = { get: () => data, save: async () => {} };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/routes/gift-cards.js'), 'utf8'), {
    module: mod,
    require: (id) => ({ '../db': db, '../auth': { isAdmin: (token) => token === 'admin', userIdFor: (token) => token }, '../membership': membership, '../util': { pubUser } }[id] || require(id)),
  });
  const router = createRouter();
  mod.exports(router, HttpError);
  const call = (method, url, body = {}, user = 'admin', query = {}) => Promise.resolve().then(() => {
    const match = router.match(method, url);
    return match.handler({ body, headers: { authorization: user }, query, params: match.params });
  });
  return { data, db, call };
}

test('only admin can generate 1-10 unique codes; admin history can copy codes', async () => {
  const { call, data } = setup();
  await assert.rejects(call('POST', '/api/admin/gift-cards', { type: 'gold' }, 'a'), { status: 401 });
  await assert.rejects(call('POST', '/api/admin/gift-cards', { type: 'gold', count: 11 }), { status: 400 });
  const batch = await call('POST', '/api/admin/gift-cards', { type: 'gold', days: 30 });
  assert.equal(new Set(batch.codes).size, 10);
  assert(JSON.stringify(data).includes(batch.codes[0]));
  const history = await call('GET', '/api/admin/gift-cards');
  assert.equal(history.total, 10);
  assert(history.list.every((item) => item.code && !item.codeHash));
  const annual = await call('POST', '/api/admin/gift-cards', { type: 'gold', count: 1 });
  assert.equal(annual.days, 360);
});

test('admin can delete a gift card and deleted code can no longer be redeemed', async () => {
  const { call } = setup();
  const batch = await call('POST', '/api/admin/gift-cards', { type: 'gold', count: 1 });
  const history = await call('GET', '/api/admin/gift-cards');
  await assert.rejects(call('DELETE', `/api/admin/gift-cards/${history.list[0].id}`, {}, 'a'), { status: 401 });
  const removed = await call('DELETE', `/api/admin/gift-cards/${history.list[0].id}`);
  assert.equal(removed.ok, true);
  await assert.rejects(call('POST', '/api/gift-cards/redeem', { code: batch.codes[0] }, 'a'), { status: 400 });
  await assert.rejects(call('DELETE', `/api/admin/gift-cards/${history.list[0].id}`), { status: 404 });
});

test('gold redemption extends only gold, survives restart, and concurrent reuse grants once', async () => {
  const { call, data } = setup();
  const future = Date.now() + 86400000;
  data.users[0].goldExpire = future;
  const { codes } = await call('POST', '/api/admin/gift-cards', { type: 'gold', count: 1, days: 7 });
  const body = { code: '  ' + codes[0].toLowerCase() + '  ' };
  const results = await Promise.allSettled([
    call('POST', '/api/gift-cards/redeem', body, 'a'),
    call('POST', '/api/gift-cards/redeem', body, 'b'),
  ]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(data.users[0].goldExpire, future + 360 * 86400000);
  assert.equal(data.users[0].vip, undefined);
  const restarted = setup(JSON.parse(JSON.stringify(data)));
  const retry = await restarted.call('POST', '/api/gift-cards/redeem', body, 'a');
  assert.equal(retry.alreadyRedeemed, true);
  assert.equal(retry.user.goldExpire, future + 360 * 86400000);
  await assert.rejects(restarted.call('POST', '/api/gift-cards/redeem', body, 'b'), { status: 409 });
});

test('month cards always add 30 days, extend membership, preserve lifetime, and reject anonymous requests', async () => {
  const { call, data } = setup();
  const future = Date.now() + 86400000;
  Object.assign(data.users[0], { vip: true, vipExpire: future });
  Object.assign(data.users[1], { vip: true, vipPermanent: true, vipExpire: 0 });
  const { codes } = await call('POST', '/api/admin/gift-cards', { type: 'month', days: 900, count: 2 });
  await assert.rejects(call('POST', '/api/gift-cards/redeem', { code: codes[0] }, ''), { status: 401 });
  const result = await call('POST', '/api/gift-cards/redeem', { code: codes[0] }, 'a');
  assert.equal(result.user.vipExpire, future + 30 * 86400000);
  assert.equal(result.user.vipActive, true);
  assert.equal(result.user.goldActive, false);
  assert.equal(result.user.darkFundRemaining, 10);
  await call('POST', '/api/gift-cards/redeem', { code: codes[1] }, 'b');
  assert.equal(data.users[1].vipPermanent, true);
  assert.equal(data.users[1].vipExpire, 0);
  assert.equal(data.users[1].darkFundRemaining, 10);
});

test('expired rights restart from redemption, invalid codes and failed writes grant nothing', async () => {
  const { call, data, db } = setup();
  data.users[0].goldExpire = 1;
  const { codes } = await call('POST', '/api/admin/gift-cards', { type: 'gold', count: 1 });
  await assert.rejects(call('POST', '/api/gift-cards/redeem', { code: 'INVALID' }, 'a'), { status: 400 });
  db.save = async () => { throw new Error('DB unavailable'); };
  await assert.rejects(call('POST', '/api/gift-cards/redeem', { code: codes[0] }, 'a'), /DB unavailable/);
  assert.equal(data.users[0].goldExpire, 1);
  assert.equal(data.giftCards[0].status, 'unused');
  db.save = async () => {};
  const before = Date.now();
  const redeemed = await call('POST', '/api/gift-cards/redeem', { code: codes[0] }, 'a');
  assert(redeemed.user.goldExpire >= before + 360 * 86400000);
  assert.equal(redeemed.user.goldActive, true);
});
