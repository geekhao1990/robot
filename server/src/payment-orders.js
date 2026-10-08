const PRODUCTS = Object.freeze({
  dark_fund_once: Object.freeze({
    id: 'dark_fund_once', amount: 99, quota: 1, prefix: 'DFP', description: '暗盘单次查询', goodsName: '暗盘单次查询', orderName: '暗盘单次查询',
  }),
  dark_fund_10: Object.freeze({
    id: 'dark_fund_10', amount: 600, quota: 10, prefix: 'DF10', description: '充值暗盘次数（10次）', goodsName: '暗盘查询次数充值10次', orderName: '暗盘查询次数 · 10次',
  }),
  dark_fund_100: Object.freeze({
    id: 'dark_fund_100', amount: 5000, quota: 100, prefix: 'DF100', description: '充值暗盘次数（100次）', goodsName: '暗盘查询次数充值100次', orderName: '暗盘查询次数 · 100次',
  }),
  // 历史商品只用于查询旧订单，不再进入新下单 SKU 列表。
  dark_fund_500: Object.freeze({
    id: 'dark_fund_500', amount: 20000, quota: 500, prefix: 'DF500', description: '充值暗盘次数（500次）', goodsName: '暗盘查询次数充值500次', orderName: '暗盘查询次数 · 500次（历史）',
  }),
  dark_fund_300: Object.freeze({
    id: 'dark_fund_300', amount: 9900, quota: 300, prefix: 'DF300', description: '暗盘同价包月（300次）', goodsName: '暗盘查询同价包月300次', orderName: '暗盘同价包月 · 300次',
  }),
  dark_fund_1000: Object.freeze({
    id: 'dark_fund_1000', amount: 24000, quota: 1000, prefix: 'DF1000', description: '充值暗盘次数（1000次）', goodsName: '暗盘查询次数充值1000次', orderName: '暗盘查询次数 · 1000次',
  }),
  gold_year: Object.freeze({
    id: 'gold_year', amount: 9900, prefix: 'GYP', description: '开通金手指（360天）', goodsName: '金手指会员（360天）', orderName: '金手指会员 · 360天',
  }),
});

const STATUS_LABELS = Object.freeze({
  CREATED: '创建中',
  NOTPAY: '待付款',
  USERPAYING: '支付中',
  SUCCESS: '已付款',
  CLOSED: '已关闭',
  REVOKED: '已撤销',
  PAYERROR: '支付失败',
  FAILED: '下单失败',
  REFUND: '已退款',
});

function paymentOrderView(order, options = {}) {
  const product = PRODUCTS[order && order.product] || {};
  const status = String(order && order.status || 'CREATED').toUpperCase();
  const view = {
    orderId: String(order && order.id || ''),
    product: String(order && order.product || ''),
    productName: product.orderName || product.goodsName || String(order && order.product || '支付订单'),
    amount: Number(order && order.amount) || 0,
    status,
    statusLabel: STATUS_LABELS[status] || status,
    createdAt: Number(order && order.createdAt) || 0,
    paidAt: Number(order && order.paidAt) || 0,
    creditedAt: Number(order && order.creditedAt) || 0,
  };
  if (options.admin === true) {
    view.userId = String(order && order.userId || '');
    view.transactionId = String(order && order.transactionId || '');
    view.error = String(order && order.error || '');
  }
  return view;
}

module.exports = { PRODUCTS, STATUS_LABELS, paymentOrderView };
