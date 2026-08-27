// server/src/routes/admin.js —— 管理后台接口（登录 + 笔记/用户/分类 CRUD）
const db = require('../db');
const auth = require('../auth');
const { pubSettings } = require('../util');
const { TYPE_LABELS, normalizeType, typeLabel, typeForCategory } = require('../content-types');
const { getPlan, activateMembership } = require('../membership');
const { normalizeResourceLinks } = require('../resource-links');
const crypto = require('crypto');

module.exports = function register(router, HttpError) {
  const baseCategories = Object.values(TYPE_LABELS);
  const cleanCategory = (value) => String(value || '').trim();
  const adminUserView = (user) => {
    if (!user) return null;
    const { phone, phoneCountryCode, phoneBoundAt, ...safe } = user;
    return safe;
  };
  const resolveCategory = (data, value, fallbackType) => {
    const category = cleanCategory(value) || typeLabel(normalizeType(fallbackType));
    if (!data.categories.includes(category)) throw new HttpError(400, '请选择有效的笔记类型');
    return { category, type: typeForCategory(category) };
  };
  const requireAuth = (ctx) => {
    if (!auth.isAdmin(ctx.headers.authorization)) throw new HttpError(401, '未登录或登录失效');
  };
  const pointAccount = (userId) => {
    const d = db.get();
    d.userState = d.userState || {};
    d.userState[userId] = d.userState[userId] || { likes: {}, collects: {}, follows: {} };
    const state = d.userState[userId];
    state.points = state.points || { balance: 0, totalEarned: 0, transactions: [], tickets: [], daily: {} };
    state.points.balance = Number(state.points.balance) || 0;
    state.points.transactions = Array.isArray(state.points.transactions) ? state.points.transactions : [];
    return state.points;
  };
  const appendPointTransaction = (account, data) => {
    account.balance = Math.max(0, account.balance + Number(data.delta));
    account.transactions.unshift({
      id: 'pt_' + Date.now() + crypto.randomBytes(3).toString('hex'),
      type: data.type,
      title: data.title,
      delta: Number(data.delta),
      balanceAfter: account.balance,
      relatedId: data.relatedId || '',
      time: Date.now(),
    });
    account.transactions = account.transactions.slice(0, 2000);
  };
  const appendAnomaly = (userId, type, message, details) => {
    const d = db.get();
    d.pointAnomalies = Array.isArray(d.pointAnomalies) ? d.pointAnomalies : [];
    d.pointAnomalies.unshift({
      id: 'pa_' + Date.now() + crypto.randomBytes(3).toString('hex'),
      userId, type, message, details: details || {}, status: 'OPEN', createdAt: Date.now(),
    });
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
    return { token: auth.issueAdmin(username), username };
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
    }).map(adminUserView);
  });

  router.get('/api/admin/notifications/summary', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    return {
      pointAnomalies: (d.pointAnomalies || []).filter((item) => item.status !== 'RESOLVED').length,
      pendingWithdrawals: (d.withdrawals || []).filter((item) => item.status === 'PENDING').length,
      approvedWithdrawals: (d.withdrawals || []).filter((item) => item.status === 'APPROVED').length,
    };
  });

  router.get('/api/admin/operation-logs', (ctx) => {
    requireAuth(ctx);
    return (db.get().adminOperationLogs || []).slice().sort((a, b) => b.createdAt - a.createdAt);
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
    return adminUserView(user);
  });

  router.put('/api/admin/users/:id', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    const i = d.users.findIndex((u) => u.id === ctx.params.id);
    if (i < 0) throw new HttpError(404, 'not found');
    const body = ctx.body || {};
    const update = {};
    ['name', 'avatar', 'desc', 'official'].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(body, key)) update[key] = body[key];
    });
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
    return adminUserView(d.users[i]);
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
    return adminUserView(user);
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
    return { ok: true, order, user: adminUserView(user) };
  });

  // ---------- 积分流水 / 提现人工审核 ----------
  router.get('/api/admin/point-ledger', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    const rows = [];
    Object.keys(d.userState || {}).forEach((userId) => {
      const account = pointAccount(userId);
      const user = d.users.find((item) => item.id === userId);
      account.transactions.forEach((transaction) => rows.push({
        ...transaction,
        user: user ? { id: user.id, name: user.name } : { id: userId, name: '用户不存在' },
      }));
    });
    return rows.sort((a, b) => (b.time || 0) - (a.time || 0));
  });

  router.get('/api/admin/point-anomalies', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    d.pointAnomalies = Array.isArray(d.pointAnomalies) ? d.pointAnomalies : [];
    return d.pointAnomalies.slice().sort((a, b) => b.createdAt - a.createdAt).map((item) => {
      const user = d.users.find((candidate) => candidate.id === item.userId);
      return { ...item, user: user ? { id: user.id, name: user.name } : null };
    });
  });

  router.put('/api/admin/point-anomalies/:id/resolve', (ctx) => {
    requireAuth(ctx);
    const anomaly = (db.get().pointAnomalies || []).find((item) => item.id === ctx.params.id);
    if (!anomaly) throw new HttpError(404, '异常记录不存在');
    anomaly.status = 'RESOLVED';
    anomaly.resolvedAt = Date.now();
    anomaly.resolveNote = String((ctx.body || {}).note || '').trim().slice(0, 200);
    db.save();
    return anomaly;
  });

  router.get('/api/admin/withdrawals', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    d.withdrawals = Array.isArray(d.withdrawals) ? d.withdrawals : [];
    return d.withdrawals.slice().sort((a, b) => b.createdAt - a.createdAt).map((item) => {
      const user = d.users.find((candidate) => candidate.id === item.userId);
      const account = pointAccount(item.userId);
      return {
        ...item,
        currentBalance: account.balance,
        user: user ? { id: user.id, name: user.name, avatar: user.avatar } : null,
      };
    });
  });

  router.put('/api/admin/withdrawals/:id/review', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    const withdrawal = (d.withdrawals || []).find((item) => item.id === ctx.params.id);
    if (!withdrawal) throw new HttpError(404, '提现申请不存在');
    const action = String((ctx.body || {}).action || '').toLowerCase();
    const note = String((ctx.body || {}).note || '').trim().slice(0, 200);
    const account = pointAccount(withdrawal.userId);
    const invalid = (message) => {
      appendAnomaly(withdrawal.userId, 'INVALID_REVIEW_STATE', message, {
        withdrawalId: withdrawal.id, status: withdrawal.status, action,
      });
      db.save();
      throw new HttpError(409, message);
    };
    if (action === 'approve') {
      if (withdrawal.status !== 'PENDING') invalid('只有待审核申请可以通过');
      withdrawal.status = 'APPROVED';
      withdrawal.reviewedAt = Date.now();
    } else if (action === 'reject') {
      if (!['PENDING', 'APPROVED'].includes(withdrawal.status)) invalid('当前状态不能拒绝');
      if (withdrawal.refunded) invalid('该申请已退回积分');
      appendPointTransaction(account, {
        type: 'withdraw_refund', title: '提现拒绝（积分退回）', delta: Number(withdrawal.points), relatedId: withdrawal.id,
      });
      withdrawal.status = 'REJECTED';
      withdrawal.refunded = true;
      withdrawal.refundedAt = Date.now();
      withdrawal.reviewedAt = Date.now();
    } else if (action === 'paid') {
      if (withdrawal.status !== 'APPROVED') invalid('只有审核通过的申请可以确认打款');
      withdrawal.status = 'PAID';
      withdrawal.paidAt = Date.now();
    } else {
      throw new HttpError(400, 'action 须为 approve/reject/paid');
    }
    withdrawal.reviewNote = note;
    withdrawal.updatedAt = Date.now();
    db.save();
    return withdrawal;
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
