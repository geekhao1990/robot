const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const { getPlan, activateMembership } = require('../membership');
const wechatPay = require('../wechat-pay');
const { pubUser } = require('../util');

function orderNo() {
  return `VIP${Date.now()}${crypto.randomBytes(4).toString('hex')}`.slice(0, 32);
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

  router.post('/api/payments/notify', (ctx) => {
    const transaction = wechatPay.verifyAndDecryptNotification(ctx.headers, ctx.rawBody || '');
    if (!transaction) return { code: 'SUCCESS', message: '成功' };
    const d = db.get();
    const order = (d.paymentOrders || []).find((item) => item.id === transaction.out_trade_no);
    if (!order) throw new HttpError(404, '订单不存在');
    if (transaction.appid !== process.env.WECHAT_APP_ID || transaction.mchid !== process.env.WECHAT_PAY_MCH_ID) {
      throw new HttpError(400, '支付回调商户信息不匹配');
    }
    const paidAmount = transaction.amount || {};
    if (transaction.trade_state !== 'SUCCESS' || paidAmount.total !== order.amount || paidAmount.currency !== 'CNY') {
      throw new HttpError(400, '支付回调订单信息不匹配');
    }
    activateOrder(d, order, transaction.transaction_id);
    return { code: 'SUCCESS', message: '成功' };
  });
};
