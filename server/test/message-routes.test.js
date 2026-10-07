const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRouter, HttpError } = require('../src/router');

function setup(messageData = {}) {
  const data = {
    users: [{ id: 'u1', name: '当前用户' }, { id: 'u2', name: '真实联系人' }],
    notes: [], messageData, systemNotifications: {},
  };
  const db = { get: () => data, save: () => {} };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/routes/message.js'), 'utf8'), {
    module: mod,
    require: (id) => id === '../db'
      ? db
      : id === '../auth'
        ? { userIdFor: () => 'u1' }
        : id === '../notifications'
          ? require('../src/notifications')
          : require(id),
  });
  const router = createRouter();
  mod.exports(router, HttpError);
  const call = (method, url, body = {}) => Promise.resolve().then(() => {
    const match = router.match(method, url);
    return match.handler({ body, headers: { authorization: 'token' }, query: {}, params: match.params });
  });
  return { data, call };
}

test('new users receive no fake messages or conversations', async () => {
  const { data, call } = setup();
  assert.deepEqual(Array.from(await call('GET', '/api/notifications')), []);
  assert.deepEqual(Array.from(await call('GET', '/api/conversations')), []);
  assert.deepEqual(Array.from(data.messageData.u1.notifications), []);
});

test('legacy mock message templates are removed on first access', async () => {
  const notifications = Array.from({ length: 9 }, (_, index) => ({ id: `m${index + 1}` }));
  const conversations = Array.from({ length: 3 }, (_, index) => ({ id: `c${index + 1}`, messages: [] }));
  const { data, call } = setup({ u1: { notifications, conversations, notifyRead: {} } });
  assert.deepEqual(Array.from(await call('GET', '/api/notifications')), []);
  assert.deepEqual(Array.from(data.messageData.u1.conversations), []);
});

test('sending a real private message does not fabricate an automatic reply', async () => {
  const real = { notifications: [], notifyRead: {}, conversations: [{ id: 'real-1', userId: 'u2', unread: 0, read: true, messages: [] }] };
  const { data, call } = setup({ u1: real });
  const result = await call('POST', '/api/conversations/real-1/messages', { text: '你好' });
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].text, '你好');
  assert.equal(data.messageData.u1.conversations[0].messages.length, 1);
});
