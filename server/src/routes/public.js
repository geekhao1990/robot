// server/src/routes/public.js —— 小程序只读接口
const db = require('../db');
const { pubUser, pubNote } = require('../util');
const auth = require('../auth');

module.exports = function register(router, HttpError) {
  const requireReader = (ctx) => {
    const uid = auth.userIdFor(ctx.headers.authorization);
    if (!uid) throw new HttpError(401, '请先登录');
    const user = db.get().users.find((u) => u.id === uid);
    if (!user) throw new HttpError(401, '用户不存在');
    return user;
  };

  // 首页 feed
  router.get('/api/feed', (ctx) => {
    requireReader(ctx);
    const { tab = 'home', page = 1, size = 10 } = ctx.query;
    const d = db.get();
    let list = d.notes.slice();
    if (tab === 'home') {
      // 首页：全部笔记，按时间倒序
      list.sort((a, b) => b.time - a.time);
    } else if (tab === 'material') {
      list = list.filter((n) => n.type !== 'course').sort((a, b) => b.time - a.time);
    } else if (tab === 'course') {
      list = list.filter((n) => n.type === 'course').sort((a, b) => b.time - a.time);
    }
    const p = Number(page) || 1;
    const s = Number(size) || 10;
    const start = (p - 1) * s;
    return { list: list.slice(start, start + s).map(pubNote), hasMore: start + s < list.length, total: list.length };
  });

  router.get('/api/categories', (ctx) => { requireReader(ctx); return db.get().categories; });
  router.get('/api/hotSearch', (ctx) => { requireReader(ctx); return db.get().hotSearch; });

  router.get('/api/search', (ctx) => {
    requireReader(ctx);
    const kw = (ctx.query.kw || '').trim();
    if (!kw) return [];
    return db.get().notes.filter(
      (n) =>
        n.title.includes(kw) ||
        (n.content || '').includes(kw) ||
        (n.category || '').includes(kw) ||
        (n.tags || []).some((t) => t.includes(kw)) ||
        n.author.name.includes(kw)
    ).map(pubNote);
  });

  router.get('/api/notes/:id', (ctx) => {
    requireReader(ctx);
    const n = db.get().notes.find((x) => x.id === ctx.params.id);
    if (!n) { const e = new Error('not found'); e.status = 404; throw e; }
    return pubNote(n);
  });

  // 激励广告完成后由小程序单独请求。
  router.get('/api/notes/:id/resource', (ctx) => {
    requireReader(ctx);
    const note = db.get().notes.find((n) => n.id === ctx.params.id);
    if (!note) throw new HttpError(404, 'not found');
    if (!note.courseUrl) throw new HttpError(404, '暂未配置获取地址');
    return { url: note.courseUrl };
  });

  router.get('/api/users/:id', (ctx) => {
    requireReader(ctx);
    const u = db.get().users.find((x) => x.id === ctx.params.id);
    if (!u) { const e = new Error('not found'); e.status = 404; throw e; }
    return pubUser(u);
  });

  router.get('/api/users/:id/notes', (ctx) => {
    requireReader(ctx);
    return db.get().notes.filter((n) => n.authorId === ctx.params.id).map(pubNote);
  });
};
