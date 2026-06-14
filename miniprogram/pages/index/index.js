const api = require('../../utils/api');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    headerHeight: 120,
    categories: ['推荐'],
    category: '推荐',
    left: [],
    right: [],
    leftH: 0,
    rightH: 0,
    page: 1,
    hasMore: true,
    loading: false,
  },

  onLoad() {
    const app = getApp();
    const statusBarHeight = app.globalData.statusBarHeight;
    const navBarHeight = app.globalData.navBarHeight;
    // 头部高度 ≈ 状态栏 + 导航栏 + 分类标签(约 50px)
    this.setData({
      statusBarHeight,
      navBarHeight,
      headerHeight: statusBarHeight + navBarHeight + 50,
    });

    api.getCategories().then((cats) => this.setData({ categories: cats }));
    this.loadFeed(true);
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

    api.getFeed({ category: this.data.category, page, size: 8 }).then((res) => {
      this.distribute(res.list);
      this.setData({
        page: page + 1,
        hasMore: res.hasMore,
        loading: false,
      });
      wx.stopPullDownRefresh();
    });
  },

  onTabChange(e) {
    const cat = e.currentTarget.dataset.cat;
    if (cat === this.data.category) return;
    this.setData({ category: cat, page: 1, hasMore: true });
    this.loadFeed(true);
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/search/search' });
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.detail.id}` });
  },

  onCardLike() {
    // 点赞状态已由组件 + store 处理，这里无需额外操作
  },

  onPullDownRefresh() {
    this.setData({ page: 1, hasMore: true });
    this.loadFeed(true);
  },

  onReachBottom() {
    this.loadFeed(false);
  },
});
