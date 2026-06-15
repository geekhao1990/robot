const api = require('../../utils/api');

const HISTORY_KEY = 'xhs_search_history';

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    headerHeight: 64,
    keyword: '',
    autoFocus: true,
    history: [],
    hot: [],
    searched: false,
    loading: false,
    results: [],
    left: [],
    right: [],
  },

  onLoad() {
    const app = getApp();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      headerHeight: app.globalData.statusBarHeight + app.globalData.navBarHeight,
      history: wx.getStorageSync(HISTORY_KEY) || [],
    });
    api.getHotSearch().then((hot) => this.setData({ hot }));
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value, searched: false });
  },

  clearInput() {
    this.setData({ keyword: '', searched: false, results: [], left: [], right: [] });
  },

  onTapWord(e) {
    this.setData({ keyword: e.currentTarget.dataset.kw });
    this.doSearch();
  },

  onSearch() {
    this.doSearch();
  },

  doSearch() {
    const kw = this.data.keyword.trim();
    if (!kw) return;
    this.saveHistory(kw);
    this.setData({ searched: true, loading: true, left: [], right: [] });
    api.search(kw).then((results) => {
      const left = [], right = [];
      let lh = 0, rh = 0;
      results.forEach((n) => {
        const h = n.coverRatio || 1.3;
        if (lh <= rh) { left.push(n); lh += h; }
        else { right.push(n); rh += h; }
      });
      this.setData({ results, left, right, loading: false });
    });
  },

  saveHistory(kw) {
    let history = this.data.history.filter((h) => h !== kw);
    history.unshift(kw);
    history = history.slice(0, 10);
    this.setData({ history });
    wx.setStorageSync(HISTORY_KEY, history);
  },

  clearHistory() {
    this.setData({ history: [] });
    wx.removeStorageSync(HISTORY_KEY);
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.detail.id}` });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },
});
