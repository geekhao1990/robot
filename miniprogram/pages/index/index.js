const api = require('../../utils/api');
const store = require('../../utils/store');
const { refreshTabBar } = require('../../utils/util');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    searchBarHeight: 52,
    headerHeight: 116,
    navTabs: [
      { key: 'following', label: '关注' },
      { key: 'discover', label: '发现' },
    ],
    tab: 'discover',
    left: [],
    right: [],
    leftH: 0,
    rightH: 0,
    page: 1,
    hasMore: true,
    loading: false,
    refreshing: false,
    refreshReady: false,
    emptyText: '这里还没有内容～',
    feedScrollTop: 0,
  },

  onLoad() {
    const app = getApp();
    const statusBarHeight = app.globalData.statusBarHeight;
    const navBarHeight = app.globalData.navBarHeight;
    this.setData({
      statusBarHeight,
      navBarHeight,
      headerHeight: statusBarHeight + navBarHeight + this.data.searchBarHeight,
    });

    this.loadFeed(true);
  },

  onShow() {
    refreshTabBar(this, 0);
    if (this._returningFromDetail) {
      this._returningFromDetail = false;
      return;
    }
    if (!this._hasShown) {
      this._hasShown = true;
      return;
    }
    if (this.data.tab === 'following') {
      if (!store.isLogin()) {
        this.setData({ tab: 'discover' });
        return this.loadFeed(true);
      }
      this.setData({ page: 1, hasMore: true });
      this.loadFeed(true);
    } else {
      // 每次回到首页都重新读取全局入口开关；单个用户权益不影响金手指笔记展示。
      this.setData({ page: 1, hasMore: true });
      this.loadFeed(true);
    }
  },

  ensureAccess() {
    if (store.isLogin()) return true;
    wx.navigateTo({ url: '/pages/login/login' });
    return false;
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
  distribute(notes, reset = false) {
    let left = reset ? [] : this.data.left;
    let right = reset ? [] : this.data.right;
    let leftH = reset ? 0 : this.data.leftH;
    let rightH = reset ? 0 : this.data.rightH;
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
    if (this.data.loading) {
      this.finishRefresh();
      return;
    }
    if (!reset && !this.data.hasMore) {
      this.finishRefresh();
      return;
    }
    this.setData({ loading: true });
    const page = reset ? 1 : this.data.page;

    api.getFeed({ tab: this.data.tab, page, size: 8 }).then((res) => {
      this.distribute(res.list, reset);
      this.setData({
        page: page + 1,
        hasMore: res.hasMore,
        loading: false,
        emptyText: this.data.tab === 'following' ? '还没有关注内容' : '这里还没有内容～',
      });
      this.finishRefresh();
    }).catch((err) => {
      this.setData({ loading: false, emptyText: '加载失败，请稍后重试' });
      this.finishRefresh();
      if (err && err.statusCode === 401) this.ensureAccess();
    });
  },

  finishRefresh() {
    if (!this.data.refreshing && !this.data.refreshReady) return;
    this.setData({ refreshing: false, refreshReady: false });
  },

  onTabChange(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.tab) return;
    if (tab === 'following' && !store.isLogin()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    this._currentScrollTop = 0;
    this.setData({ tab, page: 1, hasMore: true, feedScrollTop: 0 });
    this.loadFeed(true);
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/search/search' });
  },

  goDetail(e) {
    const id = e.detail && e.detail.id;
    if (!id) return;
    this._returningFromDetail = true;
    const feedScrollTop = Number(this._currentScrollTop) || 0;
    this.setData({ feedScrollTop }, () => {
      wx.navigateTo({
        url: `/pages/detail/detail?id=${encodeURIComponent(id)}`,
        fail: () => { this._returningFromDetail = false; },
      });
    });
  },

  onFeedScroll(e) {
    this._currentScrollTop = Number(e.detail && e.detail.scrollTop) || 0;
  },

  onCardLike(e) {
    // 同步父级数组，避免后续加载/重渲染时卡片状态回退
    const { id, liked, likes } = e.detail;
    const update = (arr) =>
      arr.map((n) => (n.id === id ? { ...n, liked, likes } : n));
    this.setData({ left: update(this.data.left), right: update(this.data.right) });
  },

  onRefresherPulling(e) {
    if (this.data.refreshing) return;
    const refreshReady = Number(e.detail && e.detail.dy) >= 64;
    if (refreshReady !== this.data.refreshReady) this.setData({ refreshReady });
  },

  onRefresherRefresh() {
    if (this.data.refreshing) return;
    this.setData({ refreshing: true, refreshReady: false, page: 1, hasMore: true });
    this.loadFeed(true);
  },

  onRefresherRestore() {
    if (this.data.refreshReady) this.setData({ refreshReady: false });
  },

  onRefresherAbort() {
    if (this.data.refreshReady) this.setData({ refreshReady: false });
  },

  onScrollToLower() {
    this.loadFeed(false);
  },
});
