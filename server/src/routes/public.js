// server/src/routes/public.js —— 小程序只读接口
const db = require('../db');
const { vipActive, pubUser, pubNote, pubSettings } = require('../util');
const auth = require('../auth');
const { typeLabel } = require('../content-types');
const { resourceList } = require('../resource-links');

module.exports = function register(router, HttpError) {
  const requireReader = (ctx) => {
    const uid = auth.userIdFor(ctx.headers.authorization);
    if (!uid) throw new HttpError(401, '请先登录');
    const user = db.get().users.find((u) => u.id === uid);
    if (!user) throw new HttpError(401, '用户不存在');
    return user;
  };

  // 小程序公共功能设置（广告开关、首页加号入口）。
  router.get('/api/settings', () => pubSettings(db.get()));

  // 首页 feed
  router.get('/api/feed', (ctx) => {
    const reader = requireReader(ctx);
    const { tab = 'discover', page = 1, size = 10 } = ctx.query;
    const d = db.get();
    let list = d.notes.slice();
    if (tab === 'following') {
      const state = (d.userState && d.userState[reader.id]) || {};
      const follows = state.follows || {};
      list = list.filter((n) => !!follows[n.authorId]).sort((a, b) => b.time - a.time);
    } else if (tab === 'discover' || tab === 'home') {
      // 首页：全部笔记，按时间倒序
      list.sort((a, b) => b.time - a.time);
    } else if (tab === 'material') {
      list = list.filter((n) => !n.type || n.type === 'normal' || n.type === 'material').sort((a, b) => b.time - a.time);
    } else if (tab === 'course') {
      list = list.filter((n) => n.type === 'course').sort((a, b) => b.time - a.time);
    } else if (tab === 'gold') {
      list = list.filter((n) => n.type === 'gold').sort((a, b) => b.time - a.time);
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
    const kw = String(ctx.query.kw || '').trim().toLowerCase();
    if (!kw) return [];
    const contains = (value) => String(value || '').toLowerCase().includes(kw);
    return db.get().notes.filter(
      (n) =>
        contains(n.title) ||
        contains(n.content) ||
        contains(n.category) ||
        contains(typeLabel(n.type)) ||
        (n.tags || []).some(contains) ||
        contains(n.author && n.author.name)
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
    const reader = requireReader(ctx);
    const data = db.get();
    const note = data.notes.find((n) => n.id === ctx.params.id);
    if (!note) throw new HttpError(404, 'not found');
    if (note.type === 'gold') throw new HttpError(400, '金手指内容请通过企业微信领取');
    if (data.settings && data.settings.vipEnabled === true && !vipActive(reader)) {
      throw new HttpError(403, '开通VIP后可领取该资源');
    }
    const resources = resourceList(note);
    if (!resources.length) throw new HttpError(404, '暂未配置获取地址');
    return { resources, url: resources[0].url };
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
