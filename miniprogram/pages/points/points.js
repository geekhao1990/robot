const api = require('../../utils/api');
const config = require('../../utils/config');
const store = require('../../utils/store');

Page({
  data: {
    loading: true,
    watching: false,
    adEnabled: false,
    balance: 0,
    cashValue: '0.00',
    todayViews: 0,
    todayEarned: 0,
    remaining: 40,
    progress: 0,
    dailyLimit: 40,
    perAd: 5,
    completionBonus: 200,
    pointsPerYuan: 200,
    transactions: [],
  },

  onLoad() {
    if (!store.isLogin()) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    this.loadSettings();
    this.loadPoints();
  },

  onShow() {
    if (store.isLogin() && !this.data.loading) this.loadPoints();
  },

  onUnload() {
    this.destroyAd();
  },

  loadSettings() {
    api.getAppSettings().then((settings) => {
      this.setData({ adEnabled: settings.rewardedAdEnabled === true });
    });
  },

  loadPoints() {
    this.setData({ loading: true });
    api.getPoints()
      .then((summary) => {
        this.applySummary(summary);
        this.setData({ loading: false });
      })
      .catch(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '积分加载失败', icon: 'none' });
      });
  },

  applySummary(summary) {
    const rules = summary.rules || {};
    const dailyLimit = Number(rules.dailyLimit) || 40;
    const todayViews = Number(summary.todayViews) || 0;
    const transactions = (summary.transactions || []).map((item) => ({
      ...item,
      timeText: this.formatTime(item.time),
      deltaText: `${Number(item.delta) >= 0 ? '+' : ''}${item.delta}`,
    }));
    this.setData({
      balance: Number(summary.balance) || 0,
      cashValue: Number(summary.cashValue || 0).toFixed(2),
      todayViews,
      todayEarned: Number(summary.todayEarned) || 0,
      remaining: Number(summary.remaining) || 0,
      progress: Math.min(100, Math.round((todayViews / dailyLimit) * 100)),
      dailyLimit,
      perAd: Number(rules.perAd) || 5,
      completionBonus: Number(rules.completionBonus) || 200,
      pointsPerYuan: Number(rules.pointsPerYuan) || 200,
      transactions,
    });
  },

  formatTime(timestamp) {
    const date = new Date(timestamp);
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },

  watchAd() {
    if (this.data.watching || this.data.remaining <= 0) return;
    const adUnitId = String(config.rewardedVideoAdUnitId || '');
    if (!this.data.adEnabled || !adUnitId || /x{4,}/i.test(adUnitId)) {
      wx.showModal({
        title: '激励广告尚未开启',
        content: '管理员配置广告位并在后台开启后，即可看广告赚积分。',
        showCancel: false,
      });
      return;
    }
    if (typeof wx.createRewardedVideoAd !== 'function') {
      wx.showToast({ title: '当前微信版本不支持激励广告', icon: 'none' });
      return;
    }

    this.setData({ watching: true });
    api.createAdRewardTicket()
      .then(({ ticket }) => {
        this._rewardTicket = ticket;
        this.ensureAd(adUnitId);
        return this._rewardedAd.show().catch(() => this._rewardedAd.load().then(() => this._rewardedAd.show()));
      })
      .catch((error) => {
        this.setData({ watching: false });
        wx.showToast({ title: this.errorMessage(error, '广告加载失败'), icon: 'none' });
      });
  },

  ensureAd(adUnitId) {
    if (this._rewardedAd) return;
    const ad = wx.createRewardedVideoAd({ adUnitId });
    this._rewardedAd = ad;
    this._onAdClose = (result) => {
      if (result && result.isEnded) this.claimReward();
      else {
        this._rewardTicket = '';
        this.setData({ watching: false });
        wx.showToast({ title: '完整看完才能获得积分', icon: 'none' });
      }
    };
    this._onAdError = () => {
      this._rewardTicket = '';
      this.setData({ watching: false });
      wx.showToast({ title: '广告暂时不可用', icon: 'none' });
    };
    ad.onClose(this._onAdClose);
    ad.onError(this._onAdError);
  },

  claimReward() {
    const ticket = this._rewardTicket;
    this._rewardTicket = '';
    if (!ticket) {
      this.setData({ watching: false });
      return;
    }
    api.claimAdReward(ticket)
      .then((result) => {
        this.applySummary(result.summary || {});
        this.setData({ watching: false });
        wx.showToast({ title: `+${result.awarded}积分`, icon: 'success' });
      })
      .catch((error) => {
        this.setData({ watching: false });
        wx.showToast({ title: this.errorMessage(error, '积分领取失败'), icon: 'none' });
      });
  },

  errorMessage(error, fallback) {
    const data = error && error.data;
    return (data && (data.message || data.error)) || fallback;
  },

  comingSoon() {
    wx.showToast({ title: '功能即将开放', icon: 'none' });
  },

  destroyAd() {
    if (!this._rewardedAd) return;
    if (this._onAdClose && this._rewardedAd.offClose) this._rewardedAd.offClose(this._onAdClose);
    if (this._onAdError && this._rewardedAd.offError) this._rewardedAd.offError(this._onAdError);
    this._rewardedAd = null;
  },
});
