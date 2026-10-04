const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const wechatPay = require('../wechat-pay');
const { addManualDarkFundQuota, refreshDarkFundQuota } = require('../membership');
const { pubUser } = require('../util');
const { pushNotification } = require('../notifications');

const DAY_MS = 24 * 3600 * 1000;
const PRODUCTS = Object.freeze({
  dark_fund_once: Object.freeze({
    id: 'dark_fund_once', amount: 99, quota: 1, prefix: 'DFP', description: '暗盘单次查询', goodsName: '暗盘单次查询',
  }),
  dark_fund_10: Object.freeze({
    id: 'dark_fund_10', amount: 600, quota: 10, prefix: 'DF10', description: '充值暗盘次数（10次）', goodsName: '暗盘查询次数充值10次',
  }),
  dark_fund_100: Object.freeze({
    id: 'dark_fund_100', amount: 5000, quota: 100, prefix: 'DF100', description: '充值暗盘次数（100次）', goodsName: '暗盘查询次数充值100次',
  }),
  dark_fund_500: Object.freeze({
    id: 'dark_fund_500', amount: 20000, quota: 500, prefix: 'DF500', description: '充值暗盘次数（500次）', goodsName: '暗盘查询次数充值500次',
  }),
  dark_fund_1000: Object.freeze({
    id: 'dark_fund_1000', amount: 30000, quota: 1000, prefix: 'DF1000', description: '充值暗盘次数（1000次）', goodsName: '暗盘查询次数充值1000次',
  }),
  gold_year: Object.freeze({
    id: 'gold_year', amount: 990, prefix: 'GYP', description: '开通金手指（1年）', goodsName: '金手指年卡（360天）',
  }),
});

function orderNo(prefix) {
  return `${prefix}${Date.now()}${crypto.randomBytes(5).toString('hex')}`.slice(0, 32);
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
  const product = PRODUCTS[order.product];
  if (product && product.quota) {
    addManualDarkFundQuota(user, product.quota);
    user.darkFundEnabled = true;
  } else if (order.product === PRODUCTS.gold_year.id) {
    const now = Date.now();
    user.goldExpire = Math.max(Number(user.goldExpire) || 0, now) + 360 * DAY_MS;
  } else {
    throw Object.assign(new Error('支付商品无效'), { status: 400 });
  }
  order.status = 'SUCCESS';
  order.paidAt = order.paidAt || Date.now();
  order.creditedAt = order.creditedAt || Date.now();
  order.transactionId = transactionId || order.transactionId || '';
  const notification = order.product === PRODUCTS.gold_year.id
    ? {
      type: 'gold_opened',
      title: '金手指已开通',
      content: '9.9元金手指年卡购买成功，有效期已增加360天。',
      targetType: 'gold',
      dedupeKey: `gold-payment:${order.id}`,
    }
    : {
      type: 'dark_recharge',
      title: '暗盘查询次数到账',
      content: `${(order.amount / 100).toFixed(2)}元购买成功，已增加${product.quota}次长期有效暗盘查询。`,
      targetType: 'dark_history',
      dedupeKey: `dark-fund-payment:${order.id}`,
    };
  pushNotification(data, user.id, notification);
  db.save();
  return true;
}

function publicOrder(order, user) {
  const quota = refreshDarkFundQuota(user);
  return {
    orderId: order.id,
    product: order.product,
    amount: order.amount,
    creditedQuota: Number((PRODUCTS[order.product] || {}).quota) || 0,
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

  const createOrder = async (ctx, product) => {
    const user = currentUser(ctx);
    if (!user.wxOpenId || user.wxOpenId === 'local-preview-user') {
      throw new HttpError(503, '请使用真实微信账号登录后支付');
    }
    wechatPay.requireConfig();
    const data = db.get();
    data.paymentOrders = Array.isArray(data.paymentOrders) ? data.paymentOrders : [];
    const order = {
      id: orderNo(product.prefix),
      userId: user.id,
      product: product.id,
      amount: product.amount,
      status: 'CREATED',
      createdAt: Date.now(),
    };
    data.paymentOrders.push(order);
    db.save();
    try {
      const result = await wechatPay.createJsapiPayment({
        outTradeNo: order.id,
        description: product.description,
        merchantGoodsId: product.id,
        goodsName: product.goodsName,
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
  };

  const getOrder = async (ctx, product) => {
    const user = currentUser(ctx);
    const data = db.get();
    const order = (data.paymentOrders || []).find((item) => item.id === ctx.params.id && item.userId === user.id && item.product === product.id);
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
  };

  router.post('/api/dark-funds/purchase-orders', (ctx) => createOrder(ctx, PRODUCTS.dark_fund_once));
  router.get('/api/dark-funds/purchase-orders/:id', (ctx) => getOrder(ctx, PRODUCTS.dark_fund_once));
  router.post('/api/dark-funds/topup-orders', (ctx) => {
    const sku = String((ctx.body || {}).sku || '').trim();
    const product = [PRODUCTS.dark_fund_10, PRODUCTS.dark_fund_100, PRODUCTS.dark_fund_500, PRODUCTS.dark_fund_1000].find((item) => item.id === sku);
    if (!product) throw new HttpError(400, '请选择有效的暗盘次数套餐');
    return createOrder(ctx, product);
  });
  router.get('/api/dark-funds/topup-orders/:id', (ctx) => {
    const data = db.get();
    const order = (data.paymentOrders || []).find((item) => item.id === ctx.params.id);
    const product = order && [PRODUCTS.dark_fund_10, PRODUCTS.dark_fund_100, PRODUCTS.dark_fund_500, PRODUCTS.dark_fund_1000].find((item) => item.id === order.product);
    if (!product) throw new HttpError(404, '支付订单不存在');
    return getOrder(ctx, product);
  });
  router.post('/api/gold/purchase-orders', (ctx) => createOrder(ctx, PRODUCTS.gold_year));
  router.get('/api/gold/purchase-orders/:id', (ctx) => getOrder(ctx, PRODUCTS.gold_year));

  router.post('/api/payments/notify', (ctx) => {
    const transaction = wechatPay.verifyAndDecryptNotification(ctx.headers, ctx.rawBody || '');
    if (!transaction) return { code: 'SUCCESS', message: '成功' };
    const data = db.get();
    const order = (data.paymentOrders || []).find((item) => item.id === transaction.out_trade_no && PRODUCTS[item.product]);
    if (!order) throw new HttpError(404, '支付订单不存在');
    if (!transactionMatches(transaction, order)) throw new HttpError(400, '支付回调订单信息不匹配');
    activateOrder(data, order, transaction.transaction_id);
    return { code: 'SUCCESS', message: '成功' };
  });
};
