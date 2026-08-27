// server/src/routes/admin.js —— 管理后台接口（登录 + 笔记/用户/分类 CRUD）
const db = require('../db');
const auth = require('../auth');
const { pubSettings } = require('../util');
const { TYPE_LABELS, normalizeType, typeLabel, typeForCategory } = require('../content-types');
const { getPlan, activateMembership } = require('../membership');
const { normalizeResourceLinks } = require('../resource-links');

module.exports = function register(router, HttpError) {
  const baseCategories = Object.values(TYPE_LABELS);
  const cleanCategory = (value) => String(value || '').trim();
  const resolveCategory = (data, value, fallbackType) => {
    const category = cleanCategory(value) || typeLabel(normalizeType(fallbackType));
    if (!data.categories.includes(category)) throw new HttpError(400, '请选择有效的笔记类型');
    return { category, type: typeForCategory(category) };
  };
  const requireAuth = (ctx) => {
    if (!auth.isAdmin(ctx.headers.authorization)) throw new HttpError(401, '未登录或登录失效');
  };

  // 登录
  router.post('/api/admin/login', ({ body }) => {
    const { username, password } = body || {};
    const envUsername = process.env.ADMIN_USERNAME;
    const envPassword = process.env.ADMIN_PASSWORD;
    const valid = envUsername && envPassword
      ? username === envUsername && password === envPassword
      : db.get().admins.some((a) => a.username === username && a.password === password);
    if (!valid) throw new HttpError(401, '账号或密码错误');
    return { token: auth.issueAdmin(), username };
  });

  // 概览
  router.get('/api/admin/stats', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    return {
      notes: d.notes.length,
      users: d.users.length,
      newUsers: d.users.filter((u) => Array.isArray(u.tags) && u.tags.includes('new')).length,
      vipUsers: d.users.filter((u) => u.vip).length,
      materials: d.notes.filter((n) => !n.type || n.type === 'normal' || n.type === 'material').length,
      courses: d.notes.filter((n) => n.type === 'course').length,
      goldNotes: d.notes.filter((n) => n.type === 'gold').length,
      categories: d.categories.length,
    };
  });

  // ---------- 功能设置 ----------
  router.get('/api/admin/settings', (ctx) => {
    requireAuth(ctx);
    return pubSettings(db.get());
  });

  router.put('/api/admin/settings', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    const b = ctx.body || {};
    if (typeof b.rewardedAdEnabled !== 'boolean') {
      throw new HttpError(400, '广告开关必须为布尔值');
    }
    if (typeof b.vipEnabled !== 'boolean') {
      throw new HttpError(400, 'VIP开关必须为布尔值');
    }
    if (!d.notes.some((n) => n.id === b.featuredNoteId && n.type === 'gold')) {
      throw new HttpError(400, '请选择金手指类型的入口笔记');
    }
    d.settings = {
      rewardedAdEnabled: b.rewardedAdEnabled,
      vipEnabled: b.vipEnabled,
      featuredNoteId: b.featuredNoteId,
    };
    db.save();
    return pubSettings(d);
  });

  // ---------- 笔记 ----------
  router.get('/api/admin/notes', (ctx) => { requireAuth(ctx); return db.get().notes; });

  router.post('/api/admin/notes', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    const b = ctx.body || {};
    const officialAuthors = d.users.filter((u) => u.official === true);
    const author = b.authorId
      ? officialAuthors.find((u) => u.id === b.authorId)
      : officialAuthors[0];
    if (!author) throw new HttpError(400, '请选择有效的官方作者账号');
    const resolved = resolveCategory(d, b.category, b.type);
    const type = resolved.type;
    const hasProviderFields = Object.prototype.hasOwnProperty.call(b, 'baiduUrl')
      || Object.prototype.hasOwnProperty.call(b, 'quarkUrl');
    const links = normalizeResourceLinks(b, type, !hasProviderFields);
    if (type !== 'gold' && !links.baiduUrl && !links.quarkUrl) throw new HttpError(400, '请至少填写一个网盘地址');
    const note = {
      id: 'n' + Date.now(),
      authorId: author.id,
      author: { id: author.id, name: author.name, avatar: author.avatar },
      category: resolved.category,
      type,
      ...links,
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
    const requestedCategory = Object.prototype.hasOwnProperty.call(b, 'category')
      ? b.category
      : (Object.prototype.hasOwnProperty.call(b, 'type') ? typeLabel(b.type) : note.category);
    const resolved = resolveCategory(d, requestedCategory, note.type);
    note.type = resolved.type;
    note.category = resolved.category;
    const hasProviderFields = Object.prototype.hasOwnProperty.call(b, 'baiduUrl')
      || Object.prototype.hasOwnProperty.call(b, 'quarkUrl');
    Object.assign(note, normalizeResourceLinks(note, note.type, !hasProviderFields));
    if (note.type !== 'gold' && !note.baiduUrl && !note.quarkUrl) throw new HttpError(400, '请至少填写一个网盘地址');
    if (d.settings && d.settings.featuredNoteId === note.id && note.type !== 'gold') {
      throw new HttpError(400, '加号入口笔记必须保持为金手指类型');
    }
    if (b.authorId) {
      const a = d.users.find((u) => u.id === b.authorId && u.official === true);
      if (!a) throw new HttpError(400, '请选择有效的官方作者账号');
      note.authorId = a.id;
      note.author = { id: a.id, name: a.name, avatar: a.avatar };
    }
    if (Array.isArray(b.images)) note.cover = b.images[0] || '';
    d.notes[i] = note;
    db.save();
    return note;
  });

  router.delete('/api/admin/notes/:id', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    if (d.settings && d.settings.featuredNoteId === ctx.params.id) {
      const nextGold = d.notes.find((n) => n.id !== ctx.params.id && n.type === 'gold');
      if (!nextGold) throw new HttpError(400, '请先新增另一篇金手指内容再删除');
      d.settings.featuredNoteId = nextGold.id;
    }
    d.notes = d.notes.filter((n) => n.id !== ctx.params.id);
    db.save();
    return { ok: true };
  });

  // ---------- 用户 ----------
  router.get('/api/admin/users', (ctx) => {
    requireAuth(ctx);
    return db.get().users.slice().sort((a, b) => {
      const aNew = Array.isArray(a.tags) && a.tags.includes('new') ? 1 : 0;
      const bNew = Array.isArray(b.tags) && b.tags.includes('new') ? 1 : 0;
      return bNew - aNew || (b.createdAt || 0) - (a.createdAt || 0);
    });
  });

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
      vipPermanent: false,
      official: b.official === true,
      createdAt: Date.now(),
      tags: b.official === true ? [] : ['new'],
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
    const update = { ...(ctx.body || {}) };
    if (Object.prototype.hasOwnProperty.call(update, 'official')) update.official = update.official === true;
    if (update.official === false && d.notes.some((n) => n.authorId === ctx.params.id)) {
      throw new HttpError(400, '该账号仍是笔记作者，请先更换对应笔记作者');
    }
    d.users[i] = { ...d.users[i], ...update };
    if (Object.prototype.hasOwnProperty.call(update, 'name') || Object.prototype.hasOwnProperty.call(update, 'avatar')) {
      d.notes.filter((note) => note.authorId === ctx.params.id).forEach((note) => {
        note.author = {
          ...(note.author || {}),
          id: d.users[i].id,
          name: d.users[i].name,
          avatar: d.users[i].avatar,
        };
      });
    }
    db.save();
    return d.users[i];
  });

  router.delete('/api/admin/users/:id', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    if (d.notes.some((n) => n.authorId === ctx.params.id)) {
      throw new HttpError(400, '该账号仍是笔记作者，不能删除');
    }
    d.users = d.users.filter((u) => u.id !== ctx.params.id);
    db.save();
    return { ok: true };
  });

  // 开通/取消 VIP（plan: month | year | none）。在原有有效期上叠加续费。
  router.put('/api/admin/users/:id/vip', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    const user = d.users.find((u) => u.id === ctx.params.id);
    if (!user) throw new HttpError(404, 'not found');
    const plan = (ctx.body || {}).plan;
    if (plan === 'none') {
      user.vip = false; user.vipPlan = ''; user.vipExpire = 0; user.vipPermanent = false;
    } else if (getPlan(plan)) {
      activateMembership(user, plan);
    } else {
      throw new HttpError(400, 'plan 须为 month/year/lifetime/none');
    }
    db.save();
    return user;
  });

  // ---------- 会员订单 / 企业微信赠送核销 ----------
  router.get('/api/admin/payment-orders', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    return (d.paymentOrders || []).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map((order) => {
      const user = d.users.find((item) => item.id === order.userId);
      return {
        ...order,
        user: user ? {
          id: user.id,
          name: user.name,
          avatar: user.avatar,
          phone: user.phone || '',
          wechatGiftRedeemedAt: user.wechatGiftRedeemedAt || 0,
          wechatGiftOrderId: user.wechatGiftOrderId || '',
        } : null,
        giftEligible: order.status === 'SUCCESS' && !!user && !user.wechatGiftRedeemedAt,
      };
    });
  });

  router.put('/api/admin/payment-orders/:id/wechat-gift', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    const order = (d.paymentOrders || []).find((item) => item.id === ctx.params.id);
    if (!order) throw new HttpError(404, '订单不存在');
    if (order.status !== 'SUCCESS') throw new HttpError(400, '只有已支付订单可以核销赠送月卡');
    const user = d.users.find((item) => item.id === order.userId);
    if (!user) throw new HttpError(404, '订单用户不存在');
    if (user.wechatGiftRedeemedAt) throw new HttpError(409, '该账号已经领取过企业微信赠送月卡');
    const redeemedAt = Date.now();
    activateMembership(user, 'month', redeemedAt);
    user.wechatGiftRedeemedAt = redeemedAt;
    user.wechatGiftOrderId = order.id;
    order.wechatGiftRedeemedAt = redeemedAt;
    db.save();
    return { ok: true, order, user };
  });

  // ---------- 分类 ----------
  router.get('/api/admin/categories', (ctx) => { requireAuth(ctx); return db.get().categories; });

  router.post('/api/admin/categories', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    const name = cleanCategory((ctx.body || {}).name);
    if (!name) throw new HttpError(400, '请输入笔记类型名称');
    if (name.length > 12) throw new HttpError(400, '笔记类型名称不能超过12个字');
    if (d.categories.includes(name)) throw new HttpError(400, '该笔记类型已存在');
    d.categories.push(name);
    db.save();
    return d.categories;
  });

  router.put('/api/admin/categories/:name', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    const oldName = cleanCategory(ctx.params.name);
    const name = cleanCategory((ctx.body || {}).name);
    if (baseCategories.includes(oldName)) throw new HttpError(400, '资料、课程、金手指为系统类型，不能修改');
    if (!d.categories.includes(oldName)) throw new HttpError(404, '笔记类型不存在');
    if (!name) throw new HttpError(400, '请输入笔记类型名称');
    if (name.length > 12) throw new HttpError(400, '笔记类型名称不能超过12个字');
    if (d.categories.some((item) => item !== oldName && item === name)) throw new HttpError(400, '该笔记类型已存在');
    d.categories[d.categories.indexOf(oldName)] = name;
    d.notes.filter((note) => note.category === oldName).forEach((note) => { note.category = name; });
    db.save();
    return d.categories;
  });

  router.delete('/api/admin/categories/:name', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    const name = cleanCategory(ctx.params.name);
    if (baseCategories.includes(name)) throw new HttpError(400, '资料、课程、金手指为系统类型，不能删除');
    if (!d.categories.includes(name)) throw new HttpError(404, '笔记类型不存在');
    if (d.notes.some((note) => note.category === name)) throw new HttpError(400, '该类型下还有笔记，请先更换笔记类型');
    d.categories = d.categories.filter((item) => item !== name);
    db.save();
    return d.categories;
  });
};
