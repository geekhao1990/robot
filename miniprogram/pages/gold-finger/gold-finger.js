const api = require('../../utils/api');
const config = require('../../utils/config');

const GOLD_FINGER_ICON = 'https://app.nankaitechschool.com/uploads/up_1787930384458_5f0008fd90bf8d07.png';
const SILVER_FINGER_ICON = 'https://app.nankaitechschool.com/uploads/up_1787930384616_32050eca372a0969.png';
const TREND_UP_ICON = '/images/trend-up.png';
const TREND_DOWN_ICON = '/images/trend-down.png';
const store = require('../../utils/store');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    headerHeight: 64,
    loading: true,
    record: null,
    records: [],
    banners: [],
    historyExpanded: false,
    historyLoading: false,
    refreshing: false,
    hasMoreHistory: false,
    historyPage: 1,
    historyTotalPages: 1,
    goldFingerAdUnitId: /^adunit-/i.test(String(config.goldFingerAdUnitId || ''))
      ? String(config.goldFingerAdUnitId)
      : '',
    adLoadFailed: false,
  },

  onLoad() {
    const app = getApp();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      headerHeight: app.globalData.statusBarHeight + app.globalData.navBarHeight,
    });
    if (!store.isLogin()) return wx.redirectTo({ url: '/pages/login/login' });
    api.getAppSettings().then((settings) => {
      const id = String((settings && settings.goldFingerAdUnitId) || config.goldFingerAdUnitId || '');
      const interstitialId = String((settings && settings.goldFingerInterstitialAdUnitId) || config.goldFingerInterstitialAdUnitId || '');
      this.setData({ goldFingerAdUnitId: /^adunit-/i.test(id) ? id : '', adLoadFailed: false });
      if (/^adunit-/i.test(interstitialId)) this.createGoldInterstitialAd(interstitialId);
    });
    this.loadData();
  },

  loadData(options = {}) {
    const silent = options.silent === true;
    if (this.data.refreshing) return Promise.resolve();
    this.setData(silent ? { refreshing: true } : { loading: true });
    return api.getGoldFinger().then((result) => {
      const record = result && result.record;
      const records = ((result && result.records) || (record ? [record] : [])).map((item) => this.decorateRecord(item));
      this.setData({
        loading: false,
        refreshing: false,
        record: record || null,
        records,
        banners: (result && result.banners) || [],
        historyExpanded: false,
        hasMoreHistory: result && result.hasMoreHistory === true,
        historyPage: 1,
        historyTotalPages: 1,
      });
    }).catch((error) => {
      this.setData({ loading: false, refreshing: false });
      if (silent) throw error;
      const statusCode = error && error.statusCode;
      wx.showModal({
        title: statusCode === 403 ? '会员专享功能' : '加载失败',
        content: statusCode === 403 ? '请前往「我—礼品卡」兑换金手指卡或服务包后使用。' : '数据暂时无法加载，请稍后重试。',
        showCancel: false,
        success: () => this.goBack(),
      });
    });
  },

  createGoldInterstitialAd(adUnitId) {
    if (this._goldInterstitialAd || !wx.createInterstitialAd) return;
    this._goldInterstitialAd = wx.createInterstitialAd({ adUnitId });
    this._goldInterstitialAd.onClose(() => { this._goldInterstitialShowing = false; });
    this._goldInterstitialAd.onError((error) => {
      this._goldInterstitialShowing = false;
      console.error('[GoldInterstitialAd]', error);
    });
    this.showGoldInterstitialAd();
  },

  showGoldInterstitialAd() {
    if (!this._goldInterstitialAd || this._goldInterstitialShowing) return;
    this._goldInterstitialShowing = true;
    this._goldInterstitialAd.show().catch((error) => {
      this._goldInterstitialShowing = false;
      console.error('[GoldInterstitialAd:show]', error);
    });
  },

  refreshGoldFinger() {
    if (this.data.loading || this.data.refreshing) return;
    wx.showLoading({ title: '加载中', mask: true });
    this.loadData({ silent: true })
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '金手指已更新', icon: 'success', duration: 1200 });
        if (this._refreshAdTimer) clearTimeout(this._refreshAdTimer);
        this._refreshAdTimer = setTimeout(() => {
          this._refreshAdTimer = null;
          this.showGoldInterstitialAd();
        }, 1200);
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '刷新失败，请稍后重试', icon: 'none' });
      });
  },

  decorateRecord(record) {
    const yang = Math.max(0, Math.min(100, Number(record.yang) || 0));
    const yin = 100 - yang;
    return {
      ...record,
      yang,
      yin,
      fingerIcon: record.finger === 'silver' ? SILVER_FINGER_ICON : GOLD_FINGER_ICON,
      trendIcon: record.trend === 'down' ? TREND_DOWN_ICON : TREND_UP_ICON,
      yangClass: yang > 50 ? 'strong' : '',
      yinClass: yin > 50 ? 'strong' : '',
    };
  },

  loadMoreHistory() {
    this.loadHistoryPage(1);
  },

  changeHistoryPage(e) {
    this.loadHistoryPage(Number(e.currentTarget.dataset.page));
  },

  loadHistoryPage(page) {
    if (this.data.historyLoading || !Number.isInteger(page) || page < 1) return;
    if (this.data.historyExpanded && page > this.data.historyTotalPages) return;
    this.setData({ historyExpanded: true, historyLoading: true });
    api.getGoldFingerHistory(page).then((result) => {
      const records = ((result && result.records) || []).map((item) => this.decorateRecord(item));
      this.setData({
        records,
        historyLoading: false,
        historyPage: Number(result && result.page) || 1,
        historyTotalPages: Number(result && result.totalPages) || 1,
      });
    }).catch(() => {
      this.setData({ historyLoading: false });
      wx.showToast({ title: '历史数据加载失败', icon: 'none' });
    });
  },

  goBannerNote(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/detail/detail?id=${encodeURIComponent(id)}` });
  },

  onAdError() {
    this.setData({ adLoadFailed: true });
  },

  onUnload() {
    if (this._refreshAdTimer) clearTimeout(this._refreshAdTimer);
    this._refreshAdTimer = null;
    if (this._goldInterstitialAd && this._goldInterstitialAd.destroy) this._goldInterstitialAd.destroy();
    this._goldInterstitialAd = null;
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },
});
