const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pushNotification,
  notificationsFor,
  unreadCount,
  markRead,
  notifyFollowersOfNote,
} = require('../src/notifications');

test('business notifications are deduplicated and support individual/all read state', () => {
  const data = {};
  const first = pushNotification(data, 'u1', { type: 'dark_ready', title: '完成', dedupeKey: 'order:1' });
  const duplicate = pushNotification(data, 'u1', { type: 'dark_ready', title: '重复', dedupeKey: 'order:1' });
  assert.ok(first.id);
  assert.equal(duplicate, null);
  assert.equal(unreadCount(data, 'u1'), 1);
  assert.equal(notificationsFor(data, 'u1')[0].title, '完成');
  assert.equal(markRead(data, 'u1', first.id), 0);
  pushNotification(data, 'u1', { title: '第二条', dedupeKey: 'second' });
  pushNotification(data, 'u1', { title: '第三条', dedupeKey: 'third' });
  assert.equal(markRead(data, 'u1'), 0);
});

test('new visible notes notify followers with a note target only once', () => {
  const data = {
    userState: {
      fan: { follows: { author: Date.now() } },
      stranger: { follows: {} },
      author: { follows: { author: Date.now() } },
    },
  };
  const note = { id: 'n1', authorId: 'author', author: { name: '作者' }, title: '新笔记', visible: true };
  assert.equal(notifyFollowersOfNote(data, note), 1);
  assert.equal(notifyFollowersOfNote(data, note), 0);
  assert.equal(data.systemNotifications.fan[0].targetType, 'note');
  assert.equal(data.systemNotifications.fan[0].targetId, 'n1');
  assert.equal(data.systemNotifications.stranger, undefined);
});
