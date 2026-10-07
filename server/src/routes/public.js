// server/src/routes/public.js —— 小程序只读接口
const db = require('../db');
const { goldAccess, pubUser, pubNote, pubSettings, reviewModeApplies, webClient } = require('../util');
const auth = require('../auth');
const { typeLabel } = require('../content-types');
const { resourceList } = require('../resource-links');
const { canViewNote, findViewableNote, isDarkFundNote } = require('../note-access');
const goldFingerSync = require('../gold-finger-sync');
const analytics = require('../analytics');

module.exports = function register(router, HttpError) {
  const requireReader = (ctx) => {
    const uid = auth.userIdFor(ctx.headers.authorization);
    if (!uid) throw new HttpError(401, '请先登录');
    const user = db.get().users.find((u) => u.id === uid);
    if (!user) throw new HttpError(401, '用户不存在');
    return user;
  };
  const optionalReader = (ctx, data = db.get()) => {
    const uid = auth.userIdFor(ctx.headers && ctx.headers.authorization);
    return uid ? data.users.find((u) => u.id === uid) || null : null;
  };
  const requireGoldAccess = (ctx) => {
    if (reviewModeApplies(ctx, db.get())) throw new HttpError(403, '功能暂未开放');
    const reader = requireReader(ctx);
    if (!goldAccess(reader)) throw new HttpError(403, '金手指权益未开通或已过期');
    return db.get();
  };
  const goldEntryEnabled = (data, ctx) => webClient(ctx)
    ? data.settings && data.settings.goldFingerEntryEnabled !== false
    : pubSettings(data).goldFingerEntryEnabled === true;
  const sortedGoldRecords = (data) => (data.goldFingerRecords || [])
    .filter((item) => {
      const day = new Date(`${item.date}T00:00:00Z`).getUTCDay();
      return day !== 0 && day !== 6;
    })
    .map((item) => {
      const yang = Math.max(0, Math.min(100, Number(item.yang) || 0));
      return { ...item, yang, yin: 100 - yang };
    })
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.updatedAt || 0) - (a.updatedAt || 0));
  // 金手指入口的可见性与权益分离：公开展示入口，进入功能时再校验权益。
  router.get('/api/settings', (ctx) => {
    const data = db.get();
    const allowed = goldAccess(optionalReader(ctx, data));
    const settings = pubSettings(data);
    if (webClient(ctx)) {
      const entryEnabled = data.settings && data.settings.goldFingerEntryEnabled !== false;
      settings.reviewModeEnabled = false;
      settings.goldFingerEntryEnabled = entryEnabled;
      settings.featuredNoteId = entryEnabled ? ((data.notes || []).find((note) => note.id === data.settings.featuredNoteId && note.type === 'gold' && note.visible !== false)
        || (data.notes || []).find((note) => note.type === 'gold' && note.visible !== false)
        || {}).id || '' : '';
    }
    return {
      ...settings,
      goldAccess: allowed,
      featuredNoteId: settings.featuredNoteId,
    };
  });

  // 首页 feed
  router.get('/api/feed', (ctx) => {
    const { tab = 'discover', page = 1, size = 10 } = ctx.query;
    const d = db.get();
    let reader = optionalReader(ctx, d);
    const showGold = goldEntryEnabled(d, ctx);
    let list = d.notes.filter((note) => !isDarkFundNote(note) && canViewNote(d, note, reader) && (note.type !== 'gold' || showGold));
    if (tab === 'following') {
      reader = requireReader(ctx);
      const state = (d.userState && d.userState[reader.id]) || {};
      const follows = state.follows || {};
      list = list.filter((n) => !!follows[n.authorId]).sort((a, b) => b.time - a.time);
    } else if (tab === 'discover' || tab === 'home') {
      // 首页：最新金手指、最新广告固定前两位，其余按时间倒序。
      const sorted = list.slice().sort((a, b) => (Number(b.time) || 0) - (Number(a.time) || 0));
      const latestGold = sorted.find((note) => note.type === 'gold');
      const latestAd = sorted.find((note) => note.type === 'ad');
      const pinnedIds = new Set([latestGold && latestGold.id, latestAd && latestAd.id].filter(Boolean));
      list = [latestGold, latestAd].filter(Boolean).concat(sorted.filter((note) => !pinnedIds.has(note.id)));
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

  router.get('/api/categories', () => db.get().categories);
  router.get('/api/hotSearch', () => db.get().hotSearch);

  router.get('/api/search', (ctx) => {
    const data = db.get();
    const reader = optionalReader(ctx, data);
    const showGold = goldEntryEnabled(data, ctx);
    const kw = String(ctx.query.kw || '').trim().toLowerCase();
    if (!kw) return [];
    const contains = (value) => String(value || '').toLowerCase().includes(kw);
    return data.notes.filter(
      (n) => !isDarkFundNote(n) && canViewNote(data, n, reader) && (n.type !== 'gold' || showGold) && (
        contains(n.title) ||
        contains(n.content) ||
        contains(n.category) ||
        contains(typeLabel(n.type)) ||
        (n.tags || []).some(contains) ||
        contains(n.author && n.author.name)
      )
    ).map(pubNote);
  });

  router.get('/api/notes/:id', (ctx) => {
    const data = db.get();
    const reader = optionalReader(ctx, data);
    const candidate = data.notes.find((note) => note.id === ctx.params.id);
    if (reviewModeApplies(ctx, data) && candidate && (candidate.type === 'gold' || isDarkFundNote(candidate))) {
      throw new HttpError(404, 'not found');
    }
    const n = findViewableNote(data, ctx.params.id, reader);
    if (!n || (n.type === 'gold' && !goldEntryEnabled(data, ctx))) { const e = new Error('not found'); e.status = 404; throw e; }
    return pubNote(n);
  });

  // 独立金手指功能：有效金手指卡或服务包用户可查看。
  router.get('/api/gold-finger/latest', (ctx) => {
    const data = requireGoldAccess(ctx);
    analytics.record(data, {
      type: 'gold_view',
      userId: auth.userIdFor(ctx.headers.authorization),
    });
    db.save();
    const records = sortedGoldRecords(data);
    const latestFive = records.slice(0, 5);
    return {
      record: records[0] || null,
      records: latestFive,
      banners: (data.goldFingerBanners || [])
        .filter((item) => data.notes.some((note) => note.id === item.noteId && note.type === 'ad' && note.visible !== false))
        .map((item) => ({
        id: item.id,
        image: item.image,
        noteId: item.noteId,
        })),
      historyMonth: latestFive.length ? latestFive[latestFive.length - 1].date.slice(0, 7) : '',
      hasMoreHistory: records.length > latestFive.length,
      refreshPolicy: goldFingerSync.refreshPolicy(),
    };
  });

  // 点金历史固定每页 10 条；没有后台记录的非交易日不会出现在结果中。
  router.get('/api/gold-finger/history', (ctx) => {
    const data = requireGoldAccess(ctx);
    const records = sortedGoldRecords(data);
    const pageSize = 10;
    const requestedPage = Math.max(1, Number.parseInt(ctx.query.page, 10) || 1);
    const total = records.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const start = (page - 1) * pageSize;
    return {
      records: records.slice(start, start + pageSize),
      page,
      pageSize,
      total,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
    };
  });

  // 激励广告完成后由小程序单独请求。
  router.get('/api/notes/:id/resource', (ctx) => {
    const reader = requireReader(ctx);
    const data = db.get();
    const note = data.notes.find((n) => n.id === ctx.params.id && canViewNote(data, n, reader));
    if (!note) throw new HttpError(404, 'not found');
    if (note.type === 'gold') throw new HttpError(400, '金手指内容请进入会员专属页面查看');
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
    const reader = requireReader(ctx);
    const data = db.get();
    const showGold = goldEntryEnabled(data, ctx);
    return data.notes.filter((n) => n.authorId === ctx.params.id && !isDarkFundNote(n) && canViewNote(data, n, reader) && (n.type !== 'gold' || showGold)).map(pubNote);
  });
};
