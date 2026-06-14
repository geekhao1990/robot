const api = require('../../utils/api');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    headerHeight: 64,
    navTabs: [
      { key: 'home', label: '首页' },
      { key: 'discover', label: '发现' },
      { key: 'follow', label: '关注' },
    ],
    tab: 'discover',
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

    this.loadFeed(true);
  },

  onShow() {
    // 「关注」tab 依赖关注状态，返回首页时刷新
    if (this.data.tab === 'follow') {
      this.setData({ page: 1, hasMore: true });
      this.loadFeed(true);
    }
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
        emptyText: this.data.tab === 'follow'
          ? '还没有关注的人发布内容，去发现页逛逛吧~'
          : '这里还没有内容～',
      });
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
