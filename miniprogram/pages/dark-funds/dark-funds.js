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
    historyBadge: 0,
    waitingText: '',
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
  },
  onShow() {
    if (!store.isLogin()) return;
    this.loadOrders(true);
    this.stopOrderPolling();
    this._orderPollingTimer = setInterval(() => this.loadOrders(true), 10000);
  },
  onHide() {
    this.stopOrderPolling();
  },
  onUnload() {
    this.stopOrderPolling();
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
    wx.showLoading({ title: '提交中', mask: true });
    api.createDarkFundOrder(stockCode)
      .then((order) => {
        wx.hideLoading();
        if (!order || !order.orderId) throw new Error('工单提交失败');
        this.setData({ remaining: Number(order.remaining) || 0, waitingText: '等待查询价格' });
        this.loadOrders(true);
        wx.showModal({ title: '已提交', content: '等待查询价格', showCancel: false });
      })
      .catch((error) => {
        wx.hideLoading();
        wx.showModal({ title: '查询失败', content: this.errorText(error), showCancel: false });
      })
      .finally(() => this.setData({ querying: false }));
  },
  loadOrders(silent) {
    if (this._ordersRequesting) return Promise.resolve();
    this._ordersRequesting = true;
    if (!silent) this.setData({ historyLoading: true });
    return api.getDarkFundOrders()
      .then((orders) => {
        const normalized = (orders || []).map((item) => ({
          ...item,
          ready: item.ready === true || item.status === 'READY' || item.status === 'SUCCESS',
          statusText: item.ready === true || item.status === 'READY' || item.status === 'SUCCESS' ? '查询就绪' : '等待查询价格',
        }));
        const unread = normalized.filter((item) => item.ready && item.unread).length;
        this.setData({ orders: normalized, historyBadge: Math.min(99, unread) });
      })
      .catch(() => { if (!silent) wx.showToast({ title: '订单加载失败', icon: 'none' }); })
      .finally(() => {
        this._ordersRequesting = false;
        if (!silent) this.setData({ historyLoading: false });
      });
  },
  openOrder(e) {
    const order = this.data.orders.find((item) => item.id === e.currentTarget.dataset.id);
    if (!order || !order.ready) return wx.showToast({ title: '等待查询价格', icon: 'none' });
    wx.showLoading({ title: '加载中', mask: true });
    api.getDarkFundOrder(order.id)
      .then((readyOrder) => {
        if (!readyOrder || !readyOrder.noteId) throw new Error('查询结果不存在');
        this.setData({ historyBadge: Math.max(0, this.data.historyBadge - (order.unread ? 1 : 0)) });
        wx.navigateTo({ url: `/pages/detail/detail?id=${encodeURIComponent(readyOrder.noteId)}` });
      })
      .catch((error) => wx.showToast({ title: this.errorText(error), icon: 'none' }))
      .finally(() => wx.hideLoading());
  },
  stopOrderPolling() {
    if (this._orderPollingTimer) clearInterval(this._orderPollingTimer);
    this._orderPollingTimer = null;
  },
  errorText(error) {
    return (error && (error.errMsg || (error.data && error.data.error) || error.message)) || '请稍后重试';
  },
});
