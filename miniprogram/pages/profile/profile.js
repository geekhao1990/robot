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
    phoneText: '未绑定手机号',
    editingProfile: false,
    savingProfile: false,
    bindingPhone: false,
    draftName: '',
    draftAvatar: '',
    giftCode: '',
    redeemingGift: false,
    giftModalVisible: false,
    entitlements: [],
  },
  onLoad() {
    const app = getApp();
    this.setData({ statusBarHeight: app.globalData.statusBarHeight, navBarHeight: app.globalData.navBarHeight });
  },
  onShow() {
    refreshTabBar(this, 2);
    const proceed = () => {
      const user = store.getUser();
      this.setData({
        user,
        entitlements: this.entitlementRows(user),
        loggedIn: !!user,
        phoneText: this.phoneText(user && user.phone),
      });
      if (user) {
        this.loadTab(this.data.tabIndex);
      } else {
        this._loadRequestId = (this._loadRequestId || 0) + 1;
        this.setData({ currentNotes: [], left: [], right: [], emptyText: '登录后查看' });
      }
    };
    if (store.isLogin() && (config.useRemote || config.previewAuthRemote || config.wechatAuthRemote)) store.syncMe().then(proceed); else proceed();
  },
  onTab(e) { const index = Number(e.currentTarget.dataset.index); this.setData({ tabIndex: index }); this.loadTab(index); },
  entitlementRows(user) {
    if (!user) return [];
    const now = Date.now();
    return [
      { type: 'vip', name: 'VIP', active: !!(user.vip && (user.vipPermanent || Number(user.vipExpire) > now)) },
      { type: 'gold', name: '金手指', active: Number(user.goldExpire) > now },
    ].filter((item) => item.active);
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
      wx.showModal({ title: result.alreadyRedeemed ? '该卡已兑换' : '兑换成功', content: result.alreadyRedeemed ? '权益已在当前账号生效。' : (result.type === 'gold' ? '金手指' : '会员') + '权益已增加' + result.days + '天。', showCancel: false });
    }).catch((error) => wx.showModal({ title: '兑换失败', content: this.errorText(error), showCancel: false }))
      .finally(() => this.setData({ redeemingGift: false }));
  },
  loadTab(index) {
    const user = store.getUser();
    const requestId = (this._loadRequestId || 0) + 1;
    this._loadRequestId = requestId;
    const promise = !user ? Promise.resolve([]) : (index === 0 ? api.getMyCollects() : api.getMyLikes());
    const emptyText = !user ? '登录后查看' : (index === 0 ? '还没有收藏的笔记' : '还没有赞过的笔记');
    promise.then((notes) => {
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
  phoneText(phone) {
    const value = String(phone || '');
    if (value.length === 11) return value.slice(0, 3) + '****' + value.slice(7);
    return value || '未绑定手机号';
  },
  openProfileEditor() {
    const user = store.getUser();
    if (!user) return this.goLogin();
    this.setData({
      editingProfile: true,
      draftName: user.name || '',
      draftAvatar: user.avatar || '',
    });
  },
  closeProfileEditor() {
    if (!this.data.savingProfile && !this.data.bindingPhone) this.setData({ editingProfile: false });
  },
  onNameInput(e) {
    this.setData({ draftName: e.detail.value });
  },
  onChooseAvatar(e) {
    const avatarUrl = e.detail && e.detail.avatarUrl;
    if (avatarUrl) this.setData({ draftAvatar: avatarUrl });
  },
  saveProfile() {
    if (this.data.savingProfile) return;
    const name = String(this.data.draftName || '').trim();
    const avatar = String(this.data.draftAvatar || '').trim();
    if (!avatar) return wx.showToast({ title: '请先选择头像', icon: 'none' });
    if (!name) return wx.showToast({ title: '请输入昵称', icon: 'none' });
    this.setData({ savingProfile: true });
    wx.showLoading({ title: '保存中' });
    const upload = /^https?:\/\//i.test(avatar) ? Promise.resolve(avatar) : api.uploadImage(avatar);
    upload
      .then((avatarUrl) => store.updateProfile({ name, avatar: avatarUrl }))
      .then((user) => {
        this.setData({ user, editingProfile: false, phoneText: this.phoneText(user.phone) });
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
  onGetPhoneNumber(e) {
    if (this.data.bindingPhone) return;
    const detail = e.detail || {};
    if (!detail.code || !/getPhoneNumber:ok/i.test(detail.errMsg || '')) {
      return wx.showToast({ title: '未授权手机号', icon: 'none' });
    }
    this.setData({ bindingPhone: true });
    wx.showLoading({ title: '绑定中' });
    store.bindPhone(detail.code)
      .then((user) => {
        this.setData({ user, phoneText: this.phoneText(user.phone) });
        wx.hideLoading();
        wx.showToast({ title: '手机号已绑定', icon: 'success' });
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showModal({ title: '绑定失败', content: this.errorText(err), showCancel: false });
      })
      .finally(() => {
        this.setData({ bindingPhone: false });
      });
  },
  errorText(err) {
    return (err && (err.errMsg || (err.data && err.data.error) || err.message)) || '请稍后重试';
  },
  goLogin() { wx.navigateTo({ url: '/pages/login/login' }); },
  goPoints() {
    if (!store.isLogin()) return this.goLogin();
    wx.navigateTo({ url: '/pages/points/points' });
  },
  goGoldManage() {
    const user = store.getUser();
    if (!user || user.official !== true) return;
    wx.navigateTo({ url: '/pages/gold-finger-manage/gold-finger-manage' });
  },
  goMiniGame() {
    wx.showToast({ title: '小游戏即将上线', icon: 'none' });
  },
  goDarkFunds() {
    wx.showToast({ title: '暗盘资金即将上线', icon: 'none' });
  },
  onLogout() {
    wx.showModal({ title: '提示', content: '确定要退出登录吗？', success: (res) => { if (res.confirm) { store.logout(); this.onShow(); } } });
  },
  goDetail(e) { wx.navigateTo({ url: `/pages/detail/detail?id=${e.detail.id}` }); },
});
