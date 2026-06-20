const api = require('../../utils/api');
const store = require('../../utils/store');
const config = require('../../utils/config');
const { formatCount, refreshTabBar } = require('../../utils/util');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    user: null,
    likeCollectCount: '0',
    followCount: 0,
    fansCount: 0,
    tabs: ['笔记', '收藏', '赞过'],
    tabIndex: 0,
    currentNotes: [],
    left: [],
    right: [],
    emptyText: '还没有内容～',
    hasDraft: false,
    draftCount: 0,
    draftTitle: '',
    draftCover: '',
    vipActive: false,
    vipStatusText: '',
  },

  onLoad() {
    const app = getApp();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
    });
  },

  onShow() {
    refreshTabBar(this, 4);
    const proceed = () => {
      this.applyUser(store.getUser());
      this.refreshDraft();
      this.loadTab(this.data.tabIndex);
    };
    // 登录态下从后端刷新会员/交互状态（后台开通会员后这里能即时反映）
    if (store.isLogin() && config.useRemote) store.syncMe().then(proceed);
    else proceed();
  },

  // 渲染用户信息 + VIP 状态文案
  applyUser(user) {
    if (!user) {
      return this.setData({ user: null, likeCollectCount: '0', followCount: 0, fansCount: 0, vipActive: false, vipStatusText: '' });
    }
    const now = Date.now();
    const vipActive = !!(user.vipActive || (user.vip && user.vipExpire && user.vipExpire > now));
    let vipStatusText;
    if (vipActive) vipStatusText = '有效期至 ' + this.fmtDate(user.vipExpire);
    else if (user.vipExpire) vipStatusText = 'VIP 已过期，续费请联系企业微信';
    else vipStatusText = '免广告看课程 · 朱杨张等老师服务包';
    this.setData({
      user,
      followCount: store.followedIds().length,
      fansCount: user.fans || 0,
      vipActive,
      vipStatusText,
    });
    this.refreshStats();
  },

  // 我的发布统计（获赞与收藏）
  refreshStats() {
    api.getMyNotes().then((notes) => {
      let likes = 0, collects = 0;
      notes.forEach((n) => { likes += n.likes || 0; collects += n.collects || 0; });
      this.setData({ likeCollectCount: formatCount(likes + collects) });
    });
  },

  refreshDraft() {
    const draft = wx.getStorageSync('xhs_publish_draft');
    const has = !!(draft && (draft.title || draft.content || (draft.images || []).length));
    this.setData({
      hasDraft: has,
      draftCount: has ? 1 : 0,
      draftTitle: has ? (draft.title || draft.content || '未命名草稿').slice(0, 30) : '',
      draftCover: has && draft.images && draft.images.length ? draft.images[0] : '',
    });
  },

  goDraft() {
    getApp().globalData.openDraft = true;
    wx.switchTab({ url: '/pages/publish/publish' });
  },

  goVip() {
    wx.navigateTo({ url: '/pages/vip/vip' });
  },

  fmtDate(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  },

  goRelations(e) {
    const type = e.currentTarget.dataset.type;
    wx.navigateTo({ url: `/pages/relations/relations?type=${type}` });
  },

  showStats() {
    api.getMyNotes().then((notes) => {
      let likes = 0, collects = 0;
      notes.forEach((n) => { likes += n.likes || 0; collects += n.collects || 0; });
      wx.showModal({
        title: '我的数据',
        content: `发布笔记：${notes.length}\n获得点赞：${likes}\n获得收藏：${collects}`,
        showCancel: false,
        confirmText: '知道了',
      });
    });
  },

  onPullDownRefresh() {
    this.onShow();
    wx.stopPullDownRefresh();
  },

  onTab(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ tabIndex: index });
    this.loadTab(index);
  },

  loadTab(index) {
    const user = store.getUser();
    let promise;
    let emptyText;
    if (index === 0) {
      promise = user ? api.getMyNotes() : Promise.resolve([]);
      emptyText = user ? '还没有发布笔记，去发布第一篇吧~' : '登录后查看你的笔记';
    } else if (index === 1) {
      promise = user ? api.getMyCollects() : Promise.resolve([]);
      emptyText = user ? '还没有收藏的笔记' : '登录后查看收藏';
    } else {
      promise = user ? api.getMyLikes() : Promise.resolve([]);
      emptyText = user ? '还没有赞过的笔记' : '登录后查看赞过';
    }

    promise.then((notes) => {
      const left = [], right = [];
      let lh = 0, rh = 0;
      notes.forEach((n) => {
        const h = n.coverRatio || 1.3;
        if (lh <= rh) { left.push(n); lh += h; }
        else { right.push(n); rh += h; }
      });
      this.setData({ currentNotes: notes, left, right, emptyText });
    });
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  onLogout() {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          store.logout();
          this.applyUser(null);
          this.loadTab(this.data.tabIndex);
        }
      },
    });
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.detail.id}` });
  },
});
