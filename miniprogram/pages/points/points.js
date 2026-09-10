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
    dailyDone: false,
    watchButtonText: '看激励广告 +5积分',
    progress: 0,
    dailyLimit: 40,
    perAd: 5,
    completionBonus: 200,
    pointsPerYuan: 200,
    transactions: [],
    transactionModalVisible: false,
    transactionLoading: false,
    transactionPage: 1,
    transactionTotal: 0,
    transactionTotalPages: 1,
    inviteCode: '',
    inviteLink: '',
    invitedCount: 0,
    invitePoints: 0,
    perInvite: 200,
  },

  onLoad(options) {
    store.captureInvite(options);
    if (!store.isLogin()) {
      const invite = store.getPendingInvite();
      wx.redirectTo({ url: `/pages/login/login${invite ? '?invite=' + invite : ''}` });
      return;
    }
    this.loadSettings();
    this.loadPoints();
    this.loadInvites();
  },

  onShow() {
    if (store.isLogin() && !this.data.loading) {
      this.loadPoints();
      this.loadInvites();
    }
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

  loadInvites() {
    api.getInvites()
      .then((result) => {
        this.setData({
          inviteCode: result.inviteCode || '',
          inviteLink: result.inviteLink || `/pages/points/points?invite=${result.inviteCode || ''}`,
          invitedCount: Number(result.invitedCount) || 0,
          invitePoints: Number(result.invitePoints) || 0,
          perInvite: Number(result.perInvite) || 200,
        });
      })
      .catch(() => wx.showToast({ title: '邀请数据加载失败', icon: 'none' }));
  },

  applySummary(summary) {
    const rules = summary.rules || {};
    const dailyLimit = Number(rules.dailyLimit) || 40;
    const todayViews = Number(summary.todayViews) || 0;
    this.setData({
      balance: Number(summary.balance) || 0,
      cashValue: Number(summary.cashValue || 0).toFixed(2),
      todayViews,
      todayEarned: Number(summary.todayEarned) || 0,
      remaining: Number(summary.remaining) || 0,
      dailyDone: Number(summary.remaining) <= 0,
      watchButtonText: Number(summary.remaining) > 0 ? `看激励广告 +${Number(rules.perAd) || 5}积分` : '今日任务已完成',
      progress: Math.min(100, Math.round((todayViews / dailyLimit) * 100)),
      dailyLimit,
      perAd: Number(rules.perAd) || 5,
      completionBonus: Number(rules.completionBonus) || 200,
      pointsPerYuan: Number(rules.pointsPerYuan) || 200,
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

  openWithdraw() {
    wx.navigateTo({ url: '/pages/withdraw/withdraw' });
  },

  openTransactionModal() {
    this.setData({ transactionModalVisible: true });
    this.loadTransactions(1);
  },

  closeTransactionModal() {
    if (!this.data.transactionLoading) this.setData({ transactionModalVisible: false });
  },

  loadTransactions(page) {
    if (this.data.transactionLoading) return;
    this.setData({ transactionLoading: true });
    api.getPointTransactions(page)
      .then((result) => {
        const transactions = (result.list || []).map((item) => ({
          ...item,
          timeText: this.formatTime(item.time),
          deltaText: `${Number(item.delta) >= 0 ? '+' : ''}${item.delta}`,
        }));
        this.setData({
          transactions,
          transactionPage: Number(result.page) || 1,
          transactionTotal: Number(result.total) || 0,
          transactionTotalPages: Number(result.totalPages) || 1,
        });
      })
      .catch(() => wx.showToast({ title: '积分明细加载失败', icon: 'none' }))
      .finally(() => this.setData({ transactionLoading: false }));
  },

  previousTransactionPage() {
    if (this.data.transactionPage > 1) this.loadTransactions(this.data.transactionPage - 1);
  },

  nextTransactionPage() {
    if (this.data.transactionPage < this.data.transactionTotalPages) this.loadTransactions(this.data.transactionPage + 1);
  },

  noop() {},

  onShareAppMessage() {
    return {
      title: `邀请你加入，新用户注册后我可得${this.data.perInvite}积分`,
      path: `/pages/points/points?invite=${this.data.inviteCode}`,
    };
  },

  destroyAd() {
    if (!this._rewardedAd) return;
    if (this._onAdClose && this._rewardedAd.offClose) this._rewardedAd.offClose(this._onAdClose);
    if (this._onAdError && this._rewardedAd.offError) this._rewardedAd.offError(this._onAdError);
    this._rewardedAd = null;
  },
});
