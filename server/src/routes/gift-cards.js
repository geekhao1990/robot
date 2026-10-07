const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const { pubUser } = require('../util');
const { activateService, activateCloseDarkFund, addManualDarkFundQuota } = require('../membership');
const { pushNotification } = require('../notifications');

const CARD_TYPES = Object.freeze({
  gold: Object.freeze({ type: 'gold', label: '金手指卡', days: 360, quota: 5 }),
  service_month: Object.freeze({ type: 'service_month', label: '服务包月卡', days: 30, quota: 15 }),
  service_year: Object.freeze({ type: 'service_year', label: '服务包年卡', days: 360, quota: 15 }),
  dark_month: Object.freeze({ type: 'dark_month', label: '暗盘包月卡', days: 30, quota: 0 }),
  dark_1: Object.freeze({ type: 'dark_1', label: '暗盘1次卡', quota: 1 }),
  dark_50: Object.freeze({ type: 'dark_50', label: '暗盘50次卡', quota: 50 }),
  dark_100: Object.freeze({ type: 'dark_100', label: '暗盘100次卡', quota: 100 }),
  dark_180: Object.freeze({ type: 'dark_180', label: '暗盘180次卡', quota: 180 }),
});

// All card mutations are serialized; the card and entitlement are saved together.
let queue = Promise.resolve();
function serialize(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}
const digest = (code) => crypto.createHash('sha256').update(code).digest('hex');
const normalizeCode = (code) => String(code || '').replace(/[\s-]/g, '').toUpperCase();

