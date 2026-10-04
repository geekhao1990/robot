const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const wechatPay = require('../wechat-pay');
const { addManualDarkFundQuota, refreshDarkFundQuota } = require('../membership');
const { pubUser } = require('../util');
const { pushNotification } = require('../notifications');

const PRODUCT = 'dark_fund_once';
const AMOUNT = 99;

function orderNo() {
  return `DFP${Date.now()}${crypto.randomBytes(5).toString('hex')}`.slice(0, 32);
}

function transactionMatches(transaction, order) {
  const amount = transaction && transaction.amount || {};
  return transaction
    && transaction.trade_state === 'SUCCESS'
    && transaction.appid === process.env.WECHAT_APP_ID
    && transaction.mchid === process.env.WECHAT_PAY_MCH_ID
    && transaction.out_trade_no === order.id
    && Number(amount.total) === order.amount
    && amount.currency === 'CNY';
}

function activateOrder(data, order, transactionId) {
  if (order.status === 'SUCCESS' && order.creditedAt) return false;
  const user = (data.users || []).find((item) => item.id === order.userId);
  if (!user) throw Object.assign(new Error('支付订单用户不存在'), { status: 404 });
  addManualDarkFundQuota(user, 1);
  user.darkFundEnabled = true;
  order.status = 'SUCCESS';
  order.paidAt = order.paidAt || Date.now();
  order.creditedAt = order.creditedAt || Date.now();
  order.transactionId = transactionId || order.transactionId || '';
  pushNotification(data, user.id, {
    type: 'dark_recharge',
    title: '暗盘查询次数到账',
    content: '0.99元单次查询购买成功，已增加1次长期有效暗盘查询。',
    targetType: 'dark_history',
    dedupeKey: `dark-fund-payment:${order.id}`,
  });
  db.save();
  return true;
}

function publicOrder(order, user) {
  const quota = refreshDarkFundQuota(user);
  return {
    orderId: order.id,
    product: order.product,
    amount: order.amount,
    status: order.status,
    remaining: quota.total,
    expiringRemaining: quota.service,
    permanentRemaining: quota.manual,
    user: pubUser(user),
  };
}

module.exports = function register(router, HttpError) {
  const currentUser = (ctx) => {
    const uid = auth.userIdFor(ctx.headers.authorization);
    if (!uid) throw new HttpError(401, '未登录');
    const user = (db.get().users || []).find((item) => item.id === uid);
    if (!user) throw new HttpError(401, '用户不存在');
    return user;
  };

  router.post('/api/dark-funds/purchase-orders', async (ctx) => {
    const user = currentUser(ctx);
    if (!user.wxOpenId || user.wxOpenId === 'local-preview-user') {
      throw new HttpError(503, '请使用真实微信账号登录后支付');
    }
    wechatPay.requireConfig();
    const data = db.get();
    data.paymentOrders = Array.isArray(data.paymentOrders) ? data.paymentOrders : [];
    const order = {
      id: orderNo(),
      userId: user.id,
      product: PRODUCT,
      amount: AMOUNT,
      status: 'CREATED',
      createdAt: Date.now(),
    };
    data.paymentOrders.push(order);
    db.save();
    try {
      const result = await wechatPay.createJsapiPayment({
        outTradeNo: order.id,
        description: '暗盘查询1次',
        amount: order.amount,
        openid: user.wxOpenId,
      });
      order.status = 'NOTPAY';
      order.prepayId = result.prepayId;
      db.save();
      return { orderId: order.id, amount: order.amount, payment: result.payment };
    } catch (error) {
      order.status = 'FAILED';
      order.error = String(error && error.message || '微信支付下单失败').slice(0, 300);
      db.save();
      throw error;
    }
  });

  router.get('/api/dark-funds/purchase-orders/:id', async (ctx) => {
    const user = currentUser(ctx);
    const data = db.get();
    const order = (data.paymentOrders || []).find((item) => item.id === ctx.params.id && item.userId === user.id && item.product === PRODUCT);
    if (!order) throw new HttpError(404, '支付订单不存在');
    if (order.status !== 'SUCCESS') {
      const transaction = await wechatPay.queryPayment(order.id);
      if (transaction.trade_state === 'SUCCESS') {
        if (!transactionMatches(transaction, order)) throw new HttpError(400, '微信支付订单信息不匹配');
        activateOrder(data, order, transaction.transaction_id);
      } else {
        order.status = String(transaction.trade_state || order.status || 'NOTPAY');
      }
      db.save();
    }
    return publicOrder(order, user);
  });

  router.post('/api/payments/notify', (ctx) => {
    const transaction = wechatPay.verifyAndDecryptNotification(ctx.headers, ctx.rawBody || '');
    if (!transaction) return { code: 'SUCCESS', message: '成功' };
    const data = db.get();
    const order = (data.paymentOrders || []).find((item) => item.id === transaction.out_trade_no && item.product === PRODUCT);
    if (!order) throw new HttpError(404, '支付订单不存在');
    if (!transactionMatches(transaction, order)) throw new HttpError(400, '支付回调订单信息不匹配');
    activateOrder(data, order, transaction.transaction_id);
    return { code: 'SUCCESS', message: '成功' };
  });
};
