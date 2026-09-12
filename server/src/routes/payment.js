const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const { getPlan, activateMembership, refreshDarkFundQuota, consumeDarkFundQuota } = require('../membership');
const wechatPay = require('../wechat-pay');
const { pubUser } = require('../util');
const { latestTradingDate, compactDate } = require('../trading-date');

function orderNo() {
  return `VIP${Date.now()}${crypto.randomBytes(4).toString('hex')}`.slice(0, 32);
}

function darkFundOrderNo() {
  return `DF${Date.now()}${crypto.randomBytes(5).toString('hex')}`.slice(0, 32);
}

function defaultDarkFundCopy(order) {
  const parts = String(order.tradeDate || '').split('-').map(Number);
  const date = parts.length === 3 && parts.every(Number.isFinite)
    ? `${parts[0]}年${parts[1]}月${parts[2]}日`
    : String(order.tradeDate || '');
  return `${date}，【股票名称】（${order.stockCode}）收盘报【收盘价】元，全天【上涨/下跌】【涨跌幅】%，成交额【成交额】亿元，换手率【换手率】%。从近5个交易日走势看，【价格、成交量与盘面节奏概述】。

从资金层面看，当日明盘大单资金【净流入/净流出】【金额】亿元，暗盘资金【净流入/净流出】【金额】亿元。【说明当日两类资金是同向、背离还是出现转折】。

拉长到近5个交易日，明盘资金累计【净流入/净流出】约【金额】亿元，暗盘资金累计【净流入/净流出】约【金额】亿元。【说明近5日资金节奏和关键交易日】。

结合价格、成交量与明暗两类资金变化，【对当日与近5日资金特征作出客观总结】。明盘资金反映普通软件可见的大单变化，暗盘资金用于补充观察拆单后的资金流向，两者结合有助于减少单一指标带来的误判。

如需持续查看暗盘资金数据，可通过暗盘资金功能查询，用于辅助理解盘面与资金节奏。

风险提示：以上分析结果仅代表大模型观点，仅供参考，不作为投资建议。本文不涉及投资咨询，提及股票不视为明示或暗示推荐，也不应理解为对未来收益的预期或保证。每个指标都有局限性，请理性判断，注意风险。`;
}

function activateOrder(d, order, transactionId) {
  if (order.status === 'SUCCESS') return;
  const user = d.users.find((item) => item.id === order.userId);
  if (!user) throw new Error('订单用户不存在');
  activateMembership(user, order.plan, Date.now());
  order.status = 'SUCCESS';
  order.paidAt = Date.now();
  order.transactionId = transactionId || order.transactionId || '';
  db.save();
}

const DARK_FUND_AUTHOR_ID = 'u1787979756047';

function ensureDarkFundAuthor(d) {
  let author = d.users.find((item) => item.id === DARK_FUND_AUTHOR_ID);
  if (!author) {
    author = {
      id: DARK_FUND_AUTHOR_ID,
      name: '暗盘',
      avatar: '/images/profile-dark-funds.png',
      desc: '暗盘资金数据',
      fans: 0,
      follows: 0,
      likes: 0,
      vip: false,
      vipPlan: '',
      vipExpire: 0,
      vipPermanent: false,
      official: true,
      darkFundEnabled: false,
      darkFundRemaining: 0,
      darkFundManualRemaining: 0,
      darkFundVipRemaining: 0,
      darkFundVipMonth: '',
      createdAt: Date.now(),
      tags: [],
    };
    d.users.push(author);
  }
  author.name = '暗盘';
  author.official = true;
  return author;
}

function activateDarkFundOrder(d, order, transactionId) {
  if (order.status === 'READY' || order.status === 'SUCCESS') return;
  const paidAt = Date.now();
  const shortDate = compactDate(order.tradeDate);
  const author = ensureDarkFundAuthor(d);
  order.status = 'READY';
  order.paidAt = paidAt;
  order.readyAt = paidAt;
  order.viewedAt = 0;
  order.transactionId = transactionId || order.transactionId || '';
  const images = Array.isArray(order.snapshotImages) ? order.snapshotImages.slice() : [];
  const note = {
    id: `dark_${order.id}`,
    visibility: 'public',
    title: `${order.stockCode}｜${shortDate}暗盘数据`,
    content: order.snapshotText || defaultDarkFundCopy(order),
    images,
    cover: images[0] || '',
    coverRatio: 1.25,
    authorId: author.id,
    author: { id: author.id, name: '暗盘', avatar: author.avatar || '' },
    category: '资料',
    type: 'material',
    tags: ['暗盘资金', order.stockCode],
    likes: crypto.randomInt(5, 101),
    collects: crypto.randomInt(5, 101),
    riskDisclaimerEnabled: true,
    visible: true,
    free: false,
    video: false,
    time: paidAt,
  };
  order.noteId = note.id;
  order.snapshot = {
    version: 1,
    product: '六位神奇数字',
    stockCode: order.stockCode,
    tradeDate: order.tradeDate,
    compactTradeDate: shortDate,
    generatedAt: paidAt,
    note,
  };
  d.notes = Array.isArray(d.notes) ? d.notes : [];
  if (!d.notes.some((item) => item.id === note.id)) d.notes.unshift(note);
  db.save();
}

