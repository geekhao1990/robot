const api = require('../../utils/api');
const store = require('../../utils/store');
const { confirmPurchase } = require('../../utils/payment-ui');
const config = require('../../utils/config');

function formatQueryTime(timestamp) {
  const date = new Date(Number(timestamp) || 0);
  if (!Number.isFinite(date.getTime()) || !Number(timestamp)) return '—';
  const pad = (value) => String(value).padStart(2, '0');
  return `${String(date.getFullYear()).slice(-2)}${pad(date.getMonth() + 1)}${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatOrderDateLabel(timestamp) {
  const date = new Date(Number(timestamp) || 0);
  if (!Number.isFinite(date.getTime()) || !Number(timestamp)) return '日期未知';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
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

function rankingAmountUnit(values) {
  const max = Math.max(0, ...(Array.isArray(values) ? values : [values])
    .map((value) => Math.abs(Number(value) || 0)));
  return max >= 100000000
    ? { divisor: 100000000, suffix: '亿', digits: 2 }
    : { divisor: 10000, suffix: '万', digits: 1 };
}

function formatRankingAmount(value, sharedUnit) {
  const number = Number(value) || 0;
  const unit = sharedUnit || rankingAmountUnit(number);
  const amount = number / unit.divisor;
  return `${amount > 0 ? '+' : ''}${amount.toFixed(unit.digits)}${unit.suffix}`;
}

function darkFundFailure(error, mode = 'close') {
  const raw = (error && (error.errMsg || (error.data && error.data.error) || error.message)) || '';
  const message = /require\s*:?\s*ok/i.test(String(raw)) ? '' : String(raw).trim();
  const statusCode = Number(error && error.statusCode) || 0;
  if (/次数|额度|用完|余额不足/.test(message)) {
    return { title: '额度不足', content: '暗盘查询次数不足，请先充值暗盘次数', short: '额度不足' };
  }
  if (mode === 'intraday' && (statusCode >= 500 || !message || /采集|Windows|collector|ECONN|dispatch|连接|超时/i.test(message))) {
    return { title: '采集器异常', content: '采集器异常，请稍后再试', short: '采集器异常' };
  }
  if (mode === 'close' && (statusCode >= 500 || !message || /接口|盘后|数据源|task|登录|请求|HTTP|连接|超时/i.test(message))) {
    return { title: '接口异常', content: '盘后数据接口异常，请稍后再试', short: '接口异常' };
  }
  return { title: '查询失败', content: message || '接口异常，请稍后再试', short: '查询失败' };
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
    intradayQueueAhead: 0,
    intradayWaitText: '0秒',
    closeQueueAhead: 0,
    closeWaitText: '0秒',
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
    orderGroups: [],
    historyPage: 1,
    historyTotalPages: 1,
    historyTotal: 0,
    historyBadge: 0,
    historyAdLoadFailed: false,
    rankingLoading: false,
    rankingEmpty: true,
    ranking: { inflow: [], outflow: [] },
    rankingDirectionTab: 'inflow',
    rankingItems: [],
    expandedRankingKey: '',
    isOfficial: false,
    querying: false,
    serviceQrVisible: false,
    serviceQrTitle: '',
    serviceQrDescription: '',
    serviceQrImage: '',
    topupVisible: false,
    selectedTopupSku: 'dark_fund_10',
    topupSkus: [
      { sku: 'dark_fund_10', times: 10, price: '6元', unitPrice: '0.60元/次' },
      { sku: 'dark_fund_100', times: 100, price: '50元', unitPrice: '0.50元/次' },
      { sku: 'dark_fund_500', times: 500, price: '200元', unitPrice: '0.40元/次' },
      { sku: 'dark_fund_1000', times: 1000, price: '300元', unitPrice: '0.30元/次' },
    ],
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
    return api.getDarkFundRanking()
      .then((result) => {
        const displayed = result;
        if (!displayed || displayed.empty) return this.setData({ rankingEmpty: true, ranking: { inflow: [], outflow: [] } });
        const decorate = (item, side) => this.decorateRankingItem(item, side);
        const ranking = {
          ...displayed,
          inflow: (displayed.inflow || []).map((item) => decorate(item, 'inflow')),
          outflow: (displayed.outflow || []).map((item) => decorate(item, 'outflow')),
        };
        this.setData({
          rankingEmpty: false,
          ranking,
          rankingItems: ranking[this.data.rankingDirectionTab] || [],
        });
      })
      .catch(() => {
        this.setData({ rankingEmpty: true, ranking: { inflow: [], outflow: [] } });
      })
      .finally(() => {
        this._rankingRequesting = false;
        this.setData({ rankingLoading: false });
      });
  },
  decorateRankingItem(item, side) {
    const grey = Number(item.grey);
    const listed = Number(item.listed);
    const main = Number.isFinite(Number(item.main)) ? Number(item.main) : grey + listed;
    const retail = Number.isFinite(Number(item.retail)) ? Number(item.retail) : -main;
    const values = [listed, grey, retail].map((value) => (Number.isFinite(value) ? value : 0));
    // 同一只股票的列表、汇总与柱状图必须共用单位，避免临界值附近同时出现“万”和“亿”。
    const displayUnit = rankingAmountUnit([grey, listed, main, retail]);
    const max = Math.max(1, ...values.map((value) => Math.abs(value)));
    const labels = ['主力明盘', '主力暗盘', '散户流入'];
    return {
      ...item,
      expandKey: `${side}:${item.stockCode}`,
      marketStockCode: marketStockCode(item.stockCode),
      changeText: Number.isFinite(Number(item.changePercent)) ? `${Number(item.changePercent) > 0 ? '+' : ''}${Number(item.changePercent).toFixed(2)}%` : '—',
      greyText: Number.isFinite(grey) ? formatRankingAmount(grey, displayUnit) : '—',
      listedText: Number.isFinite(listed) ? formatRankingAmount(listed, displayUnit) : '—',
      mainText: Number.isFinite(main) ? formatRankingAmount(main, displayUnit) : '—',
      retailText: Number.isFinite(retail) ? formatRankingAmount(retail, displayUnit) : '—',
      snapshotBars: values.map((value, index) => ({
        label: labels[index],
        text: formatRankingAmount(value, displayUnit),
        positive: value >= 0,
        height: Math.max(18, Math.round(Math.abs(value) / max * 100)),
      })),
    };
  },
  toggleRankingSnapshot(e) {
    const key = String(e.currentTarget.dataset.key || '');
    this.setData({ expandedRankingKey: this.data.expandedRankingKey === key ? '' : key });
  },
  switchRankingDirection(e) {
    const tab = String(e.currentTarget.dataset.tab || '');
    if (!['inflow', 'outflow'].includes(tab) || tab === this.data.rankingDirectionTab) return;
    this.setData({
      rankingDirectionTab: tab,
      rankingItems: this.data.ranking[tab] || [],
      expandedRankingKey: '',
    });
  },
  openRankingResult(e) {
    const stockCode = String(e.currentTarget.dataset.code || '');
    if (!/^\d{6}$/.test(stockCode)) return;
    wx.navigateTo({ url: `/pages/dark-funds-result/dark-funds-result?ranking=${stockCode}` });
  },
  shareRankingResult(e) {
    const stockCode = String(e.currentTarget.dataset.code || '');
    if (!/^\d{6}$/.test(stockCode)) return;
    wx.navigateTo({ url: `/pages/dark-funds-result/dark-funds-result?ranking=${stockCode}&poster=qr` });
  },
  loadTradeDate() {
    this.setData({ dateLoading: true });
    return api.getDarkFundTradeDate()
      .then((result) => {
        const queue = result.queue || {};
        const intraday = queue.intraday || {};
        const close = queue.close || {};
        const waitText = (seconds) => `${Number(seconds) || 0}秒`;
        this.setData({
          tradeDate: result.tradeDate,
          compactTradeDate: result.compactTradeDate,
          intradayQueueAhead: Math.max(0, Number(intraday.ahead) || 0),
          intradayWaitText: waitText(intraday.estimatedWaitSeconds),
          closeQueueAhead: Math.max(0, Number(close.ahead) || 0),
          closeWaitText: waitText(close.estimatedWaitSeconds),
          ...this.quotaData(result),
        });
      })
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
    if (!this.data.compactTradeDate) return wx.showToast({ title: '交易日期接口异常', icon: 'none' });
    if (!hasQueryEntitlement) return this.openSinglePurchase();
    const stockName = this.data.stockSuggestion.stockDisplayName
      || displayStockName(this.data.stockSuggestion.stockName, this.data.stockSuggestion.stockInitials);
    const content = queryMode === 'intraday'
      ? `是否使用决策拼单查询：${stockCode}${stockName ? ` ${stockName}` : ''}，查询日期${this.data.compactTradeDate}`
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
        const failure = darkFundFailure(error, queryMode);
        wx.showModal({ title: failure.title, content: failure.content, showCancel: false });
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
            queryTypeText: item.queryMode === 'close' ? '盘后查询' : '决策拼单',
            queryTimeText: formatQueryTime(item.createdAt),
            statusText: ready ? '点击查看' : (failed ? darkFundFailure({ message: item.error }, item.queryMode).short : '处理中'),
          };
        });
        const unread = Array.isArray(result)
          ? normalized.filter((item) => item.ready && item.unread).length
          : Number(result && result.unread) || 0;
        const orderGroups = [];
        normalized.forEach((order) => {
          const label = formatOrderDateLabel(order.createdAt);
          let group = orderGroups[orderGroups.length - 1];
          if (!group || group.label !== label) {
            group = { label, orders: [] };
            orderGroups.push(group);
          }
          group.orders.push(order);
        });
        this.setData({
          orders: normalized,
          orderGroups,
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
    if (!order || !order.ready) {
      if (order && order.failed) {
        const failure = darkFundFailure({ message: order.error }, order.queryMode);
        return wx.showModal({ title: failure.title, content: failure.content, showCancel: false });
      }
      return wx.showToast({ title: '处理中，请稍后刷新', icon: 'none' });
    }
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
    let orderId = '';
    confirmPurchase('暗盘单次查询', '¥0.99')
      .then((confirmed) => {
        if (!confirmed) return null;
        wx.showLoading({ title: '创建订单', mask: true });
        return api.createDarkFundPurchaseOrder();
      })
      .then((order) => {
        if (!order) return null;
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
        if (!orderId) return null;
        wx.showLoading({ title: '确认到账', mask: true });
        return api.getDarkFundPurchaseOrder(orderId);
      })
      .then((result) => {
        if (!orderId) return;
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
  openTopupModal() {
    if (!store.isLogin()) return wx.navigateTo({ url: '/pages/login/login' });
    this.setData({ topupVisible: true });
  },
  closeTopupModal() {
    if (!this.data.purchasing) this.setData({ topupVisible: false });
  },
  selectTopupSku(e) {
    if (this.data.purchasing) return;
    const sku = String(e.currentTarget.dataset.sku || '');
    if (this.data.topupSkus.some((item) => item.sku === sku)) this.setData({ selectedTopupSku: sku });
  },
  purchaseTopup() {
    if (this.data.purchasing) return;
    const product = this.data.topupSkus.find((item) => item.sku === this.data.selectedTopupSku);
    if (!product) return wx.showToast({ title: '请选择加油包', icon: 'none' });
    this.setData({ purchasing: true });
    let orderId = '';
    wx.showLoading({ title: '创建订单', mask: true });
    api.createDarkFundTopupOrder(product.sku)
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
        return api.getDarkFundTopupOrder(orderId);
      })
      .then((result) => {
        wx.hideLoading();
        if (!result || result.status !== 'SUCCESS') {
          return wx.showModal({ title: '支付处理中', content: '支付结果正在确认，请稍后重新进入页面查看次数。', showCancel: false });
        }
        if (result.user) store.setUser(result.user);
        this.setData({ topupVisible: false, ...this.quotaData(result) });
        return this.loadTradeDate().then(() => wx.showToast({ title: `已到账${result.creditedQuota || product.times}次`, icon: 'success' }));
      })
      .catch((error) => {
        wx.hideLoading();
        const message = this.errorText(error);
        if (/cancel/i.test(message) || /取消/.test(message)) return;
        wx.showModal({ title: '支付失败', content: message || '请稍后再试', showCancel: false });
      })
      .finally(() => this.setData({ purchasing: false }));
  },
  openTopupEnterpriseWechat() {
    if (this.data.purchasing) return;
    this.setData({ topupVisible: false });
    this.openEnterpriseWechat();
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
