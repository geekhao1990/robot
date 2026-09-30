const api = require('../../utils/api');
const config = require('../../utils/config');

const GOLD_FINGER_ICON = 'https://app.nankaitechschool.com/uploads/up_1787930384458_5f0008fd90bf8d07.png';
const SILVER_FINGER_ICON = 'https://app.nankaitechschool.com/uploads/up_1787930384616_32050eca372a0969.png';
const TREND_UP_ICON = '/images/trend-up.png';
const TREND_DOWN_ICON = '/images/trend-down.png';
const store = require('../../utils/store');
const REFRESH_WINDOW_MS = 5 * 60 * 1000;
const REFRESH_LIMIT = 2;
const REFRESH_HISTORY_KEY = 'gold_finger_manual_refresh_history';

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
      const rewardedId = String((settings && settings.goldRewardedVideoAdUnitId) || config.goldRewardedVideoAdUnitId || '');
      this.setData({ goldFingerAdUnitId: /^adunit-/i.test(id) ? id : '', adLoadFailed: false });
      if (/^adunit-/i.test(interstitialId)) this.createGoldInterstitialAd(interstitialId);
      if (/^adunit-/i.test(rewardedId)) this.createGoldRewardedAd(rewardedId);
    });
    this.loadData();
  },

  loadData(options = {}) {
    const silent = options.silent === true;
    if (this.data.refreshing && options.force !== true) return Promise.resolve();
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
    if (!this._goldInterstitialAd || this._goldInterstitialShowing) return Promise.resolve(false);
    this._goldInterstitialShowing = true;
    return this._goldInterstitialAd.show().then(() => true).catch((error) => {
      this._goldInterstitialShowing = false;
      console.error('[GoldInterstitialAd:show]', error);
      return false;
    });
  },

  createGoldRewardedAd(adUnitId) {
    if (this._goldRewardedAd || !wx.createRewardedVideoAd) return;
    this._goldRewardedAd = wx.createRewardedVideoAd({ adUnitId });
    this._goldRewardedAd.onClose(() => {
      this.finishGoldRewardedAd();
      if (this._goldRewardedAd) this._goldRewardedAd.load().catch(() => {});
    });
    this._goldRewardedAd.onError((error) => {
      console.error('[GoldRewardedVideoAd]', error);
      this.finishGoldRewardedAd();
    });
    this._goldRewardedAd.load().catch((error) => {
      console.error('[GoldRewardedVideoAd:load]', error);
    });
  },

  finishGoldRewardedAd() {
    if (this._goldRewardedAdTimer) clearTimeout(this._goldRewardedAdTimer);
    this._goldRewardedAdTimer = null;
    const done = this._goldRewardedAdDone;
    this._goldRewardedAdDone = null;
    if (done) done();
  },

  showGoldRewardedAd() {
    if (!this._goldRewardedAd && /^adunit-/i.test(String(config.goldRewardedVideoAdUnitId || ''))) {
      this.createGoldRewardedAd(String(config.goldRewardedVideoAdUnitId));
    }
    if (!this._goldRewardedAd) return Promise.resolve(false);
    return new Promise((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        resolve(true);
      };
      this._goldRewardedAdDone = done;
      // 极少数客户端既不 reject 也不触发 onError；兜底继续刷新，避免广告 SDK 卡死业务。
      this._goldRewardedAdTimer = setTimeout(() => this.finishGoldRewardedAd(), 8000);
      const show = () => this._goldRewardedAd.show().then(() => {
        if (this._goldRewardedAdTimer) clearTimeout(this._goldRewardedAdTimer);
        this._goldRewardedAdTimer = null;
      });
      show().catch((error) => {
        console.error('[GoldRewardedVideoAd:show]', error);
        this.finishGoldRewardedAd();
      });
    });
  },

  reserveRefreshAttempt() {
    const user = store.getUser() || {};
    const now = Date.now();
    const key = `${REFRESH_HISTORY_KEY}_${user.id || 'unknown'}`;
    let history = [];
    try {
      const saved = wx.getStorageSync(key);
      history = Array.isArray(saved) ? saved : [];
    } catch (error) {}
    history = history.filter((time) => Number(time) > now - REFRESH_WINDOW_MS);
    if (history.length >= REFRESH_LIMIT) return false;
    history.push(now);
    try { wx.setStorageSync(key, history); } catch (error) {}
    return true;
  },

  refreshGoldFinger() {
    if (this.data.loading || this.data.refreshing) return;
    if (!this.reserveRefreshAttempt()) {
      wx.showToast({ title: '操作频繁，请稍后再试', icon: 'none' });
      return;
    }
    this.setData({ refreshing: true });
    wx.showLoading({ title: '加载中', mask: true });
    store.syncMe()
      .catch(() => store.getUser())
      .then((user) => {
        if (user && user.serviceActive === true) return this.showGoldInterstitialAd();
        return this.showGoldRewardedAd();
      })
      .then(() => this.loadData({ silent: true, force: true }))
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '金手指已更新', icon: 'success', duration: 1200 });
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
    this.finishGoldRewardedAd();
    if (this._goldRewardedAd && this._goldRewardedAd.destroy) this._goldRewardedAd.destroy();
    this._goldRewardedAd = null;
    if (this._goldInterstitialAd && this._goldInterstitialAd.destroy) this._goldInterstitialAd.destroy();
    this._goldInterstitialAd = null;
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },
});
