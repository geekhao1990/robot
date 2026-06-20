// server/src/routes/message.js —— 消息：通知 + 私信会话（按用户存储，回传后端）
const db = require('../db');
const auth = require('../auth');

// 新用户首次访问时的示例消息模板
function notifTemplate() {
  return [
    { id: 'm1', type: 'like', userId: 'u3', noteId: 'n1', text: '赞了你的笔记', time: 0.2 },
    { id: 'm2', type: 'collect', userId: 'u4', noteId: 'n1', text: '收藏了你的笔记', time: 0.5 },
    { id: 'm3', type: 'comment', userId: 'u2', noteId: 'n5', text: '评论了你的笔记：太实用了，已收藏！', time: 1 },
    { id: 'm4', type: 'follow', userId: 'u5', text: '关注了你', time: 2 },
    { id: 'm5', type: 'like', userId: 'u6', noteId: 'n5', text: '赞了你的笔记', time: 3 },
    { id: 'm6', type: 'like', userId: 'u2', noteId: 'n1', text: '赞了你的笔记', time: 5 },
    { id: 'm7', type: 'collect', userId: 'u1', noteId: 'n5', text: '收藏了你的笔记', time: 8 },
    { id: 'm8', type: 'follow', userId: 'u6', text: '关注了你', time: 26 },
    { id: 'm9', type: 'comment', userId: 'u4', noteId: 'n1', text: '评论了你的笔记：请问机位在哪呀～', time: 30 },
  ];
}
// 会话内消息按时间正序（旧→新）存储
function convTemplate() {
  return [
    { id: 'c1', userId: 'u2', unread: 2, read: false, time: 0.1, messages: [
      { fromMe: false, text: '在吗？看到你那篇笔记啦', time: 1 },
      { fromMe: true, text: '在的～有什么问题嘛', time: 0.8 },
      { fromMe: false, text: '请问那个用的是哪个牌子呀', time: 0.3 },
      { fromMe: false, text: '想自己也试试 😋', time: 0.1 },
    ] },
    { id: 'c2', userId: 'u3', unread: 0, read: true, time: 2, messages: [
      { fromMe: false, text: '你的分享真好看！求链接～', time: 5 },
      { fromMe: true, text: '已经私你啦，记得查收', time: 2 },
    ] },
    { id: 'c3', userId: 'u5', unread: 1, read: false, time: 24, messages: [
      { fromMe: false, text: '那期内容能分享下吗', time: 26 },
      { fromMe: true, text: '可以呀，我整理下发你', time: 25 },
      { fromMe: false, text: '太感谢啦 🥰', time: 24 },
    ] },
  ];
}

const REPLIES = ['好的呀～', '收到！', '哈哈哈哈', '谢谢你！', '我看看哈', '可以的👌'];

function getMsg(userId) {
  const d = db.get();
  if (!d.messageData) d.messageData = {};
  if (!d.messageData[userId]) {
    d.messageData[userId] = {
      notifications: notifTemplate(),
      notifyRead: { like: false, comment: false, follow: false },
      conversations: convTemplate(),
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
  router.get('/api/messages/summary', (ctx) => summary(getMsg(current(ctx))));

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

  // 发送私信：保存我的消息 + 生成一条对方自动回复，返回新增消息（正序）
  router.post('/api/conversations/:id/messages', (ctx) => {
    const m = getMsg(current(ctx));
    const c = m.conversations.find((x) => x.id === ctx.params.id);
    if (!c) throw new HttpError(404, 'not found');
    const text = ((ctx.body || {}).text || '').trim();
    if (!text) throw new HttpError(400, '内容为空');
    const mine = { fromMe: true, text, time: 0 };
    const reply = { fromMe: false, text: REPLIES[Math.floor(Math.random() * REPLIES.length)], time: 0 };
    c.messages.push(mine, reply);
    c.read = true; c.unread = 0;
    db.save();
    return { added: [mine, reply] };
  });
};
