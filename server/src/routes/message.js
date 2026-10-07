// server/src/routes/message.js —— 消息：通知 + 私信会话（按用户存储，回传后端）
const db = require('../db');
const auth = require('../auth');
const { paginatedNotificationsFor, unreadCount, markRead } = require('../notifications');

function legacyMockMessageData(value) {
  const notificationIds = (value && value.notifications || []).map((item) => item.id).sort().join(',');
  const conversationIds = (value && value.conversations || []).map((item) => item.id).sort().join(',');
  return notificationIds === 'm1,m2,m3,m4,m5,m6,m7,m8,m9' && conversationIds === 'c1,c2,c3';
}

function getMsg(userId) {
  const d = db.get();
  if (!d.messageData) d.messageData = {};
  if (!d.messageData[userId] || legacyMockMessageData(d.messageData[userId])) {
    d.messageData[userId] = {
      notifications: [],
      notifyRead: { like: false, comment: false, follow: false },
      conversations: [],
    };
    db.save();
  }
  return d.messageData[userId];
}

function lite(u) {
  return u ? { id: u.id, name: u.name, avatar: u.avatar } : null;
}

function summary(m) {
  let like = 0, comment = 0, follow = 0;
  m.notifications.forEach((n) => {
    if (n.type === 'like' || n.type === 'collect') like++;
    else if (n.type === 'comment') comment++;
    else if (n.type === 'follow') follow++;
  });
  if (m.notifyRead.like) like = 0;
  if (m.notifyRead.comment) comment = 0;
  if (m.notifyRead.follow) follow = 0;
  let conv = 0;
  m.conversations.forEach((c) => { if (!c.read) conv += c.unread || 0; });
  return { like, comment, follow, conv, total: like + comment + follow + conv };
}

module.exports = function register(router, HttpError) {
  const current = (ctx) => {
    const uid = auth.userIdFor(ctx.headers.authorization);
    if (!uid) throw new HttpError(401, '未登录');
    return uid;
  };

  // 未读汇总（消息 tab 角标）
  router.get('/api/messages/summary', (ctx) => {
    const userId = current(ctx);
    const result = summary(getMsg(userId));
    result.system = unreadCount(db.get(), userId);
    result.total += result.system;
    return result;
  });

  router.get('/api/system-notifications/summary', (ctx) => {
    const userId = current(ctx);
    return { unread: unreadCount(db.get(), userId) };
  });

  router.get('/api/system-notifications', (ctx) => {
    const userId = current(ctx);
    const data = db.get();
    return {
      ...paginatedNotificationsFor(data, userId, ctx.query.page, 10),
      unread: unreadCount(data, userId),
    };
  });

  router.post('/api/system-notifications/read', (ctx) => {
    const userId = current(ctx);
    const data = db.get();
    const id = (ctx.body || {}).all === true ? '' : String((ctx.body || {}).id || '');
    const unread = markRead(data, userId, id);
    db.save();
    return { unread };
  });

  // 通知列表（已填充 actor 用户与笔记）
  router.get('/api/notifications', (ctx) => {
    const m = getMsg(current(ctx));
    const d = db.get();
    return m.notifications.map((n) => ({
      ...n,
      user: lite(d.users.find((u) => u.id === n.userId)),
      note: n.noteId ? lite(d.notes.find((x) => x.id === n.noteId)) : null,
    }));
  });

  // 标记某类通知已读（like 含 collect）
  router.post('/api/notifications/read', (ctx) => {
    const m = getMsg(current(ctx));
    const type = (ctx.body || {}).type;
    if (type && m.notifyRead[type] !== undefined) { m.notifyRead[type] = true; db.save(); }
    return summary(m);
  });

  // 会话列表
  router.get('/api/conversations', (ctx) => {
    const m = getMsg(current(ctx));
    const d = db.get();
    return m.conversations.map((c) => ({
      id: c.id,
      userId: c.userId,
      user: lite(d.users.find((u) => u.id === c.userId)),
      unread: c.read ? 0 : c.unread,
      time: c.time,
      lastMsg: c.messages[c.messages.length - 1] || null,
    }));
  });

  // 单个会话（消息按时间正序）
  router.get('/api/conversations/:id', (ctx) => {
    const m = getMsg(current(ctx));
    const d = db.get();
    const c = m.conversations.find((x) => x.id === ctx.params.id);
    if (!c) throw new HttpError(404, 'not found');
    return { id: c.id, userId: c.userId, user: lite(d.users.find((u) => u.id === c.userId)), messages: c.messages };
  });

  // 标记会话已读
  router.post('/api/conversations/:id/read', (ctx) => {
    const m = getMsg(current(ctx));
    const c = m.conversations.find((x) => x.id === ctx.params.id);
    if (c) { c.read = true; c.unread = 0; db.save(); }
    return summary(m);
  });

  // 发送私信：只保存用户真实发送的消息，不生成自动回复。
  router.post('/api/conversations/:id/messages', (ctx) => {
    const m = getMsg(current(ctx));
    const c = m.conversations.find((x) => x.id === ctx.params.id);
    if (!c) throw new HttpError(404, 'not found');
    const text = ((ctx.body || {}).text || '').trim();
    if (!text) throw new HttpError(400, '内容为空');
    const mine = { fromMe: true, text, time: 0 };
    c.messages.push(mine);
    c.read = true; c.unread = 0;
    db.save();
    return { added: [mine] };
  });
};
