// server/src/routes/app.js —— 小程序端鉴权 + 写操作接口
// 交互状态（赞/藏/关注）、发布笔记均回传后端，后端为数据源。
const db = require('../db');
const { pubUser, pubNote } = require('../util');
const auth = require('../auth');
const crypto = require('crypto');
const { code2Session } = require('../wechat');

function getState(userId) {
  const d = db.get();
  if (!d.userState) d.userState = {};
  if (!d.userState[userId]) d.userState[userId] = { likes: {}, collects: {}, follows: {} };
  const s = d.userState[userId];
  s.likes = s.likes || {};
  s.collects = s.collects || {};
  s.follows = s.follows || {};
  return s;
}

module.exports = function register(router, HttpError) {
  const currentUser = (ctx) => {
    const uid = auth.userIdFor(ctx.headers.authorization);
    if (!uid) throw new HttpError(401, '未登录');
    const u = db.get().users.find((x) => x.id === uid);
    if (!u) throw new HttpError(401, '用户不存在');
    return u;
  };
  // 微信登录：后端用 code 换取 openid，再发放业务 token。
  router.post('/api/login', async ({ body }) => {
    const d = db.get();
    const b = body || {};
    const session = await code2Session(b.code);
    const openid = session.openid;
    let user = d.users.find((u) => u.wxOpenId === openid);
    if (!user) {
      user = {
        id: 'wx_' + crypto.createHash('sha256').update(openid).digest('hex').slice(0, 16),
        wxOpenId: openid,
        name: b.name || '微信用户',
        avatar: b.avatar || 'https://i.pravatar.cc/150?img=68',
        desc: b.desc || '这个人很懒，什么都没留下',
        fans: b.fans || 0,
        follows: b.follows || 0,
        likes: b.likes || 0,
        vip: false,
        vipPlan: '',
        vipExpire: 0,
      };
      d.users.push(user);
      db.save();
    } else {
      // 同步昵称头像
      if (b.name) user.name = b.name;
      if (b.avatar) user.avatar = b.avatar;
      db.save();
    }
    const token = auth.issue(user.id);
    return { token, user: pubUser(user) };
  });

  // 当前用户 + 交互状态
  router.get('/api/me', (ctx) => {
    const u = currentUser(ctx);
    const s = getState(u.id);
    return {
      user: pubUser(u),
      likes: Object.keys(s.likes),
      collects: Object.keys(s.collects),
      follows: Object.keys(s.follows),
    };
  });

  // 点赞
  router.post('/api/like/:id', (ctx) => {
    const u = currentUser(ctx);
    const s = getState(u.id);
    const note = db.get().notes.find((n) => n.id === ctx.params.id);
    if (!note) throw new HttpError(404, 'not found');
    const liked = !s.likes[ctx.params.id];
    if (liked) { s.likes[ctx.params.id] = Date.now(); note.likes += 1; }
    else { delete s.likes[ctx.params.id]; note.likes = Math.max(0, note.likes - 1); }
    db.save();
    return { liked, likes: note.likes };
  });

  // 收藏
  router.post('/api/collect/:id', (ctx) => {
    const u = currentUser(ctx);
    const s = getState(u.id);
    const note = db.get().notes.find((n) => n.id === ctx.params.id);
    if (!note) throw new HttpError(404, 'not found');
    const collected = !s.collects[ctx.params.id];
    if (collected) { s.collects[ctx.params.id] = Date.now(); note.collects += 1; }
    else { delete s.collects[ctx.params.id]; note.collects = Math.max(0, note.collects - 1); }
    db.save();
    return { collected, collects: note.collects };
  });

  // 关注 / 取消关注作者
  router.post('/api/follow/:id', (ctx) => {
    const u = currentUser(ctx);
    const target = db.get().users.find((user) => user.id === ctx.params.id);
    if (!target) throw new HttpError(404, '用户不存在');
    if (target.id === u.id) throw new HttpError(400, '不能关注自己');

    const s = getState(u.id);
    const followed = !s.follows[target.id];
    if (followed) {
      s.follows[target.id] = Date.now();
      u.follows = (u.follows || 0) + 1;
      target.fans = (target.fans || 0) + 1;
    } else {
      delete s.follows[target.id];
      u.follows = Math.max(0, (u.follows || 0) - 1);
      target.fans = Math.max(0, (target.fans || 0) - 1);
    }
    db.save();
    return { followed, fans: target.fans };
  });


  // 我关注的人
  router.get('/api/me/following', (ctx) => {
    const u = currentUser(ctx);
    const s = getState(u.id);
    const d = db.get();
    return Object.keys(s.follows).map((id) => pubUser(d.users.find((x) => x.id === id))).filter(Boolean);
  });

  // 我的粉丝（关注了我的人）
  router.get('/api/me/fans', (ctx) => {
    const u = currentUser(ctx);
    const d = db.get();
    const states = d.userState || {};
    const fanIds = Object.keys(states).filter((uid) => states[uid] && states[uid].follows && states[uid].follows[u.id]);
    return fanIds.map((id) => pubUser(d.users.find((x) => x.id === id))).filter(Boolean);
  });

  // 我赞过 / 收藏的笔记
  router.get('/api/me/likes', (ctx) => {
    const u = currentUser(ctx);
    const s = getState(u.id);
    const map = {};
    db.get().notes.forEach((n) => (map[n.id] = n));
    return Object.keys(s.likes).sort((a, b) => s.likes[b] - s.likes[a]).map((id) => map[id]).filter(Boolean).map(pubNote);
  });
  router.get('/api/me/collects', (ctx) => {
    const u = currentUser(ctx);
    const s = getState(u.id);
    const map = {};
    db.get().notes.forEach((n) => (map[n.id] = n));
    return Object.keys(s.collects).sort((a, b) => s.collects[b] - s.collects[a]).map((id) => map[id]).filter(Boolean).map(pubNote);
  });

  // 我发布的笔记
  router.get('/api/me/notes', (ctx) => {
    const u = currentUser(ctx);
    return db.get().notes.filter((n) => n.authorId === u.id).map(pubNote);
  });

};
