const api = require('../../utils/api');
const store = require('../../utils/store');
const config = require('../../utils/config');

function formatQueryTime(timestamp) {
  const date = new Date(Number(timestamp) || 0);
  if (!Number.isFinite(date.getTime()) || !Number(timestamp)) return '—';
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatExpiryDate(timestamp) {
  const date = new Date(Number(timestamp) || 0);
  if (!Number.isFinite(date.getTime()) || !Number(timestamp)) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const STOCK_NAME_INITIALS = {
  股: 'G', 份: 'F', 科: 'K', 技: 'J', 集: 'J', 团: 'T', 银: 'Y', 行: 'H', 能: 'N', 源: 'Y',
  实: 'S', 业: 'Y', 发: 'F', 展: 'Z', 电: 'D', 子: 'Z', 生: 'S', 物: 'W', 医: 'Y', 药: 'Y', 新: 'X', 材: 'C',
};

function displayStockName(name) {
  const chars = Array.from(String(name || '').trim());
  if (chars.length <= 2) return chars.join('');
  return `${chars.slice(0, 2).join('')}${chars.slice(2).map((char) => STOCK_NAME_INITIALS[char] || char).join('')}`;
}

function marketStockCode(code) {
  const value = String(code || '').replace(/^(sh|sz)/i, '');
  return `${/^[569]/.test(value) ? 'sh' : 'sz'}${value}`;
}

Page({
  data: {
    tab: 'query',
    stockCode: '',
    stockSuggestion: null,
    stockLookupLoading: false,
    stockLookupError: '',
    tradeDate: '',
    compactTradeDate: '',
    remaining: 0,
    expiringRemaining: 0,
    permanentRemaining: 0,
    quotaExpiryText: '',
    closeMonthlyActive: false,
    closeMonthlyExpiryText: '',
    queryAdUnitId: /^adunit-/i.test(String(config.darkFundsQueryAdUnitId || ''))
      ? String(config.darkFundsQueryAdUnitId)
      : '',
    historyAdUnitId: /^adunit-/i.test(String(config.darkFundsHistoryAdUnitId || ''))
      ? String(config.darkFundsHistoryAdUnitId)
      : '',
    queryAdLoadFailed: false,
    dateLoading: true,
    historyLoading: false,
    orders: [],
    historyPage: 1,
    historyTotalPages: 1,
    historyTotal: 0,
    historyBadge: 0,
    historyAdLoadFailed: false,
    waitingText: '',
    querying: false,
    serviceQrVisible: false,
    serviceQrTitle: '',
    serviceQrDescription: '',
    serviceQrImage: '',
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
    api.getAppSettings().then((settings) => {
      const id = String((settings && settings.darkFundsQueryAdUnitId) || config.darkFundsQueryAdUnitId || '');
      const historyId = String((settings && settings.darkFundsHistoryAdUnitId) || config.darkFundsHistoryAdUnitId || '');
      this.setData({
        queryAdUnitId: /^adunit-/i.test(id) ? id : '',
        historyAdUnitId: /^adunit-/i.test(historyId) ? historyId : '',
        queryAdLoadFailed: false,
        historyAdLoadFailed: false,
      });
      this.setupCloseInterstitial(settings && settings.darkFundsCloseInterstitialAdUnitId);
    });
    this.loadTradeDate();
  },
  onShow() {
    if (!store.isLogin()) return;
    this.loadOrders(true);
  },
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.tab) return;
    this.setData({ tab });
    if (tab === 'history') this.loadOrders(false, 1);
  },
  loadTradeDate() {
    this.setData({ dateLoading: true });
    return api.getDarkFundTradeDate()
      .then((result) => this.setData({
        tradeDate: result.tradeDate,
        compactTradeDate: result.compactTradeDate,
        ...this.quotaData(result),
      }))
      .catch(() => wx.showToast({ title: '交易日获取失败', icon: 'none' }))
      .finally(() => this.setData({ dateLoading: false }));
  },
  onCodeInput(e) {
    const stockCode = String(e.detail.value || '').replace(/\D/g, '').slice(0, 6);
    const sequence = (this._stockLookupSequence || 0) + 1;
    this._stockLookupSequence = sequence;
    this.setData({ stockCode, stockSuggestion: null, stockLookupError: '', stockLookupLoading: false });
    if (!/^\d{6}$/.test(stockCode)) return;
    if (/^(4|8|92)/.test(stockCode)) {
      this.setData({ stockLookupError: '系统繁忙' });
      wx.showToast({ title: '系统繁忙', icon: 'none' });
      return;
    }
    this.setData({ stockLookupLoading: true });
    api.lookupStock(stockCode)
      .then((result) => {
        if (sequence !== this._stockLookupSequence || this.data.stockCode !== stockCode) return;
        this.setData({
          stockSuggestion: {
            stockCode: String(result.stockCode || stockCode),
            stockName: String(result.stockName || ''),
            stockDisplayName: displayStockName(result.stockName || ''),
            matched: result.matched === true,
          },
          stockLookupError: '',
        });
      })
      .catch((error) => {
        if (sequence !== this._stockLookupSequence || this.data.stockCode !== stockCode) return;
        this.setData({ stockSuggestion: null, stockLookupError: this.errorText(error) });
      })
      .finally(() => {
        if (sequence === this._stockLookupSequence) this.setData({ stockLookupLoading: false });
      });
  },
  prepareQuery(e) {
    const stockCode = String(this.data.stockCode || '').trim();
    const queryMode = e.currentTarget.dataset.mode === 'intraday' ? 'intraday' : 'close';
    const source = queryMode === 'intraday' ? 'collector' : 'web';
    if (!/^\d{6}$/.test(stockCode)) return wx.showModal({ title: '无法查询', content: '请输入6位代码', showCancel: false });
    if (/^(4|8|92)/.test(stockCode)) return wx.showToast({ title: '系统繁忙', icon: 'none' });
    if (this.data.stockLookupLoading) return wx.showToast({ title: '正在确认股票信息', icon: 'none' });
    if (!this.data.stockSuggestion || this.data.stockSuggestion.stockCode !== stockCode) {
      return wx.showToast({ title: this.data.stockLookupError || '请先确认股票代码', icon: 'none' });
    }
    if (!this.data.compactTradeDate) return wx.showToast({ title: '请稍后重试', icon: 'none' });
    const stockName = displayStockName(this.data.stockSuggestion.stockName);
    const content = queryMode === 'intraday'
      ? `是否查询暗盘【盘中】数据：${stockCode}${stockName ? ` ${stockName}` : ''}，查询日期${this.data.compactTradeDate}`
      : `是否查询暗盘【盘后】数据：${stockCode}${stockName ? ` ${stockName}` : ''}，查询近7日暗盘数据`;
    wx.showModal({
      title: '确认查询',
      content,
      confirmText: '确定',
      success: (result) => {
        if (!result.confirm) return;
        if (queryMode === 'close') {
          return this.showCloseInterstitial().finally(() => this.openMockCloseResult(stockCode));
        }
        return this.query(stockCode, queryMode, source);
      },
    });
  },
  openMockCloseResult(stockCode) {
    const stockName = this.data.stockSuggestion && this.data.stockSuggestion.stockName || '';
    wx.navigateTo({
      url: `/pages/dark-funds-result/dark-funds-result?mock=1&code=${encodeURIComponent(stockCode)}&name=${encodeURIComponent(stockName)}&date=${encodeURIComponent(this.data.tradeDate || this.data.compactTradeDate || '')}`,
      fail: () => wx.showToast({ title: '页面打开失败', icon: 'none' }),
    });
  },
  setupCloseInterstitial(value) {
    const adUnitId = String(value || config.darkFundsCloseInterstitialAdUnitId || '');
    if (!/^adunit-/i.test(adUnitId) || typeof wx.createInterstitialAd !== 'function') return;
    if (this.closeInterstitialAd && this.closeInterstitialAd.destroy) this.closeInterstitialAd.destroy();
    try { this.closeInterstitialAd = wx.createInterstitialAd({ adUnitId }); } catch (error) { this.closeInterstitialAd = null; }
  },
  showCloseInterstitial() {
    const ad = this.closeInterstitialAd;
    if (!ad || typeof ad.show !== 'function') return Promise.resolve(false);
    return Promise.resolve(ad.show())
      .then(() => true)
      .catch(() => (typeof ad.load === 'function'
        ? Promise.resolve(ad.load()).then(() => ad.show()).then(() => true).catch(() => false)
        : false));
  },
  query(stockCode, queryMode, source) {
    if (this.data.querying) return;
    this.setData({ querying: true });
    wx.showLoading({ title: '提交中', mask: true });
    const requestId = this.queryRequestId(stockCode, queryMode, source);
    api.createDarkFundOrder(stockCode, requestId, queryMode, source)
      .then((order) => {
        wx.hideLoading();
        if (!order || !order.orderId) throw new Error('工单提交失败');
        this.setData({ ...this.quotaData(order), waitingText: '等待结果' });
        this.clearQueryRequestId(requestId);
        this.loadOrders(true, 1);
        if (order.ready && order.resultType === 'close_snapshot') {
          return wx.navigateTo({ url: `/pages/dark-funds-result/dark-funds-result?id=${encodeURIComponent(order.orderId)}` });
        }
        wx.showModal({ title: order.ready ? '查询完成' : '已提交', content: order.ready ? '盘后数据已生成，请在订单列表查看' : '等待结果', showCancel: false });
      })
      .catch((error) => {
        wx.hideLoading();
        if (error && Number(error.statusCode) >= 400 && Number(error.statusCode) < 500) this.clearQueryRequestId(requestId);
        wx.showModal({ title: '查询失败', content: this.errorText(error), showCancel: false });
      })
      .finally(() => this.setData({ querying: false }));
  },
  loadOrders(silent, page = this.data.historyPage || 1) {
    if (this._ordersRequesting) return Promise.resolve();
    this._ordersRequesting = true;
    if (!silent) this.setData({ historyLoading: true });
    return api.getDarkFundOrders(page)
      .then((result) => {
        const rows = Array.isArray(result) ? result : ((result && result.list) || []);
        const normalized = rows.map((item) => {
          const ready = item.ready === true || item.status === 'READY' || item.status === 'SUCCESS';
          const failed = item.status === 'FAILED' || item.status === 'DISPATCH_FAILED';
          return {
            ...item,
            ready,
            failed,
            stockDisplayName: displayStockName(item.stockName),
            marketStockCode: marketStockCode(item.stockCode),
            queryTypeText: item.queryMode === 'close' ? '盘后查询' : '盘中查询',
            queryTimeText: formatQueryTime(item.createdAt),
            statusText: ready ? '点击查看' : (failed ? '查询失败' : '等待结果'),
          };
        });
        const unread = Array.isArray(result)
          ? normalized.filter((item) => item.ready && item.unread).length
          : Number(result && result.unread) || 0;
        this.setData({
          orders: normalized,
          historyBadge: Math.min(99, unread),
          historyPage: Array.isArray(result) ? 1 : (Number(result && result.page) || 1),
          historyTotalPages: Array.isArray(result) ? 1 : (Number(result && result.totalPages) || 1),
          historyTotal: Array.isArray(result) ? normalized.length : (Number(result && result.total) || 0),
        });
      })
      .catch(() => { if (!silent) wx.showToast({ title: '订单加载失败', icon: 'none' }); })
      .finally(() => {
        this._ordersRequesting = false;
        if (!silent) this.setData({ historyLoading: false });
      });
  },
  changeHistoryPage(e) {
    const page = Number(e.currentTarget.dataset.page);
    if (!Number.isInteger(page) || page < 1 || page > this.data.historyTotalPages || page === this.data.historyPage) return;
    this.loadOrders(false, page);
  },
  refreshOrders() {
    if (this.data.historyLoading) return;
    this.loadOrders(false, 1)
      .then(() => wx.showToast({ title: '订单已刷新', icon: 'success', duration: 1000 }));
  },
  onPullDownRefresh() {
    Promise.all([this.loadTradeDate(), this.loadOrders(true, this.data.tab === 'history' ? this.data.historyPage : 1)])
      .finally(() => wx.stopPullDownRefresh());
  },
  openOrder(e) {
    const order = this.data.orders.find((item) => item.id === e.currentTarget.dataset.id);
    if (!order || !order.ready) return wx.showToast({ title: order && order.failed ? (order.error || '查询失败，次数已退回') : '等待结果', icon: 'none' });
    api.getDarkFundOrder(order.id)
      .then((readyOrder) => {
        if (!readyOrder) throw new Error('查询结果不存在');
        this.setData({ historyBadge: Math.max(0, this.data.historyBadge - (order.unread ? 1 : 0)) });
        if (readyOrder.resultType === 'close_snapshot' && readyOrder.snapshot) {
          return new Promise((resolve, reject) => wx.navigateTo({
            url: `/pages/dark-funds-result/dark-funds-result?id=${encodeURIComponent(readyOrder.id)}`,
            success: resolve,
            fail: reject,
          }));
        }
        if (!readyOrder.noteId) throw new Error('查询结果不存在');
        return new Promise((resolve, reject) => wx.navigateTo({
          url: `/pages/detail/detail?id=${encodeURIComponent(readyOrder.noteId)}`,
          success: resolve,
          fail: reject,
        }));
      })
      .catch((error) => wx.showModal({ title: '加载失败', content: this.errorText(error), showCancel: false }));
  },
  queryRequestId(stockCode, queryMode, source) {
    const key = 'dark_fund_pending_request';
    const now = Date.now();
    let saved = null;
    try { saved = wx.getStorageSync(key); } catch (error) {}
    if (saved && saved.stockCode === stockCode && saved.tradeDate === this.data.tradeDate && saved.queryMode === queryMode && saved.source === source && now - Number(saved.createdAt) < 10 * 60 * 1000) {
      return saved.requestId;
    }
    const requestId = `df_${now}_${Math.random().toString(36).slice(2, 12)}`;
    try { wx.setStorageSync(key, { requestId, stockCode, tradeDate: this.data.tradeDate, queryMode, source, createdAt: now }); } catch (error) {}
    return requestId;
  },
  clearQueryRequestId(requestId) {
    try {
      const saved = wx.getStorageSync('dark_fund_pending_request');
      if (saved && saved.requestId === requestId) wx.removeStorageSync('dark_fund_pending_request');
    } catch (error) {}
  },
  quotaData(result) {
    return {
      remaining: Number(result && result.remaining) || 0,
      expiringRemaining: Number(result && result.expiringRemaining) || 0,
      permanentRemaining: Number(result && result.permanentRemaining) || 0,
      quotaExpiryText: formatExpiryDate(result && result.quotaExpiresAt),
      closeMonthlyActive: result && result.closeMonthlyActive === true,
      closeMonthlyExpiryText: formatExpiryDate(result && result.closeMonthlyExpireAt),
    };
  },
  onUnload() {
    if (this.closeInterstitialAd && this.closeInterstitialAd.destroy) this.closeInterstitialAd.destroy();
    this.closeInterstitialAd = null;
  },
  onQueryAdError() {
    this.setData({ queryAdLoadFailed: true });
  },
  onHistoryAdError() {
    this.setData({ historyAdLoadFailed: true });
  },
  openEnterpriseWechat() {
    this.setData({
      serviceQrVisible: true,
      serviceQrTitle: '咨询人工',
      serviceQrDescription: '长按或扫码添加企业微信，进行售前咨询及售后服务',
      serviceQrImage: '/images/enterprise-wechat.jpg',
    });
  },
  openWechatPayment() {
    this.setData({
      serviceQrVisible: true,
      serviceQrTitle: '老客扫码复购',
      serviceQrDescription: '长按保存或使用微信扫描二维码',
      serviceQrImage: '/images/wechat-payment.jpg',
    });
  },
  closeServiceQr() {
    this.setData({ serviceQrVisible: false });
  },
  previewServiceQr() {
    const image = this.data.serviceQrImage;
    if (image) wx.previewImage({ current: image, urls: [image] });
  },
  noop() {},
  errorText(error) {
    return (error && (error.errMsg || (error.data && error.data.error) || error.message)) || '请稍后重试';
  },
});
