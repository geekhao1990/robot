// server/src/routes/admin.js —— 管理后台接口（登录 + 笔记/用户/分类 CRUD）
const db = require('../db');

const tokens = new Set();
const genToken = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

module.exports = function register(router, HttpError) {
  const requireAuth = (ctx) => {
    const h = ctx.headers.authorization || '';
    const token = h.replace(/^Bearer\s+/i, '');
    if (!tokens.has(token)) throw new HttpError(401, '未登录或登录失效');
  };

  // 登录
  router.post('/api/admin/login', ({ body }) => {
    const { username, password } = body || {};
    const admin = db.get().admins.find((a) => a.username === username && a.password === password);
    if (!admin) throw new HttpError(401, '账号或密码错误');
    const token = genToken();
    tokens.add(token);
    return { token, username };
  });

  // 概览
  router.get('/api/admin/stats', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    return {
      notes: d.notes.length,
      users: d.users.length,
      vipUsers: d.users.filter((u) => u.vip).length,
      courses: d.notes.filter((n) => n.type === 'course').length,
      categories: d.categories.length,
    };
  });

  // ---------- 笔记 ----------
  router.get('/api/admin/notes', (ctx) => { requireAuth(ctx); return db.get().notes; });

  router.post('/api/admin/notes', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    const b = ctx.body || {};
    const author = d.users.find((u) => u.id === b.authorId) || d.users[0];
    const note = {
      id: 'n' + Date.now(),
      authorId: author.id,
      author: { id: author.id, name: author.name, avatar: author.avatar },
      category: b.category || d.categories[0],
      type: b.type || 'normal',
      courseUrl: b.courseUrl || '',
      title: b.title || '未命名',
      content: b.content || '',
      images: b.images || [],
      cover: (b.images && b.images[0]) || b.cover || '',
      coverRatio: b.coverRatio || 1.25,
      tags: b.tags || [],
      likes: b.likes || 0,
      collects: b.collects || 0,
      comments: b.comments || 0,
      video: false,
      time: Date.now(),
      commentList: [],
    };
    d.notes.unshift(note);
    db.save();
    return note;
  });

  router.put('/api/admin/notes/:id', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    const i = d.notes.findIndex((n) => n.id === ctx.params.id);
    if (i < 0) throw new HttpError(404, 'not found');
    const b = ctx.body || {};
    const note = { ...d.notes[i], ...b };
    if (b.authorId) {
      const a = d.users.find((u) => u.id === b.authorId);
      if (a) note.author = { id: a.id, name: a.name, avatar: a.avatar };
    }
    if (b.images && b.images.length) note.cover = b.images[0];
    d.notes[i] = note;
    db.save();
    return note;
  });

  router.delete('/api/admin/notes/:id', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    d.notes = d.notes.filter((n) => n.id !== ctx.params.id);
    db.save();
    return { ok: true };
  });

  // ---------- 用户 ----------
  router.get('/api/admin/users', (ctx) => { requireAuth(ctx); return db.get().users; });

  router.post('/api/admin/users', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    const b = ctx.body || {};
    const user = {
      id: 'u' + Date.now(),
      name: b.name || '新用户',
      avatar: b.avatar || 'https://i.pravatar.cc/150?img=1',
      desc: b.desc || '',
      fans: b.fans || 0,
      follows: b.follows || 0,
      likes: b.likes || 0,
      vip: !!b.vip,
    };
    d.users.push(user);
    db.save();
    return user;
  });

  router.put('/api/admin/users/:id', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    const i = d.users.findIndex((u) => u.id === ctx.params.id);
    if (i < 0) throw new HttpError(404, 'not found');
    d.users[i] = { ...d.users[i], ...ctx.body };
    db.save();
    return d.users[i];
  });

  router.delete('/api/admin/users/:id', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    d.users = d.users.filter((u) => u.id !== ctx.params.id);
    db.save();
    return { ok: true };
  });

  // ---------- 分类 ----------
  router.get('/api/admin/categories', (ctx) => { requireAuth(ctx); return db.get().categories; });

  router.put('/api/admin/categories', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    if (Array.isArray(ctx.body.categories)) { d.categories = ctx.body.categories; db.save(); }
    return d.categories;
  });
};
