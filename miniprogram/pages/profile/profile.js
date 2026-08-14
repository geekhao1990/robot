const api = require('../../utils/api');
const store = require('../../utils/store');
const config = require('../../utils/config');
const { refreshTabBar } = require('../../utils/util');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    user: null,
    tabs: ['收藏', '赞过'],
    tabIndex: 0,
    currentNotes: [], left: [], right: [],
    emptyText: '还没有收藏的笔记',
    accessText: '',
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
        accessText: user ? '已登录' : '',
      });
      this.loadTab(this.data.tabIndex);
    };
    if (store.isLogin() && config.useRemote) store.syncMe().then(proceed); else proceed();
  },
  onTab(e) { const index = Number(e.currentTarget.dataset.index); this.setData({ tabIndex: index }); this.loadTab(index); },
  loadTab(index) {
    const user = store.getUser();
    const promise = !user ? Promise.resolve([]) : (index === 0 ? api.getMyCollects() : api.getMyLikes());
    const emptyText = !user ? '登录后查看' : (index === 0 ? '还没有收藏的笔记' : '还没有赞过的笔记');
    promise.then((notes) => {
      const left = [], right = []; let lh = 0, rh = 0;
      notes.forEach((n) => { const h = n.coverRatio || 1.3; if (lh <= rh) { left.push(n); lh += h; } else { right.push(n); rh += h; } });
      this.setData({ currentNotes: notes, left, right, emptyText });
    }).catch(() => this.setData({ currentNotes: [], left: [], right: [], emptyText: '暂无权限查看' }));
  },
  goLogin() { wx.navigateTo({ url: '/pages/login/login' }); },
  goService() { wx.switchTab({ url: '/pages/agent/agent' }); },
  onLogout() {
    wx.showModal({ title: '提示', content: '确定要退出登录吗？', success: (res) => { if (res.confirm) { store.logout(); this.onShow(); } } });
  },
  goDetail(e) { wx.navigateTo({ url: `/pages/detail/detail?id=${e.detail.id}` }); },
});