module.exports = function register(router, HttpError) {
  const admin = (ctx) => {
    if (!auth.isAdmin(ctx.headers.authorization)) throw new HttpError(401, '请先登录管理后台');
  };
  const reader = (ctx) => {
    const id = auth.userIdFor(ctx.headers.authorization);
    const user = db.get().users.find((item) => item.id === id);
    if (!user) throw new HttpError(401, '请先登录');
    return user;
  };
  const summary = (card) => {
    const { codeHash, ...safe } = card;
    return safe;
  };
  const expireAtFor = (user, type) => {
    if (type === 'gold') return Number(user.goldExpire) || 0;
    if (type === 'service_month' || type === 'service_year') return Number(user.serviceExpire) || 0;
    if (type === 'dark_month') return Number(user.darkFundCloseExpire) || 0;
    return 0;
  };
  router.get('/api/admin/gift-cards', (ctx) => {
    admin(ctx);
    const page = Math.max(1, Math.floor(Number(ctx.query.page) || 1));
    const cards = (db.get().giftCards || []).slice().reverse();
    return { list: cards.slice((page - 1) * 20, page * 20).map(summary), page, total: cards.length, pages: Math.max(1, Math.ceil(cards.length / 20)) };
  });
  router.post('/api/admin/gift-cards', (ctx) => {
    admin(ctx);
    const body = ctx.body || {};
    const type = String(body.type || 'gold');
    const count = body.count === undefined ? 10 : Number(body.count);
    const definition = CARD_TYPES[type];
    if (!definition) throw new HttpError(400, '请选择有效的礼品卡类型');
    if (!Number.isInteger(count) || count < 1 || count > 10) throw new HttpError(400, '一次可生成1至10张礼品卡');
    return serialize(async () => {
      const data = db.get();
      const previous = data.giftCards || [];
      const batchId = crypto.randomUUID();
      const codes = [];
      const cards = [];
      const known = new Set(previous.map((card) => card.codeHash));
      for (let index = 0; index < count; index += 1) {
        let code;
        do { code = crypto.randomBytes(16).toString('hex').toUpperCase(); } while (known.has(digest(code)));
        known.add(digest(code));
        const formattedCode = code.match(/.{4}/g).join('-');
        codes.push(formattedCode);
        cards.push({ id: crypto.randomUUID(), batchId, ...definition, code: formattedCode, codeHash: digest(code), createdAt: Date.now(), status: 'unused' });
      }
      data.giftCards = previous.concat(cards);
      try { await db.save(); } catch (error) { data.giftCards = previous; throw error; }
      return { batchId, ...definition, codes };
    });
  });
  router.delete('/api/admin/gift-cards/:id', (ctx) => {
    admin(ctx);
    const id = String(ctx.params.id || '');
    return serialize(async () => {
      const data = db.get();
      const previous = data.giftCards || [];
      const card = previous.find((item) => item.id === id);
      if (!card) throw new HttpError(404, '礼品卡不存在');
      data.giftCards = previous.filter((item) => item.id !== id);
      try { await db.save(); } catch (error) { data.giftCards = previous; throw error; }
      return { ok: true };
    });
  });
  router.post('/api/gift-cards/redeem', (ctx) => {
    const userId = reader(ctx).id;
    const code = normalizeCode((ctx.body || {}).code);
    if (!/^[A-F0-9]{32}$/.test(code)) throw new HttpError(400, '卡密无效，请检查后重试');
    return serialize(async () => {
      const data = db.get();
      const user = data.users.find((item) => item.id === userId);
      if (!user) throw new HttpError(401, '用户不存在');
      const card = (data.giftCards || []).find((item) => item.codeHash === digest(code));
      if (!card) throw new HttpError(400, '卡密无效，请检查后重试');
      const definition = CARD_TYPES[card.type];
      if (!definition) throw new HttpError(410, '该卡种已停用，请联系管理员更换礼品卡');
      if (card.status !== 'unused') {
        if (card.status === 'redeemed' && card.redeemedBy === userId) return { alreadyRedeemed: true, type: card.type, label: definition.label, days: definition.days || 0, quota: definition.quota, expireAt: expireAtFor(user, card.type), user: pubUser(user, true) };
        throw new HttpError(409, '该卡密已被使用');
      }
      const oldUser = { ...user };
      const oldCard = { ...card };
      const oldNotifications = data.systemNotifications && Array.isArray(data.systemNotifications[userId])
        ? data.systemNotifications[userId].slice() : null;
      const now = Date.now();
      if (card.type === 'gold') {
        user.goldExpire = Math.max(Number(user.goldExpire) || 0, now) + definition.days * 86400000;
        addManualDarkFundQuota(user, definition.quota, now);
        user.goldQuotaGiftMigrated = true;
      } else if (card.type === 'service_month' || card.type === 'service_year') {
        activateService(user, card.type, now);
      } else if (card.type === 'dark_month') {
        activateCloseDarkFund(user, now);
      } else {
        addManualDarkFundQuota(user, definition.quota, now);
      }
      user.darkFundEnabled = true;
      Object.assign(card, { status: 'redeemed', redeemedBy: userId, redeemedAt: now });
      pushNotification(data, userId, {
        type: 'dark_recharge',
        title: card.type === 'dark_month' ? '暗盘包月开通成功' : '暗盘次数充值成功',
        content: card.type === 'dark_month'
          ? '暗盘包月已生效，30天内可无限次使用普通查询'
          : `${definition.label}已生效，当前剩余${Number(user.darkFundRemaining) || 0}次`,
        targetType: 'dark_home',
        dedupeKey: `gift-card:${card.id}`,
        createdAt: now,
      });
      try { await db.save(); } catch (error) {
        Object.keys(user).forEach((key) => delete user[key]); Object.assign(user, oldUser);
        Object.keys(card).forEach((key) => delete card[key]); Object.assign(card, oldCard);
        if (oldNotifications) data.systemNotifications[userId] = oldNotifications;
        else if (data.systemNotifications) delete data.systemNotifications[userId];
        throw error;
      }
      return { type: card.type, label: definition.label, days: definition.days || 0, quota: definition.quota, expireAt: expireAtFor(user, card.type), user: pubUser(user, true) };
    });
  });
};
