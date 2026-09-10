const api = require('../../utils/api');
const store = require('../../utils/store');

Page({
  data: {
    tab: 'query',
    stockCode: '',
    tradeDate: '',
    compactTradeDate: '',
    remaining: 0,
    dateLoading: true,
    historyLoading: false,
    orders: [],
    querying: false,
  },
  onLoad(options) {
    if (!store.isLogin()) return wx.redirectTo({ url: '/pages/login/login' });
    const user = store.getUser();
    if (!user || user.darkFundEnabled !== true) {
      wx.showModal({ title: '暂不可用', content: '暗盘资金入口尚未开通', showCancel: false, complete: () => wx.navigateBack() });
      return;
    }
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
      .then((result) => this.setData({ tradeDate: result.tradeDate, compactTradeDate: result.compactTradeDate, remaining: Number(result.remaining) || 0 }))
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
        if (result.confirm) this.query(stockCode);
      },
    });
  },
  query(stockCode) {
    if (this.data.querying) return;
    this.setData({ querying: true });
    wx.showLoading({ title: '查询中', mask: true });
    api.createDarkFundOrder(stockCode)
      .then((order) => {
        wx.hideLoading();
        if (!order || !order.noteId) throw new Error('查询结果生成失败');
        this.setData({ remaining: Number(order.remaining) || 0 });
        wx.navigateTo({ url: `/pages/detail/detail?id=${encodeURIComponent(order.noteId)}` });
      })
      .catch((error) => {
        wx.hideLoading();
        wx.showModal({ title: '查询失败', content: this.errorText(error), showCancel: false });
      })
      .finally(() => this.setData({ querying: false }));
  },
  loadOrders() {
    this.setData({ historyLoading: true });
    api.getDarkFundOrders()
      .then((orders) => this.setData({ orders: orders || [] }))
      .catch(() => wx.showToast({ title: '订单加载失败', icon: 'none' }))
      .finally(() => this.setData({ historyLoading: false }));
  },
  openOrder(e) {
    const order = this.data.orders.find((item) => item.id === e.currentTarget.dataset.id);
    if (!order || !order.noteId) return wx.showToast({ title: '笔记不存在', icon: 'none' });
    wx.navigateTo({ url: `/pages/detail/detail?id=${encodeURIComponent(order.noteId)}` });
  },
  errorText(error) {
    return (error && (error.errMsg || (error.data && error.data.error) || error.message)) || '请稍后重试';
  },
});
