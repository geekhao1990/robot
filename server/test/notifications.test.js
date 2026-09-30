const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pushNotification,
  notificationsFor,
  paginatedNotificationsFor,
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

test('system notifications are paginated with 10 items per page', () => {
  const data = {};
  for (let index = 1; index <= 23; index += 1) {
    pushNotification(data, 'u1', {
      title: `第${index}条`,
      dedupeKey: `page:${index}`,
      createdAt: index,
    });
  }
  const second = paginatedNotificationsFor(data, 'u1', 2, 10);
  assert.equal(second.list.length, 10);
  assert.equal(second.page, 2);
  assert.equal(second.pageSize, 10);
  assert.equal(second.total, 23);
  assert.equal(second.totalPages, 3);
  assert.equal(second.list[0].title, '第13条');
  const last = paginatedNotificationsFor(data, 'u1', 99, 10);
  assert.equal(last.page, 3);
  assert.equal(last.list.length, 3);
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
