const api = require('../../utils/api');
const store = require('../../utils/store');

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
  },

  onShow() {
    if (!store.isLogin()) {
      if (!this._loginRedirected) {
        this._loginRedirected = true;
        wx.navigateTo({ url: '/pages/login/login' });
      }
      return;
    }
    this._loginRedirected = false;
    if (this._hotLoaded) return;
    this._hotLoaded = true;
    api.getHotSearch()
      .then((hot) => this.setData({ hot }))
      .catch((err) => {
        this._hotLoaded = false;
        this.setData({ hot: [] });
        if (err && err.statusCode === 401 && !this._loginRedirected) {
          this._loginRedirected = true;
          wx.navigateTo({ url: '/pages/login/login' });
        }
      });
  },

  onInput(e) {
    this._searchRequestId = (this._searchRequestId || 0) + 1;
    this.setData({ keyword: e.detail.value, searched: false });
  },

  clearInput() {
    this._searchRequestId = (this._searchRequestId || 0) + 1;
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
    const requestId = (this._searchRequestId || 0) + 1;
    this._searchRequestId = requestId;
    api.search(kw).then((results) => {
      if (requestId !== this._searchRequestId) return;
      const left = [], right = [];
      let lh = 0, rh = 0;
      results.forEach((n) => {
        const h = n.coverRatio || 1.3;
        if (lh <= rh) { left.push(n); lh += h; }
        else { right.push(n); rh += h; }
      });
      this.setData({ results, left, right, loading: false });
    }).catch((err) => {
      if (requestId !== this._searchRequestId) return;
      this.setData({ results: [], left: [], right: [], loading: false });
      if (err && err.statusCode === 401) {
        this._loginRedirected = true;
        wx.showModal({
          title: '登录已失效',
          content: '请重新登录后搜索。',
          showCancel: false,
          success: () => wx.navigateTo({ url: '/pages/login/login' }),
        });
      } else {
        wx.showToast({ title: '搜索失败，请稍后重试', icon: 'none' });
      }
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
