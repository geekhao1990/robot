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
    accessText: '',
    phoneText: '未绑定手机号',
    editingProfile: false,
    savingProfile: false,
    bindingPhone: false,
    draftName: '',
    draftAvatar: '',
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
        loggedIn: !!user,
        phoneText: this.phoneText(user && user.phone),
        accessText: user
          ? (config.useRemote || config.previewAuthRemote || config.wechatAuthRemote ? '已登录' : '已登录（模拟）')
          : '',
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
  onLogout() {
    wx.showModal({ title: '提示', content: '确定要退出登录吗？', success: (res) => { if (res.confirm) { store.logout(); this.onShow(); } } });
  },
  goDetail(e) { wx.navigateTo({ url: `/pages/detail/detail?id=${e.detail.id}` }); },
});
