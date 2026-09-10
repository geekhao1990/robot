const api = require('../../utils/api');
const store = require('../../utils/store');

Page({
  data: {
    tab: 'query',
    stockCode: '',
    tradeDate: '',
    compactTradeDate: '',
    dateLoading: true,
    historyLoading: false,
    orders: [],
    paymentVisible: false,
    paymentPending: false,
    pendingCode: '',
  },
  onLoad(options) {
    if (!store.isLogin()) return wx.redirectTo({ url: '/pages/login/login' });
    const tab = options && options.tab === 'history' ? 'history' : 'query';
    this.setData({ tab });
    this.loadTradeDate();
    if (tab === 'history') this.loadOrders();
  },
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.tab) return;
    this.setData({ tab });
    if (tab === 'history') this.loadOrders();
  },
  loadTradeDate() {
    this.setData({ dateLoading: true });
    api.getDarkFundTradeDate()
      .then((result) => this.setData({ tradeDate: result.tradeDate, compactTradeDate: result.compactTradeDate }))
      .catch(() => wx.showToast({ title: '交易日获取失败', icon: 'none' }))
      .finally(() => this.setData({ dateLoading: false }));
  },
  onCodeInput(e) {
    this.setData({ stockCode: String(e.detail.value || '').replace(/\D/g, '').slice(0, 6) });
  },
  prepareQuery() {
    const stockCode = String(this.data.stockCode || '').trim();
    if (!/^\d{6}$/.test(stockCode)) return wx.showModal({ title: '无法查询', content: '请输入6位股票代码', showCancel: false });
    if (!this.data.compactTradeDate) return wx.showToast({ title: '请稍后重试', icon: 'none' });
    wx.showModal({
      title: '确认查询',
      content: `是否查询${stockCode}的${this.data.compactTradeDate}的暗盘数据`,
      confirmText: '确定',
      success: (result) => {
        if (result.confirm) this.setData({ paymentVisible: true, pendingCode: stockCode });
      },
    });
  },
  closePayment() {
    if (!this.data.paymentPending) this.setData({ paymentVisible: false });
  },
  noop() {},
  pay() {
    if (this.data.paymentPending) return;
    this.setData({ paymentPending: true });
    wx.showLoading({ title: '创建订单', mask: true });
    api.createDarkFundOrder(this.data.pendingCode)
      .then((order) => {
        wx.hideLoading();
        if (!order || !order.orderId || !order.payment) throw new Error('支付订单创建失败');
        return this.requestPayment(order.payment).then(() => this.confirmPayment(order.orderId, 5));
      })
      .catch((error) => {
        wx.hideLoading();
        const message = this.errorText(error);
        if (/cancel/i.test(message)) wx.showToast({ title: '已取消支付', icon: 'none' });
        else wx.showModal({ title: '支付失败', content: message, showCancel: false });
      })
      .finally(() => this.setData({ paymentPending: false }));
  },
  requestPayment(payment) {
    return new Promise((resolve, reject) => wx.requestPayment({
      timeStamp: payment.timeStamp,
      nonceStr: payment.nonceStr,
      package: payment.package,
      signType: payment.signType || 'RSA',
      paySign: payment.paySign,
      success: resolve,
      fail: reject,
    }));
  },
  confirmPayment(orderId, retries) {
    wx.showLoading({ title: '确认支付', mask: true });
    return api.getDarkFundOrder(orderId).then((order) => {
      if (order && order.status === 'SUCCESS') {
        wx.hideLoading();
        this.setData({ paymentVisible: false });
        wx.navigateTo({ url: `/pages/dark-funds-order/dark-funds-order?id=${encodeURIComponent(orderId)}` });
        return order;
      }
      if (retries > 0) return new Promise((resolve) => setTimeout(resolve, 1000)).then(() => this.confirmPayment(orderId, retries - 1));
      throw new Error('支付结果确认中，请稍后在历史订单中查看');
    });
  },
  loadOrders() {
    this.setData({ historyLoading: true });
    api.getDarkFundOrders()
      .then((orders) => this.setData({ orders: (orders || []).map((item) => ({ ...item, amountText: (Number(item.amount || 0) / 100).toFixed(2) })) }))
      .catch(() => wx.showToast({ title: '订单加载失败', icon: 'none' }))
      .finally(() => this.setData({ historyLoading: false }));
  },
  openOrder(e) {
    wx.navigateTo({ url: `/pages/dark-funds-order/dark-funds-order?id=${encodeURIComponent(e.currentTarget.dataset.id)}` });
  },
  errorText(error) {
    return (error && (error.errMsg || (error.data && error.data.error) || error.message)) || '请稍后重试';
  },
});
