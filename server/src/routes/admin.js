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
      ads: d.notes.filter((n) => n.type === 'ad').length,
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

  // ---------- 独立金手指每日数据 ----------
  const validGoldFingerDate = (value) => {
    const date = String(value || '').trim();
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new HttpError(400, '请选择有效日期');
    }
    return date;
  };
  const goldPercent = (value, label) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0 || number > 100) throw new HttpError(400, `${label}必须是0-100的整数`);
    return number;
  };
  const importedPercent = (value, label) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 100) throw new HttpError(400, `${label}必须是0-100的数字`);
    return Math.round(number);
  };
  const importedTrend = (value) => {
    const trend = String(value || '').trim();
    if (trend === '上涨' || trend === 'up') return 'up';
    if (trend === '下跌' || trend === 'down') return 'down';
    throw new HttpError(400, '中期趋势仅支持“上涨”或“下跌”');
  };
  const importedFinger = (value) => {
    const finger = String(value || '').trim();
    if (finger === '-' || finger === '—') return '';
    if (finger === '金' || finger === '金手指' || finger === 'gold') return 'gold';
    if (finger === '银' || finger === '银手指' || finger === 'silver') return 'silver';
    throw new HttpError(400, '金银手指仅支持“金”、“银”或“-”');
  };
  const stripJsonLineComments = (source) => {
    let output = '';
    let quote = '';
    let escaped = false;
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      const next = source[index + 1];
      if (quote) {
        output += char;
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        output += char;
      } else if (char === '/' && next === '/') {
        while (index < source.length && source[index] !== '\n') index += 1;
        output += '\n';
      } else {
        output += char;
      }
    }
    return output;
  };
  const parseGoldFingerImport = (raw) => {
    let items;
    try {
      const parsed = JSON.parse(stripJsonLineComments(String(raw || '').trim()));
      // 支持直接数组，也支持上游接口常见的 { list: [...] } 返回结构。
      items = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.list) ? parsed.list : null);
    } catch (error) {
      throw new HttpError(400, 'JSON格式不正确，请粘贴数据后重试');
    }
    if (!Array.isArray(items) || !items.length) throw new HttpError(400, '未找到金手指数据，请使用数组或包含list数组的数据');
    if (items.length > 500) throw new HttpError(400, '单次最多导入500条数据');
    const dates = new Set();
    return items.map((item, sourceIndex) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new HttpError(400, `第${sourceIndex + 1}条不是有效对象`);
      const date = validGoldFingerDate(item.date);
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (weekday === 0 || weekday === 6) throw new HttpError(400, `第${sourceIndex + 1}条为周末日期，无需导入`);
      if (dates.has(date)) throw new HttpError(400, `日期${date}重复，请保留一条`);
      dates.add(date);
      const rawYang = Number(item.yang);
      const rawYin = Number(item.yin);
      if (!Number.isFinite(rawYang) || !Number.isFinite(rawYin) || rawYang < 0 || rawYang > 100 || rawYin < 0 || rawYin > 100 || Math.abs(rawYang + rawYin - 100) > 0.2) {
        throw new HttpError(400, `第${sourceIndex + 1}条阳谱和阴谱必须相加为100`);
      }
      // 直接以阳谱四舍五入，阴谱由100减阳谱得出；.5 时即阳谱+1、阴谱-1。
      const yang = importedPercent(rawYang, '阳谱');
      return {
        sourceIndex,
        date,
        yang,
        yin: 100 - yang,
        finger: importedFinger(item.finger),
        trend: importedTrend(item.trend),
        position: importedPercent(item.position, '仓位'),
      };
    });
  };

  router.get('/api/admin/gold-finger', (ctx) => {
    requireAuth(ctx);
    const records = (db.get().goldFingerRecords || [])
      .map((item) => {
        const yang = Math.max(0, Math.min(100, Number(item.yang) || 0));
        return { ...item, yang, yin: 100 - yang };
      })
      .slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.updatedAt || 0) - (a.updatedAt || 0));
    if (!Object.prototype.hasOwnProperty.call(ctx.query || {}, 'page')) return records;
    const page = Math.max(1, Number(ctx.query.page) || 1);
    const size = Math.max(1, Math.min(100, Number(ctx.query.size) || 20));
    const start = (page - 1) * size;
    return { list: records.slice(start, start + size), page, size, total: records.length, pages: Math.max(1, Math.ceil(records.length / size)) };
  });

  router.get('/api/admin/gold-finger/import-status', (ctx) => {
    requireAuth(ctx);
    return { initialized: db.get().goldFingerImportInitialized === true };
  });

  router.put('/api/admin/gold-finger/:date', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    const b = ctx.body || {};
    const date = validGoldFingerDate(ctx.params.date);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) throw new HttpError(400, '周末休市，无需维护金手指数据');
    const yang = goldPercent(b.yang, '阳谱');
    const yin = 100 - yang;
    const position = goldPercent(b.position, '仓位');
    if (!['gold', 'silver'].includes(b.finger)) throw new HttpError(400, '请选择金手指或银手指');
    if (!['up', 'down'].includes(b.trend)) throw new HttpError(400, '请选择中期趋势（上涨或下跌）');
    d.goldFingerRecords = Array.isArray(d.goldFingerRecords) ? d.goldFingerRecords : [];
    const now = Date.now();
    const record = {
      id: `gf_${date.replace(/-/g, '')}`,
      date,
      yin,
      yang,
      finger: b.finger,
      trend: b.trend,
      position,
      updatedAt: now,
    };
    const index = d.goldFingerRecords.findIndex((item) => item.date === date);
    if (index >= 0) d.goldFingerRecords[index] = record;
    else d.goldFingerRecords.push(record);
    db.save();
    return record;
  });

  router.delete('/api/admin/gold-finger/:date', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    const date = validGoldFingerDate(ctx.params.date);
    const before = (d.goldFingerRecords || []).length;
    d.goldFingerRecords = (d.goldFingerRecords || []).filter((item) => item.date !== date);
    if (d.goldFingerRecords.length === before) throw new HttpError(404, '记录不存在');
    db.save();
    return { ok: true };
  });

  // 批量注入：首次初始化覆盖本批数据；完成后历史日期只补缺，数组最后一项始终允许更新。
  router.post('/api/admin/gold-finger/import', (ctx) => {
    requireAuth(ctx);
    const imported = parseGoldFingerImport((ctx.body || {}).jsonText);
    const d = db.get();
    d.goldFingerRecords = Array.isArray(d.goldFingerRecords) ? d.goldFingerRecords : [];
    const recordsByDate = new Map(d.goldFingerRecords.map((item) => [item.date, item]));
    const orderedImported = imported.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const inheritedFingerFor = (date) => {
      const previous = Array.from(recordsByDate.values())
        .filter((item) => String(item.date) < date && ['gold', 'silver'].includes(item.finger))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      return previous && previous.finger;
    };
    const nextImportedFingerFor = (date) => {
      const next = orderedImported.find((item) => String(item.date) > date && item.finger);
      return next && next.finger;
    };
    const latestSourceIndex = imported.length - 1;
    const initializing = d.goldFingerImportInitialized !== true;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let initialFingerInferred = 0;
    orderedImported.forEach((item) => {
      const existing = recordsByDate.get(item.date);
      // 首次初始化覆盖整批数据；之后只有原数组末项会更新已有记录。
      if (existing && !initializing && item.sourceIndex !== latestSourceIndex) {
        skipped += 1;
        return;
      }
      const inherited = inheritedFingerFor(item.date);
      const finger = item.finger || inherited || nextImportedFingerFor(item.date);
      if (!finger) throw new HttpError(400, `${item.date}使用“-”时需要存在前一个交易日或后续首个金/银手指数据`);
      if (!item.finger && !inherited) initialFingerInferred += 1;
      const record = {
        id: `gf_${item.date.replace(/-/g, '')}`,
        date: item.date,
        yang: item.yang,
        yin: item.yin,
        finger,
        trend: item.trend,
        position: item.position,
        updatedAt: Date.now(),
      };
      if (existing) {
        const index = d.goldFingerRecords.findIndex((entry) => entry.date === item.date);
        d.goldFingerRecords[index] = record;
        updated += 1;
      } else {
        d.goldFingerRecords.push(record);
        created += 1;
      }
      recordsByDate.set(item.date, record);
    });
    d.goldFingerImportInitialized = true;
    db.save();
    return {
      initializing,
      created,
      updated,
      skipped,
      initialFingerInferred,
      latestDate: imported[latestSourceIndex].date,
      total: d.goldFingerRecords.length,
    };
  });

  router.get('/api/admin/gold-finger-banners', (ctx) => {
    requireAuth(ctx);
    return db.get().goldFingerBanners || [];
  });

  router.put('/api/admin/gold-finger-banners', (ctx) => {
    requireAuth(ctx);
    const d = db.get();
    const items = (ctx.body || {}).banners;
    if (!Array.isArray(items) || items.length > 10) throw new HttpError(400, '轮播图最多10张');
    const seen = new Set();
    d.goldFingerBanners = items.map((item, index) => {
      const image = String(item && item.image || '').trim();
      const noteId = String(item && item.noteId || '').trim();
      if (!image || !/^(https?:\/\/|\/uploads\/)/i.test(image)) throw new HttpError(400, `第${index + 1}张轮播图图片无效`);
      if (!d.notes.some((note) => note.id === noteId && note.type === 'ad')) throw new HttpError(400, `第${index + 1}张轮播图请选择广告类型笔记`);
      let id = String(item.id || '').trim();
      if (!id || seen.has(id)) id = 'gfb_' + Date.now() + '_' + index + '_' + crypto.randomBytes(2).toString('hex');
      seen.add(id);
      return { id, image, noteId };
    });
    db.save();
    return d.goldFingerBanners;
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
      riskDisclaimerEnabled: b.riskDisclaimerEnabled !== false,
      visible: b.visible !== false,
      free: b.free === true,
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
    if (Object.prototype.hasOwnProperty.call(b, 'riskDisclaimerEnabled')) {
      note.riskDisclaimerEnabled = b.riskDisclaimerEnabled === true;
    }
    if (Object.prototype.hasOwnProperty.call(b, 'visible')) {
      note.visible = b.visible !== false;
    } else if (typeof note.visible !== 'boolean') {
      note.visible = true;
    }
    if (Object.prototype.hasOwnProperty.call(b, 'free')) {
      note.free = b.free === true;
    } else if (typeof note.free !== 'boolean') {
      note.free = false;
    }
    const hasProviderFields = Object.prototype.hasOwnProperty.call(b, 'baiduUrl')
      || Object.prototype.hasOwnProperty.call(b, 'quarkUrl');
    Object.assign(note, normalizeResourceLinks(note, note.type, !hasProviderFields));
    if (d.settings && d.settings.featuredNoteId === note.id && note.type !== 'gold') {
      throw new HttpError(400, '加号入口笔记必须保持为金手指类型');
    }
    if ((d.goldFingerBanners || []).some((item) => item.noteId === note.id) && note.type !== 'ad') {
      throw new HttpError(400, '该笔记正在被金手指Banner使用，必须保持为广告类型');
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
    if ((d.goldFingerBanners || []).some((item) => item.noteId === ctx.params.id)) {
      throw new HttpError(400, '该笔记正在被金手指Banner使用，请先修改或删除对应Banner');
    }
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
        user: user ? { id: user.id, name: user.name, phone: user.phone || '' } : { id: userId, name: '用户不存在', phone: '' },
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
      return { ...item, user: user ? { id: user.id, name: user.name, phone: user.phone || '' } : null };
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
        user: user ? { id: user.id, name: user.name, avatar: user.avatar, phone: user.phone || '' } : null,
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
    if (baseCategories.includes(oldName)) throw new HttpError(400, '资料、课程、金手指、广告为系统类型，不能修改');
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
    if (baseCategories.includes(name)) throw new HttpError(400, '资料、课程、金手指、广告为系统类型，不能删除');
    if (!d.categories.includes(name)) throw new HttpError(404, '笔记类型不存在');
    if (d.notes.some((note) => note.category === name)) throw new HttpError(400, '该类型下还有笔记，请先更换笔记类型');
    d.categories = d.categories.filter((item) => item !== name);
    db.save();
    return d.categories;
  });
};
