const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const { getPlan, activateMembership, refreshDarkFundQuota, consumeDarkFundQuota } = require('../membership');
const wechatPay = require('../wechat-pay');
const { pubUser } = require('../util');
const { latestTradingDate, compactDate } = require('../trading-date');
const { activateDarkFundOrder, publicDarkFundOrder } = require('../dark-fund-orders');

function orderNo() {
  return `VIP${Date.now()}${crypto.randomBytes(4).toString('hex')}`.slice(0, 32);
}

function darkFundOrderNo() {
  return `DF${Date.now()}${crypto.randomBytes(5).toString('hex')}`.slice(0, 32);
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
    db.save();
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
    if (kind === 'dark-funds') {
      activateDarkFundOrder(d, order, transaction.transaction_id);
      db.save();
    } else activateOrder(d, order, transaction.transaction_id);
    return { code: 'SUCCESS', message: '成功' };
  });
};
