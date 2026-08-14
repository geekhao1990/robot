const api = require('../../utils/api');
const store = require('../../utils/store');
const { refreshTabBar } = require('../../utils/util');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    headerHeight: 64,
    navTabs: [
      { key: 'home', label: '首页' },
      { key: 'material', label: '资料' },
      { key: 'course', label: '课程' },
    ],
    tab: 'home',
    left: [],
    right: [],
    leftH: 0,
    rightH: 0,
    page: 1,
    hasMore: true,
    loading: false,
    emptyText: '这里还没有内容～',
  },

  onLoad() {
    const app = getApp();
    const statusBarHeight = app.globalData.statusBarHeight;
    const navBarHeight = app.globalData.navBarHeight;
    this.setData({
      statusBarHeight,
      navBarHeight,
      headerHeight: statusBarHeight + navBarHeight,
    });

    if (!this.ensureAccess()) return;
    this.loadFeed(true);
  },

  onShow() {
    refreshTabBar(this, 0);
    if (!this.ensureAccess()) return;
    this.syncLikes();
  },

  ensureAccess() {
    // 本地演示阶段关闭登录/权限校验。
    return true;
  },

  // 以 store 为准，刷新当前卡片的点赞状态与数量
  syncLikes() {
    const fix = (arr) =>
      arr.map((n) => {
        const liked = store.isLiked(n.id);
        const base = (n.likes || 0) - (n.liked ? 1 : 0);
        return { ...n, liked, likes: base + (liked ? 1 : 0) };
      });
    this.setData({ left: fix(this.data.left), right: fix(this.data.right) });
  },

  // 瀑布流分列：累计高度短的一列优先放入
  distribute(notes) {
    let { left, right, leftH, rightH } = this.data;
    notes.forEach((n) => {
      const h = n.coverRatio || 1.3; // 用比例近似高度
      if (leftH <= rightH) {
        left = left.concat(n);
        leftH += h + 0.5;
      } else {
        right = right.concat(n);
        rightH += h + 0.5;
      }
    });
    this.setData({ left, right, leftH, rightH });
  },

  loadFeed(reset = false) {
    if (this.data.loading) return;
    if (!reset && !this.data.hasMore) return;
    this.setData({ loading: true });
    const page = reset ? 1 : this.data.page;

    if (reset) {
      this.setData({ left: [], right: [], leftH: 0, rightH: 0 });
    }

    api.getFeed({ tab: this.data.tab, page, size: 8 }).then((res) => {
      this.distribute(res.list);
      this.setData({
        page: page + 1,
        hasMore: res.hasMore,
        loading: false,
        emptyText: '这里还没有内容～',
      });
      wx.stopPullDownRefresh();
    }).catch((err) => {
      this.setData({ loading: false, emptyText: err && err.statusCode === 403 ? '账号尚未通过审核' : '加载失败，请稍后重试' });
      wx.stopPullDownRefresh();
    });
  },

  onTabChange(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.tab) return;
    this.setData({ tab, page: 1, hasMore: true });
    this.loadFeed(true);
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/search/search' });
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.detail.id}` });
  },

  onCardLike(e) {
    // 同步父级数组，避免后续加载/重渲染时卡片状态回退
    const { id, liked, likes } = e.detail;
    const update = (arr) =>
      arr.map((n) => (n.id === id ? { ...n, liked, likes } : n));
    this.setData({ left: update(this.data.left), right: update(this.data.right) });
  },

  onPullDownRefresh() {
    this.setData({ page: 1, hasMore: true });
    this.loadFeed(true);
  },

  onReachBottom() {
    this.loadFeed(false);
  },
});
