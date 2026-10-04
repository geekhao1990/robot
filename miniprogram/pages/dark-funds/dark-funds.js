const api = require('../../utils/api');
const store = require('../../utils/store');
const config = require('../../utils/config');

function formatQueryTime(timestamp) {
  const date = new Date(Number(timestamp) || 0);
  if (!Number.isFinite(date.getTime()) || !Number(timestamp)) return '—';
  const pad = (value) => String(value).padStart(2, '0');
  return `${String(date.getFullYear()).slice(-2)}${pad(date.getMonth() + 1)}${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatExpiryDate(timestamp) {
  const date = new Date(Number(timestamp) || 0);
  if (!Number.isFinite(date.getTime()) || !Number(timestamp)) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function displayStockName(name, initials = '') {
  const chars = Array.from(String(name || '').trim());
  const letters = Array.from(String(initials || ''));
  let chineseCount = 0;
  return chars.map((char, index) => {
    if (!/[\u3400-\u9fff]/u.test(char)) return char;
    chineseCount += 1;
    if (chineseCount <= 2) return char;
    return /^[a-z]$/i.test(letters[index] || '') ? letters[index].toUpperCase() : char;
  }).join('');
}

function marketStockCode(code) {
  const value = String(code || '').replace(/^(sh|sz)/i, '');
  return `${/^[569]/.test(value) ? 'sh' : 'sz'}${value}`;
}

function formatRankingAmount(value) {
  const number = Number(value) || 0;
  const unit = Math.abs(number) >= 100000000
    ? { divisor: 100000000, suffix: '亿', digits: 2 }
    : { divisor: 10000, suffix: '万', digits: 1 };
  const amount = number / unit.divisor;
  return `${amount > 0 ? '+' : ''}${amount.toFixed(unit.digits)}${unit.suffix}`;
}

function rankingPreviewEnabled() {
  // 当前阶段统一启用：真实榜单为空或接口不可用时，用 Mock 调试完整交互。
  // 正式上线真实榜单前应删除该兜底和 mockUpdatedRanking。
  return true;
}

function mockUpdatedRanking() {
  return {
    previewMock: true,
    tradeDate: '2026-09-30',
    title: '9月30日暗盘榜',
    updateHint: '',
    inflow: [
      { stockCode: '600159', stockName: '大龙地产', stockInitials: 'DLDC', stockDisplayName: '大龙DC', grey: 128600000 },
      { stockCode: '002242', stockName: '九阳股份', stockInitials: 'JYGF', stockDisplayName: '九阳GF', grey: 93600000 },
      { stockCode: '000678', stockName: '襄阳轴承', stockInitials: 'XYZC', stockDisplayName: '襄阳ZC', grey: 71800000 },
      { stockCode: '002487', stockName: '大金重工', stockInitials: 'DJZG', stockDisplayName: '大金ZG', grey: 48600000 },
      { stockCode: '601127', stockName: '赛力斯', stockInitials: 'SLS', stockDisplayName: '赛力S', grey: 32900000 },
    ],
    outflow: [
      { stockCode: '600105', stockName: '永鼎股份', stockInitials: 'YDGF', stockDisplayName: '永鼎GF', grey: -70262426.83 },
      { stockCode: '300142', stockName: '沃森生物', stockInitials: 'WSSW', stockDisplayName: '沃森SW', grey: -55600000 },
      { stockCode: '000001', stockName: '平安银行', stockInitials: 'PAYH', stockDisplayName: '平安YH', grey: -43800000 },
      { stockCode: '600519', stockName: '贵州茅台', stockInitials: 'GZMT', stockDisplayName: '贵州MT', grey: -29500000 },
      { stockCode: '000333', stockName: '美的集团', stockInitials: 'MDJT', stockDisplayName: '美的JT', grey: -18100000 },
    ],
  };
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
    darkFundEnabled: false,
    purchasing: false,
    decisionPioneerEnabled: false,
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
    rankingLoading: false,
    rankingEmpty: true,
    ranking: { inflow: [], outflow: [] },
    isOfficial: false,
    querying: false,
    serviceQrVisible: false,
    serviceQrTitle: '',
    serviceQrDescription: '',
    serviceQrImage: '',
  },
  onLoad(options) {
    if (!store.isLogin()) return wx.redirectTo({ url: '/pages/login/login' });
    const user = store.getUser();
    const requestedTab = String(options && options.tab || '');
    const tab = ['ranking', 'history'].includes(requestedTab) ? requestedTab : 'query';
    this.setData({ tab, isOfficial: user && user.official === true, darkFundEnabled: user && user.darkFundEnabled === true });
    api.getAppSettings().then((settings) => {
      const id = String((settings && settings.darkFundsQueryAdUnitId) || config.darkFundsQueryAdUnitId || '');
      const historyId = String((settings && settings.darkFundsHistoryAdUnitId) || config.darkFundsHistoryAdUnitId || '');
      this.setData({
        queryAdUnitId: /^adunit-/i.test(id) ? id : '',
        historyAdUnitId: /^adunit-/i.test(historyId) ? historyId : '',
        queryAdLoadFailed: false,
        historyAdLoadFailed: false,
      });
    });
    if (tab === 'ranking') this.loadRanking();
  },
  onShow() {
    if (!store.isLogin()) return;
    store.syncMe().then((user) => {
      this.setData({
        isOfficial: user && user.official === true,
        darkFundEnabled: user && user.darkFundEnabled === true,
      });
      return Promise.all([this.loadTradeDate(), this.loadOrders(true)]);
    });
  },
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.tab) return;
    this.setData({ tab });
    if (tab === 'history') this.loadOrders(false, 1);
    if (tab === 'ranking') this.loadRanking();
  },
  loadRanking() {
    if (this._rankingRequesting) return Promise.resolve();
    this._rankingRequesting = true;
    this.setData({ rankingLoading: true });
    const showPreview = () => {
      const displayed = mockUpdatedRanking();
      const decorate = (item) => ({
        ...item,
        marketStockCode: marketStockCode(item.stockCode),
        greyText: formatRankingAmount(item.grey),
      });
      this.setData({
        rankingEmpty: false,
        ranking: {
          ...displayed,
          inflow: displayed.inflow.map(decorate),
          outflow: displayed.outflow.map(decorate),
        },
      });
    };
    return api.getDarkFundRanking()
      .then((result) => {
        if ((!result || result.empty) && rankingPreviewEnabled()) return showPreview();
        const displayed = result;
        if (!displayed || displayed.empty) return this.setData({ rankingEmpty: true, ranking: { inflow: [], outflow: [] } });
        const decorate = (item) => ({
          ...item,
          marketStockCode: marketStockCode(item.stockCode),
          greyText: formatRankingAmount(item.grey),
        });
        this.setData({
          rankingEmpty: false,
          ranking: {
            ...displayed,
            inflow: (displayed.inflow || []).map(decorate),
            outflow: (displayed.outflow || []).map(decorate),
          },
        });
      })
      .catch(() => {
        if (rankingPreviewEnabled()) return showPreview();
        this.setData({ rankingEmpty: true, ranking: { inflow: [], outflow: [] } });
      })
      .finally(() => {
        this._rankingRequesting = false;
        this.setData({ rankingLoading: false });
      });
  },
  openRankingResult(e) {
    const stockCode = String(e.currentTarget.dataset.code || '');
    if (!/^\d{6}$/.test(stockCode)) return;
    if (this.data.ranking.previewMock) {
      const stockName = encodeURIComponent(String(e.currentTarget.dataset.name || '永鼎股份'));
      const stockInitials = encodeURIComponent(String(e.currentTarget.dataset.initials || 'YDGF'));
      return wx.navigateTo({ url: `/pages/dark-funds-result/dark-funds-result?mock=1&stockCode=${stockCode}&stockName=${stockName}&stockInitials=${stockInitials}` });
    }
    wx.navigateTo({ url: `/pages/dark-funds-result/dark-funds-result?ranking=${stockCode}` });
  },
  shareRankingResult(e) {
    const stockCode = String(e.currentTarget.dataset.code || '');
    if (!/^\d{6}$/.test(stockCode)) return;
    if (this.data.ranking.previewMock) {
      const stockName = encodeURIComponent(String(e.currentTarget.dataset.name || '永鼎股份'));
      const stockInitials = encodeURIComponent(String(e.currentTarget.dataset.initials || 'YDGF'));
      return wx.navigateTo({ url: `/pages/dark-funds-result/dark-funds-result?mock=1&poster=qr&stockCode=${stockCode}&stockName=${stockName}&stockInitials=${stockInitials}` });
    }
    wx.navigateTo({ url: `/pages/dark-funds-result/dark-funds-result?ranking=${stockCode}&poster=qr` });
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
            stockInitials: String(result.stockInitials || ''),
            stockDisplayName: String(result.stockDisplayName || '') || displayStockName(result.stockName || '', result.stockInitials),
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
  prepareIntradayQuery() {
    return this.prepareQuery('intraday');
  },
  prepareCloseQuery() {
    return this.prepareQuery('close');
  },
  prepareQuery(mode) {
    const stockCode = String(this.data.stockCode || '').trim();
    const queryMode = mode === 'intraday' ? 'intraday' : 'close';
    const source = queryMode === 'intraday' ? 'collector' : 'web';
    const hasQueryEntitlement = Number(this.data.remaining) > 0
      || (queryMode === 'close' && this.data.closeMonthlyActive);
    if (!/^\d{6}$/.test(stockCode)) return wx.showModal({ title: '无法查询', content: '请输入6位代码', showCancel: false });
    if (/^(4|8|92)/.test(stockCode)) return wx.showToast({ title: '系统繁忙', icon: 'none' });
    if (this.data.stockLookupLoading) return wx.showToast({ title: '正在确认股票信息', icon: 'none' });
    if (!this.data.stockSuggestion || this.data.stockSuggestion.stockCode !== stockCode) {
      return wx.showToast({ title: this.data.stockLookupError || '请先确认股票代码', icon: 'none' });
    }
    if (!this.data.compactTradeDate) return wx.showToast({ title: '请稍后重试', icon: 'none' });
    if (!hasQueryEntitlement) return this.openSinglePurchase();
    const stockName = this.data.stockSuggestion.stockDisplayName
      || displayStockName(this.data.stockSuggestion.stockName, this.data.stockSuggestion.stockInitials);
    const content = queryMode === 'intraday'
      ? `是否使用决策先锋查询：${stockCode}${stockName ? ` ${stockName}` : ''}，查询日期${this.data.compactTradeDate}`
      : `是否查询盘后数据：${stockCode}${stockName ? ` ${stockName}` : ''}，查询近7日暗盘数据`;
    wx.showModal({
      title: '确认查询',
      content,
      confirmText: '确定',
      success: (result) => {
        if (!result.confirm) return;
        return this.query(stockCode, queryMode, source);
      },
    });
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
        this.setData({ ...this.quotaData(order) });
        this.clearQueryRequestId(requestId);
        this.loadOrders(true, 1);
        if (order.ready && order.resultType === 'close_snapshot') {
          return wx.navigateTo({ url: `/pages/dark-funds-result/dark-funds-result?id=${encodeURIComponent(order.orderId)}` });
        }
        wx.showModal({ title: order.ready ? '查询完成' : '已提交', content: order.ready ? '盘后数据已生成，请在订单列表查看' : '工单处理中，请到订单列表手动刷新状态', showCancel: false });
      })
      .catch((error) => {
        wx.hideLoading();
        if (error && Number(error.statusCode) >= 400 && Number(error.statusCode) < 500) this.clearQueryRequestId(requestId);
        wx.showModal({ title: '查询失败', content: '请稍后再试', showCancel: false });
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
            stockDisplayName: item.stockDisplayName || displayStockName(item.stockName, item.stockInitials),
            marketStockCode: marketStockCode(item.stockCode),
            queryTypeText: item.queryMode === 'close' ? '盘后查询' : '决策先锋',
            queryTimeText: formatQueryTime(item.createdAt),
            statusText: ready ? '点击查看' : (failed ? '查询失败' : '处理中'),
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
    const now = Date.now();
    const key = 'dark_fund_history_refresh_times';
    let refreshTimes = [];
    try {
      const saved = wx.getStorageSync(key);
      refreshTimes = (Array.isArray(saved) ? saved : []).filter((time) => now - Number(time) < 60 * 1000);
    } catch (error) {}
    if (refreshTimes.length >= 2) {
      return wx.showToast({ title: '请稍后再试', icon: 'none' });
    }
    refreshTimes.push(now);
    try { wx.setStorageSync(key, refreshTimes); } catch (error) {}
    this.loadOrders(false, 1)
      .then(() => wx.showToast({ title: '订单已刷新', icon: 'success', duration: 1000 }));
  },
  onPullDownRefresh() {
    Promise.all([
      this.loadTradeDate(),
      this.loadOrders(true, this.data.tab === 'history' ? this.data.historyPage : 1),
      this.data.tab === 'ranking' ? this.loadRanking() : Promise.resolve(),
    ])
      .finally(() => wx.stopPullDownRefresh());
  },
  openOrder(e) {
    const order = this.data.orders.find((item) => item.id === e.currentTarget.dataset.id);
    if (!order || !order.ready) return wx.showToast({ title: order && order.failed ? '请稍后再试' : '处理中，请稍后刷新', icon: 'none' });
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
      decisionPioneerEnabled: result && result.decisionPioneerEnabled === true,
      darkFundEnabled: result && result.darkFundEnabled === true,
    };
  },
  openSinglePurchase() {
    if (this.data.purchasing) return;
    if (!store.isLogin()) return wx.navigateTo({ url: '/pages/login/login' });
    this.setData({ purchasing: true });
    wx.showLoading({ title: '创建订单', mask: true });
    let orderId = '';
    api.createDarkFundPurchaseOrder()
      .then((order) => {
        wx.hideLoading();
        orderId = String(order && order.orderId || '');
        if (!orderId || !order.payment) throw new Error('支付订单创建失败');
        return new Promise((resolve, reject) => wx.requestPayment({
          ...order.payment,
          success: resolve,
          fail: reject,
        }));
      })
      .then(() => {
        wx.showLoading({ title: '确认到账', mask: true });
        return api.getDarkFundPurchaseOrder(orderId);
      })
      .then((result) => {
        wx.hideLoading();
        if (!result || result.status !== 'SUCCESS') {
          return wx.showModal({ title: '支付处理中', content: '支付结果正在确认，请稍后重新进入页面查看次数。', showCancel: false });
        }
        if (result.user) store.setUser(result.user);
        this.setData({ ...this.quotaData(result) });
        wx.showModal({ title: '购买成功', content: '已增加1次长期有效暗盘查询。', showCancel: false });
      })
      .catch((error) => {
        wx.hideLoading();
        const message = this.errorText(error);
        if (/cancel/i.test(message) || /取消/.test(message)) return;
        wx.showModal({ title: '支付失败', content: message || '请稍后再试', showCancel: false });
      })
      .finally(() => this.setData({ purchasing: false }));
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
      serviceQrTitle: '企业微信',
      serviceQrDescription: '长按或扫码添加企业微信，购买更优惠',
      serviceQrImage: '/images/enterprise-wechat.jpg',
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
    const message = (error && (error.errMsg || (error.data && error.data.error) || error.message)) || '';
    return /require\s*:?\s*ok/i.test(String(message)) ? '请稍后再试' : (message || '请稍后再试');
  },
});
