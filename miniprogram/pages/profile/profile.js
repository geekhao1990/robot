const api = require('../../utils/api');
const store = require('../../utils/store');
const config = require('../../utils/config');
const { refreshTabBar } = require('../../utils/util');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    user: null,
    loggedIn: false,
    tabs: ['收藏', '赞过'],
    tabIndex: 0,
    currentNotes: [], left: [], right: [],
    emptyText: '还没有收藏的笔记',
    editingProfile: false,
    savingProfile: false,
    draftName: '',
    draftAvatar: '',
    draftPassword: '',
    draftPasswordConfirm: '',
    giftCode: '',
    redeemingGift: false,
    giftModalVisible: false,
    entitlements: [],
    refreshing: false,
    refreshReady: false,
    profileScrollTop: 0,
    messageUnread: 0,
  },
  onLoad() {
    const app = getApp();
    this.setData({ statusBarHeight: app.globalData.statusBarHeight, navBarHeight: app.globalData.navBarHeight });
    api.getAppSettings().then((settings) => {
      const id = String((settings && settings.profileAdUnitId) || config.profileAdUnitId || '');
      if (/^adunit-/i.test(id)) this.createProfileInterstitialAd(id);
    });
  },
  onShow() {
    refreshTabBar(this, 2);
    if (this._returningFromDetail) {
      this._returningFromDetail = false;
      return;
    }
    this.refreshProfile();
    this.showProfileInterstitialAd();
  },
  createProfileInterstitialAd(adUnitId) {
    if (this._profileInterstitialAd || !wx.createInterstitialAd) return;
    this._profileInterstitialAd = wx.createInterstitialAd({ adUnitId });
    this._profileInterstitialAd.onError((error) => {
      this._profileInterstitialShowing = false;
      console.error('[ProfileInterstitialAd]', error);
    });
    this._profileInterstitialAd.onClose(() => {
      this._profileInterstitialShowing = false;
      this._profileInterstitialShown = true;
    });
    this.showProfileInterstitialAd();
  },
  showProfileInterstitialAd() {
    if (!store.isLogin() || !this._profileInterstitialAd || this._profileInterstitialShowing || this._profileInterstitialShown) return;
    this._profileInterstitialShowing = true;
    this._profileInterstitialAd.show().catch((error) => {
      this._profileInterstitialShowing = false;
      console.error('[ProfileInterstitialAd:show]', error);
    });
  },
  onUnload() {
    if (this._profileInterstitialAd && this._profileInterstitialAd.destroy) this._profileInterstitialAd.destroy();
    this._profileInterstitialAd = null;
  },
  refreshProfile() {
    const proceed = () => {
      const user = store.getUser();
      this.setData({
        user,
        entitlements: this.entitlementRows(user),
        loggedIn: !!user,
      });
      if (user) {
        return Promise.all([
          this.loadTab(this.data.tabIndex),
          api.getSystemNotificationSummary()
            .then((result) => this.setData({ messageUnread: Math.min(99, Number(result && result.unread) || 0) }))
            .catch(() => this.setData({ messageUnread: 0 })),
        ]);
      } else {
        this._loadRequestId = (this._loadRequestId || 0) + 1;
        this.setData({ currentNotes: [], left: [], right: [], emptyText: '登录后查看', messageUnread: 0 });
        return Promise.resolve();
      }
    };
    const request = store.isLogin() && (config.useRemote || config.previewAuthRemote || config.wechatAuthRemote)
      ? store.syncMe().then(proceed)
      : proceed();
    return Promise.resolve(request).finally(() => this.finishRefresh());
  },
  onTab(e) {
    const index = Number(e.currentTarget.dataset.index);
    this._currentScrollTop = 0;
    this.setData({ tabIndex: index, profileScrollTop: 0 });
    this.loadTab(index);
  },
  entitlementRows(user) {
    if (!user) return [];
    const now = Date.now();
    const serviceActive = user.serviceActive || Number(user.serviceExpire) > now;
    if (serviceActive) return [{ type: 'service', name: user.servicePlan === 'service_year' ? '服务包年卡' : '服务包' }];
    return Number(user.goldExpire) > now ? [{ type: 'gold', name: '金手指' }] : [];
  },
  openGiftModal() { this.setData({ giftModalVisible: true }); },
  closeGiftModal() {
    if (!this.data.redeemingGift) this.setData({ giftModalVisible: false });
  },
  noop() {},
  onGiftCodeInput(e) { this.setData({ giftCode: e.detail.value }); },
  redeemGift() {
    if (this.data.redeemingGift) return;
    if (!store.isLogin()) return this.goLogin();
    const code = this.data.giftCode.trim();
    if (!code) return wx.showToast({ title: '请输入礼品卡卡密', icon: 'none' });
    this.setData({ redeemingGift: true });
    api.redeemGiftCard(code).then((result) => {
      store.setUser(result.user);
      this.setData({ user: result.user, giftCode: '', giftModalVisible: false, entitlements: this.entitlementRows(result.user) });
      const detail = result.days ? `${result.days}天` : `${result.quota || 0}次`;
      wx.showModal({ title: result.alreadyRedeemed ? '该卡已兑换' : '兑换成功', content: result.alreadyRedeemed ? '权益已在当前账号生效。' : `${result.label || '礼品卡'}已生效（${detail}）。`, showCancel: false });
    }).catch((error) => wx.showModal({ title: '兑换失败', content: this.errorText(error), showCancel: false }))
      .finally(() => this.setData({ redeemingGift: false }));
  },
  loadTab(index) {
    const user = store.getUser();
    const requestId = (this._loadRequestId || 0) + 1;
    this._loadRequestId = requestId;
    const promise = !user ? Promise.resolve([]) : (index === 0 ? api.getMyCollects() : api.getMyLikes());
    const emptyText = !user ? '登录后查看' : (index === 0 ? '还没有收藏的笔记' : '还没有赞过的笔记');
    return promise.then((notes) => {
      if (requestId !== this._loadRequestId || !store.isLogin()) return;
      const left = [], right = []; let lh = 0, rh = 0;
      notes.forEach((n) => { const h = n.coverRatio || 1.3; if (lh <= rh) { left.push(n); lh += h; } else { right.push(n); rh += h; } });
      this.setData({ currentNotes: notes, left, right, emptyText });
    }).catch(() => {
      if (requestId === this._loadRequestId) {
        this.setData({ currentNotes: [], left: [], right: [], emptyText: '暂无权限查看' });
      }
    });
  },
  finishRefresh() {
    if (this.data.refreshing || this.data.refreshReady) this.setData({ refreshing: false, refreshReady: false });
  },
  onRefresherPulling(e) {
    if (this.data.refreshing) return;
    const refreshReady = Number(e.detail && e.detail.dy) >= 64;
    if (refreshReady !== this.data.refreshReady) this.setData({ refreshReady });
  },
  onRefresherRefresh() {
    if (this.data.refreshing) return;
    this.setData({ refreshing: true, refreshReady: false });
    this.refreshProfile();
  },
  onRefresherRestore() {
    if (this.data.refreshReady) this.setData({ refreshReady: false });
  },
  onRefresherAbort() {
    if (this.data.refreshReady) this.setData({ refreshReady: false });
  },
  openProfileEditor() {
    const user = store.getUser();
    if (!user) return this.goLogin();
    this.setData({
      editingProfile: true,
      draftName: user.name || '',
      draftAvatar: user.avatar || '',
      draftPassword: '',
      draftPasswordConfirm: '',
    });
  },
  closeProfileEditor() {
    if (!this.data.savingProfile) this.setData({ editingProfile: false });
  },
  onNameInput(e) {
    this.setData({ draftName: e.detail.value });
  },
  onPasswordInput(e) {
    this.setData({ draftPassword: e.detail.value });
  },
  onPasswordConfirmInput(e) {
    this.setData({ draftPasswordConfirm: e.detail.value });
  },
  copyUserId() {
    const user = this.data.user;
    if (!user || !user.id) return;
    wx.setClipboardData({
      data: String(user.id),
      success: () => wx.showToast({ title: 'ID已复制', icon: 'success' }),
    });
  },
  onChooseAvatar(e) {
    const avatarUrl = e.detail && e.detail.avatarUrl;
    if (avatarUrl) this.setData({ draftAvatar: avatarUrl });
  },
  saveProfile() {
    if (this.data.savingProfile) return;
    const name = String(this.data.draftName || '').trim();
    const avatar = String(this.data.draftAvatar || '').trim();
    const password = String(this.data.draftPassword || '');
    const confirmPassword = String(this.data.draftPasswordConfirm || '');
    if (!avatar) return wx.showToast({ title: '请先选择头像', icon: 'none' });
    if (!name) return wx.showToast({ title: '请输入昵称', icon: 'none' });
    if (password || confirmPassword) {
      if (password.length < 6) return wx.showToast({ title: '密码至少6位', icon: 'none' });
      if (password.length > 64) return wx.showToast({ title: '密码最多64位', icon: 'none' });
      if (password !== confirmPassword) return wx.showToast({ title: '两次密码不一致', icon: 'none' });
    }
    this.setData({ savingProfile: true });
    wx.showLoading({ title: '保存中' });
    const upload = /^https?:\/\//i.test(avatar) ? Promise.resolve(avatar) : api.uploadImage(avatar);
    upload
      .then((avatarUrl) => store.updateProfile({ name, avatar: avatarUrl, password, confirmPassword }))
      .then((user) => {
        this.setData({ user, editingProfile: false });
        wx.hideLoading();
        wx.showToast({ title: '资料已更新', icon: 'success' });
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showModal({ title: '保存失败', content: this.errorText(err), showCancel: false });
      })
      .finally(() => {
        this.setData({ savingProfile: false });
      });
  },
  errorText(err) {
    return (err && (err.errMsg || (err.data && err.data.error) || err.message)) || '请稍后重试';
  },
  goLogin() { wx.navigateTo({ url: '/pages/login/login' }); },
  goDarkFunds() {
    if (!store.isLogin()) return this.goLogin();
    const user = store.getUser();
    if (!user || user.darkFundEnabled !== true) return wx.showToast({ title: '功能尚未开通', icon: 'none' });
    wx.navigateTo({ url: '/pages/dark-funds/dark-funds' });
  },
  goGoldNote() {
    if (!store.isLogin()) return this.goLogin();
    const user = store.getUser();
    if (!user || user.goldAccess !== true) return wx.showToast({ title: '金手指权益尚未开通', icon: 'none' });
    api.getAppSettings().then((settings) => {
      const noteId = String(settings && settings.featuredNoteId || '').trim();
      if (!noteId) throw new Error('金手指笔记暂未配置');
      wx.navigateTo({
        url: `/pages/detail/detail?id=${encodeURIComponent(noteId)}&from=goldTab`,
        fail: () => {
          wx.showToast({ title: '页面打开失败，请重试', icon: 'none' });
        },
      });
    }).catch((error) => {
      wx.showToast({ title: error.message || '金手指笔记暂未配置', icon: 'none' });
    });
  },
  goMessageCenter() {
    if (!store.isLogin()) return this.goLogin();
    wx.navigateTo({ url: '/pages/message-center/message-center' });
  },
  onLogout() {
    wx.showModal({ title: '提示', content: '确定要退出登录吗？', success: (res) => { if (res.confirm) { store.logout(); this.onShow(); } } });
  },
  onProfileScroll(e) {
    this._currentScrollTop = Number(e.detail && e.detail.scrollTop) || 0;
  },
  goDetail(e) {
    const id = e.detail && e.detail.id;
    if (!id) return;
    this._returningFromDetail = true;
    const profileScrollTop = Number(this._currentScrollTop) || 0;
    this.setData({ profileScrollTop }, () => {
      wx.navigateTo({
        url: `/pages/detail/detail?id=${encodeURIComponent(id)}`,
        fail: () => { this._returningFromDetail = false; },
      });
    });
  },
});
