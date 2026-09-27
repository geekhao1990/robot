const crypto = require('crypto');

function storeFor(data, userId) {
  data.systemNotifications = data.systemNotifications && typeof data.systemNotifications === 'object'
    ? data.systemNotifications : {};
  data.systemNotifications[userId] = Array.isArray(data.systemNotifications[userId])
    ? data.systemNotifications[userId] : [];
  return data.systemNotifications[userId];
}

function pushNotification(data, userId, payload) {
  if (!data || !userId || !payload) return null;
  const list = storeFor(data, userId);
  const dedupeKey = String(payload.dedupeKey || '');
  if (dedupeKey && list.some((item) => item.dedupeKey === dedupeKey)) return null;
  const item = {
    id: `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    type: String(payload.type || 'system'),
    title: String(payload.title || '系统通知').slice(0, 80),
    content: String(payload.content || '').slice(0, 240),
    targetType: String(payload.targetType || ''),
    targetId: String(payload.targetId || ''),
    dedupeKey,
    createdAt: Number(payload.createdAt) || Date.now(),
    readAt: 0,
  };
  list.unshift(item);
  if (list.length > 500) list.length = 500;
  return item;
}

function notificationsFor(data, userId) {
  return storeFor(data, userId).slice().sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
}

function unreadCount(data, userId) {
  return storeFor(data, userId).filter((item) => !Number(item.readAt)).length;
}

function markRead(data, userId, id) {
  const list = storeFor(data, userId);
  const now = Date.now();
  if (id) {
    const item = list.find((entry) => entry.id === id);
    if (item && !item.readAt) item.readAt = now;
  } else {
    list.forEach((item) => { if (!item.readAt) item.readAt = now; });
  }
  return unreadCount(data, userId);
}

function notifyFollowersOfNote(data, note) {
  if (!data || !note || note.visible === false || !note.authorId) return 0;
  let added = 0;
  Object.entries(data.userState || {}).forEach(([userId, state]) => {
    if (userId === note.authorId || !state || !state.follows || !state.follows[note.authorId]) return;
    const item = pushNotification(data, userId, {
      type: 'followed_note',
      title: `${note.author?.name || '你关注的用户'}发布了新笔记`,
      content: note.title || '点击查看新内容',
      targetType: 'note',
      targetId: note.id,
      dedupeKey: `followed-note:${note.id}`,
    });
    if (item) added += 1;
  });
  return added;
}

module.exports = {
  pushNotification,
  notificationsFor,
  unreadCount,
  markRead,
  notifyFollowersOfNote,
};