function publicDarkFundOrder(order) {
  const ready = order.status === 'READY' || order.status === 'SUCCESS';
  return {
    id: order.id,
    stockCode: order.stockCode,
    tradeDate: order.tradeDate,
    compactTradeDate: compactDate(order.tradeDate),
    amount: order.amount,
    status: order.status,
    ready,
    unread: order.status === 'READY' && !order.viewedAt,
    createdAt: order.createdAt,
    paidAt: order.paidAt || 0,
    readyAt: order.readyAt || order.paidAt || 0,
    viewedAt: order.viewedAt || 0,
    noteId: order.noteId || (order.snapshot && order.snapshot.note && order.snapshot.note.id) || '',
    snapshot: order.snapshot || null,
  };
}

module.exports = function register(router, HttpError) {
  const currentUser = (ctx) => {
    const uid = auth.userIdFor(ctx.headers.authorization);
    if (!uid) throw new HttpError(401, '未登录');
    const user = db.get().users.find((item) => item.id === uid);
    if (!user) throw new HttpError(401, '用户不存在');
    return user;
  };

  router.post('/api/payments/orders', async (ctx) => {
    const user = currentUser(ctx);
    const plan = getPlan((ctx.body || {}).plan);
    if (!plan) throw new HttpError(400, '无效会员套餐');
    if (!user.wxOpenId || user.wxOpenId === 'local-preview-user') {
      throw new HttpError(503, '微信支付需完成真实微信登录后使用');
    }
    if (user.vipPermanent) throw new HttpError(400, '当前账号已经是永久会员');
    wechatPay.requireConfig();
    const d = db.get();
    d.paymentOrders = Array.isArray(d.paymentOrders) ? d.paymentOrders : [];
    const order = {
      id: orderNo(),
      userId: user.id,
      plan: plan.id,
      amount: plan.amount,
      status: 'CREATED',
      createdAt: Date.now(),
    };
    d.paymentOrders.push(order);
    db.save();
    try {
      const result = await wechatPay.createJsapiPayment({
        outTradeNo: order.id,
        description: `会员-${plan.name}`,
        amount: order.amount,
        openid: user.wxOpenId,
      });
      order.status = 'NOTPAY';
      order.prepayId = result.prepayId;
      db.save();
      return { orderId: order.id, payment: result.payment };
    } catch (err) {
      order.status = 'FAILED';
      order.error = err.message;
      db.save();
      throw err;
    }
  });

  router.get('/api/payments/orders/:id', async (ctx) => {
    const user = currentUser(ctx);
    const d = db.get();
    const order = (d.paymentOrders || []).find((item) => item.id === ctx.params.id && item.userId === user.id);
    if (!order) throw new HttpError(404, '订单不存在');
    if (order.status !== 'SUCCESS') {
      const result = await wechatPay.queryPayment(order.id);
      if (result.trade_state === 'SUCCESS') {
        const amount = result.amount || {};
        if (result.appid !== process.env.WECHAT_APP_ID || result.mchid !== process.env.WECHAT_PAY_MCH_ID ||
            result.out_trade_no !== order.id || amount.total !== order.amount || amount.currency !== 'CNY') {
          throw new HttpError(400, '微信支付订单信息不匹配');
        }
        activateOrder(d, order, result.transaction_id);
      } else order.status = result.trade_state || order.status;
      db.save();
    }
    return { orderId: order.id, status: order.status, user: pubUser(user, true) };
  });

  router.get('/api/dark-funds/trade-date', (ctx) => {
    const user = currentUser(ctx);
    if (user.darkFundEnabled !== true) throw new HttpError(403, '暗盘资金入口尚未开通');
    const quota = refreshDarkFundQuota(user);
    if (quota.changed) db.save();
    const tradeDate = latestTradingDate();
    return {
      tradeDate,
      compactTradeDate: compactDate(tradeDate),
      remaining: quota.total,
    };
  });

  router.post('/api/dark-funds/orders', (ctx) => {
    const user = currentUser(ctx);
    const stockCode = String((ctx.body || {}).stockCode || '').trim();
    if (!/^\d{6}$/.test(stockCode)) throw new HttpError(400, '请输入6位股票代码');
    if (user.darkFundEnabled !== true) throw new HttpError(403, '暗盘资金入口尚未开通');
    const consumed = consumeDarkFundQuota(user);
    if (!consumed) throw new HttpError(403, '暗盘资金查询次数已用完');
    const d = db.get();
    d.darkFundOrders = Array.isArray(d.darkFundOrders) ? d.darkFundOrders : [];
    const tradeDate = latestTradingDate();
    const order = {
      id: darkFundOrderNo(),
      userId: user.id,
      product: 'dark-funds',
      stockCode,
      tradeDate,
      amount: 0,
      quotaSource: consumed.source,
      status: 'PENDING',
      createdAt: Date.now(),
    };
    d.darkFundOrders.push(order);
    db.save();
    return { ...publicDarkFundOrder(order), orderId: order.id, remaining: consumed.total };
  });

  router.get('/api/dark-funds/orders', (ctx) => {
    const user = currentUser(ctx);
    return (db.get().darkFundOrders || [])
      .filter((item) => item.userId === user.id)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map(publicDarkFundOrder);
  });

  router.get('/api/dark-funds/orders/:id', (ctx) => {
    const user = currentUser(ctx);
    const d = db.get();
    const order = (d.darkFundOrders || []).find((item) => item.id === ctx.params.id && item.userId === user.id);
    if (!order) throw new HttpError(404, '订单不存在');
    if (order.status !== 'READY' && order.status !== 'SUCCESS') throw new HttpError(409, '查询结果尚未就绪');
    if (!order.viewedAt) order.viewedAt = Date.now();
    db.save();
    return publicDarkFundOrder(order);
  });

  router.put('/api/admin/dark-fund-orders/:id/complete', (ctx) => {
    if (!auth.isAdmin(ctx.headers.authorization)) throw new HttpError(401, '未登录或登录失效');
    const d = db.get();
    const order = (d.darkFundOrders || []).find((item) => item.id === ctx.params.id);
    if (!order) throw new HttpError(404, '工单不存在');
    if (order.status === 'READY' || order.status === 'SUCCESS') throw new HttpError(409, '该工单已完成');
    const body = ctx.body || {};
    const images = Array.isArray(body.images)
      ? body.images.map((item) => String(item || '').trim()).filter((item) => /^(https?:\/\/|\/uploads\/)/i.test(item)).slice(0, 9)
      : [];
    if (!images.length) throw new HttpError(400, '请上传暗盘资金截图');
    const content = String(body.content || '').trim().slice(0, 5000);
    if (!content) throw new HttpError(400, '请填写结果文字');
    if (/[【】]/.test(content)) throw new HttpError(400, '请先替换结果文字中的所有占位内容');
    order.snapshotImages = images;
    order.snapshotText = content;
    activateDarkFundOrder(d, order, 'ADMIN');
    return publicDarkFundOrder(order);
  });

  router.post('/api/payments/notify', (ctx) => {
    const transaction = wechatPay.verifyAndDecryptNotification(ctx.headers, ctx.rawBody || '');
    if (!transaction) return { code: 'SUCCESS', message: '成功' };
    const d = db.get();
    let kind = 'vip';
    let order = (d.paymentOrders || []).find((item) => item.id === transaction.out_trade_no);
    if (!order) {
      order = (d.darkFundOrders || []).find((item) => item.id === transaction.out_trade_no);
      kind = 'dark-funds';
    }
    if (!order) throw new HttpError(404, '订单不存在');
    if (transaction.appid !== process.env.WECHAT_APP_ID || transaction.mchid !== process.env.WECHAT_PAY_MCH_ID) {
      throw new HttpError(400, '支付回调商户信息不匹配');
    }
    const paidAmount = transaction.amount || {};
    if (transaction.trade_state !== 'SUCCESS' || paidAmount.total !== order.amount || paidAmount.currency !== 'CNY') {
      throw new HttpError(400, '支付回调订单信息不匹配');
    }
    if (kind === 'dark-funds') activateDarkFundOrder(d, order, transaction.transaction_id);
    else activateOrder(d, order, transaction.transaction_id);
    return { code: 'SUCCESS', message: '成功' };
  });
};
