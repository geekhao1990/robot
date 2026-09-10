const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const { activateMembership } = require('../membership');
const { pubUser } = require('../util');

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
  router.get('/api/admin/gift-cards', (ctx) => {
    admin(ctx);
    const page = Math.max(1, Math.floor(Number(ctx.query.page) || 1));
    const cards = (db.get().giftCards || []).slice().reverse();
    return { list: cards.slice((page - 1) * 20, page * 20).map(summary), page, total: cards.length, pages: Math.max(1, Math.ceil(cards.length / 20)) };
  });
  router.post('/api/admin/gift-cards', (ctx) => {
    admin(ctx);
    const body = ctx.body || {};
    const type = body.type;
    const count = body.count === undefined ? 10 : Number(body.count);
    const days = type === 'month' ? 30 : 360;
    if (!['gold', 'month'].includes(type)) throw new HttpError(400, '请选择金手指卡或月卡');
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
        cards.push({ id: crypto.randomUUID(), batchId, type, days, code: formattedCode, codeHash: digest(code), createdAt: Date.now(), status: 'unused' });
      }
      data.giftCards = previous.concat(cards);
      try { await db.save(); } catch (error) { data.giftCards = previous; throw error; }
      return { batchId, type, days, codes };
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
      if (card.status !== 'unused') {
        if (card.status === 'redeemed' && card.redeemedBy === userId) return { alreadyRedeemed: true, type: card.type, days: card.days, user: pubUser(user, true) };
        throw new HttpError(409, '该卡密已被使用');
      }
      const oldUser = { ...user };
      const oldCard = { ...card };
      const now = Date.now();
      if (card.type === 'month') activateMembership(user, 'month', now);
      else user.goldExpire = Math.max(Number(user.goldExpire) || 0, now) + card.days * 86400000;
      Object.assign(card, { status: 'redeemed', redeemedBy: userId, redeemedAt: now });
      try { await db.save(); } catch (error) {
        Object.keys(user).forEach((key) => delete user[key]); Object.assign(user, oldUser);
        Object.keys(card).forEach((key) => delete card[key]); Object.assign(card, oldCard);
        throw error;
      }
      return { type: card.type, days: card.days, user: pubUser(user, true) };
    });
  });
};
