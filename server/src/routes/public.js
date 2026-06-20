// server/src/routes/public.js —— 小程序只读接口
const db = require('../db');
const { pubUser } = require('../util');

module.exports = function register(router) {
  // 首页 feed
  router.get('/api/feed', ({ query }) => {
    const { tab = 'discover', page = 1, size = 10 } = query;
    const data = db.get();
    let list = data.notes.slice();
    if (tab === 'home') list.sort((a, b) => b.time - a.time);
    const p = Number(page) || 1;
    const s = Number(size) || 10;
    const start = (p - 1) * s;
    return { list: list.slice(start, start + s), hasMore: start + s < list.length, total: list.length };
  });

  router.get('/api/categories', () => db.get().categories);
  router.get('/api/hotSearch', () => db.get().hotSearch);

  router.get('/api/search', ({ query }) => {
    const kw = (query.kw || '').trim();
    if (!kw) return [];
    return db.get().notes.filter(
      (n) =>
        n.title.includes(kw) ||
        (n.content || '').includes(kw) ||
        (n.category || '').includes(kw) ||
        (n.tags || []).some((t) => t.includes(kw)) ||
        n.author.name.includes(kw)
    );
  });

  router.get('/api/notes/:id', ({ params }) => {
    const n = db.get().notes.find((x) => x.id === params.id);
    if (!n) { const e = new Error('not found'); e.status = 404; throw e; }
    return n;
  });

  router.get('/api/users/:id', ({ params }) => {
    const u = db.get().users.find((x) => x.id === params.id);
    if (!u) { const e = new Error('not found'); e.status = 404; throw e; }
    return pubUser(u);
  });

  router.get('/api/users/:id/notes', ({ params }) =>
    db.get().notes.filter((n) => n.authorId === params.id)
  );
};
