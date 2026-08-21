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
    memberStatus: '尚未开通会员',
    buyingPlan: '',
    memberPlans: [
      { id: 'month', name: '月卡', price: '10' },
      { id: 'year', name: '年卡', price: '99' },
      { id: 'lifetime', name: '永久卡', price: '188' },
    ],
  },
  onLoad() {
    const app = getApp();
    this.setData({ statusBarHeight: app.globalData.statusBarHeight, navBarHeight: app.globalData.navBarHeight });
  },
  onShow() {
    refreshTabBar(this, 2);
    const proceed = () => {
      const user = store.getUser();
      const now = Date.now();
      const memberStatus = user && user.vipPermanent
        ? '永久会员'
        : (user && user.vip && user.vipExpire > now
          ? `会员有效期至 ${this.fmtDate(user.vipExpire)}`
          : '尚未开通会员');
      this.setData({
        user,
        loggedIn: !!user,
        memberStatus,
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
  goLogin() { wx.navigateTo({ url: '/pages/login/login' }); },
  fmtDate(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  },
  onBuyMember(e) {
    if (!store.isLogin()) return this.goLogin();
    if (this.data.buyingPlan) return;
    const plan = e.currentTarget.dataset.plan;
    this.setData({ buyingPlan: plan });
    wx.showLoading({ title: '创建支付订单' });
    api.createVipOrder(plan)
      .then(({ orderId, payment }) => {
        wx.hideLoading();
        return new Promise((resolve, reject) => {
          wx.requestPayment({ ...payment, success: () => resolve(orderId), fail: reject });
        });
      })
      .then((orderId) => this.confirmMemberOrder(orderId, 0))
      .catch((err) => {
        wx.hideLoading();
        this.setData({ buyingPlan: '' });
        const message = (err && err.errMsg) || (err && err.data && err.data.error) || '支付失败，请稍后重试';
        if (message.includes('cancel')) return;
        wx.showModal({ title: '暂时无法支付', content: message, showCancel: false });
      });
  },
  confirmMemberOrder(orderId, attempt) {
    wx.showLoading({ title: '确认支付结果' });
    return api.getVipOrder(orderId).then((result) => {
      if (result.status === 'SUCCESS') {
        wx.hideLoading();
        if (result.user) store.setUser(result.user);
        this.setData({ buyingPlan: '' });
        wx.showToast({ title: '会员已开通', icon: 'success' });
        this.onShow();
        return result;
      }
      if (attempt < 3) {
        return new Promise((resolve) => setTimeout(resolve, 1200))
          .then(() => this.confirmMemberOrder(orderId, attempt + 1));
      }
      throw new Error('支付结果确认中，请稍后进入“我”页面查看');
    });
  },
  onLogout() {
    wx.showModal({ title: '提示', content: '确定要退出登录吗？', success: (res) => { if (res.confirm) { store.logout(); this.onShow(); } } });
  },
  goDetail(e) { wx.navigateTo({ url: `/pages/detail/detail?id=${e.detail.id}` }); },
});
