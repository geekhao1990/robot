const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRouter, HttpError } = require('../src/router');
const password = require('../src/user-password');

function setup(mock = false) {
  const full = { id: 'full-user', name: '满权限用户', phone: '13800138000', darkFundEnabled: true, decisionPioneerEnabled: true, goldExpire: Date.now() + 86400000 };
  const partial = { id: 'partial-user', name: '普通用户', darkFundEnabled: true, decisionPioneerEnabled: false, goldExpire: Date.now() + 86400000 };
  password.setPassword(full, 'safe-pass-123');
  password.setPassword(partial, 'safe-pass-123');
  const data = { users: [full, partial], sessions: { app: {}, admin: {} } };
  const db = { get: () => data, save: () => {} };
  const auth = { issue: (id) => `token:${id}`, userIdFor: (value) => String(value || '').replace('Bearer token:', '') || null };
  const mod = { exports: {} };
  const dependencies = { '../db': db, '../auth': auth, '../util': require('../src/util'), '../user-password': password };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/routes/saas-auth.js'), 'utf8'), {
    module: mod, require: (id) => dependencies[id] || require(id),
    process: { env: { ...process.env, ...(mock ? { SAAS_SMS_MOCK: 'true' } : {}) } }, fetch,
  });
  const router = createRouter();
  mod.exports(router, HttpError);
  const call = (method, url, body = {}, authorization = '') => Promise.resolve().then(() => {
    const match = router.match(method, url);
    return match.handler({ body, headers: { authorization }, query: {}, params: match.params });
  });
  return { call };
}

test('SaaS password login only admits full-access users', async () => {
  const { call } = setup();
  const result = await call('POST', '/api/saas/login', { userId: 'full-user', password: 'safe-pass-123' });
  assert.equal(result.token, 'token:full-user');
  assert.equal(result.user.decisionPioneerEnabled, true);
  await assert.rejects(call('POST', '/api/saas/login', { userId: 'partial-user', password: 'safe-pass-123' }), { status: 403 });
  await assert.rejects(call('GET', '/api/saas/me', {}, 'Bearer token:partial-user'), { status: 403 });
});

test('SaaS SMS route validates bound full-access phone before provider configuration', async () => {
  const { call } = setup();
  await assert.rejects(call('POST', '/api/saas/sms/send', { phone: '13900139000' }), { status: 403 });
  await assert.rejects(call('POST', '/api/saas/sms/send', { phone: '13800138000' }), { status: 503 });
});

test('SaaS SMS mock mode auto-issues the demo code to a full-access account', async () => {
  const { call } = setup(true);
  const sent = await call('POST', '/api/saas/sms/send', { phone: '13900139000' });
  assert.equal(sent.mock, true);
  assert.equal(sent.mockCode, '888888');
  const loggedIn = await call('POST', '/api/saas/sms/login', { phone: '13900139000', code: '888888' });
  assert.equal(loggedIn.token, 'token:full-user');
});
