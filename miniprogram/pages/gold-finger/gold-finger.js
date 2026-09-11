const api = require('../../utils/api');

const GOLD_FINGER_ICON = 'https://app.nankaitechschool.com/uploads/up_1787930384458_5f0008fd90bf8d07.png';
const SILVER_FINGER_ICON = 'https://app.nankaitechschool.com/uploads/up_1787930384616_32050eca372a0969.png';
const store = require('../../utils/store');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    headerHeight: 64,
    loading: true,
    record: null,
    records: [],
    banners: [],
    historyExpanded: false,
    historyLoading: false,
    hasMoreHistory: false,
    historyPage: 1,
    historyTotalPages: 1,
  },

  onLoad() {
    const app = getApp();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      headerHeight: app.globalData.statusBarHeight + app.globalData.navBarHeight,
    });
    if (!store.isLogin()) return wx.redirectTo({ url: '/pages/login/login' });
    this.loadData();
  },

  loadData() {
    this.setData({ loading: true });
    api.getGoldFinger().then((result) => {
      const record = result && result.record;
      const records = ((result && result.records) || (record ? [record] : [])).map((item) => this.decorateRecord(item));
      this.setData({
        loading: false,
        record: record || null,
        records,
        banners: (result && result.banners) || [],
        historyExpanded: false,
        hasMoreHistory: result && result.hasMoreHistory === true,
        historyPage: 1,
        historyTotalPages: 1,
      });
    }).catch((error) => {
      this.setData({ loading: false });
      const statusCode = error && error.statusCode;
      wx.showModal({
        title: statusCode === 403 ? '会员专享功能' : '加载失败',
        content: statusCode === 403 ? '会员已到期或尚未开通，请返回金手指笔记开通9.9元月卡。' : '数据暂时无法加载，请稍后重试。',
        showCancel: false,
        success: () => this.goBack(),
      });
    });
  },

  decorateRecord(record) {
    const yang = Math.max(0, Math.min(100, Number(record.yang) || 0));
    const yin = 100 - yang;
    return {
      ...record,
      yang,
      yin,
      fingerIcon: record.finger === 'silver' ? SILVER_FINGER_ICON : GOLD_FINGER_ICON,
      trendText: record.trend === 'down' ? '↓' : '↑',
      yangClass: yang > 50 ? 'strong' : '',
      yinClass: yin > 50 ? 'strong' : '',
    };
  },

  loadMoreHistory() {
    this.loadHistoryPage(1);
  },

  changeHistoryPage(e) {
    this.loadHistoryPage(Number(e.currentTarget.dataset.page));
  },

  loadHistoryPage(page) {
    if (this.data.historyLoading || !Number.isInteger(page) || page < 1) return;
    if (this.data.historyExpanded && page > this.data.historyTotalPages) return;
    this.setData({ historyExpanded: true, historyLoading: true });
    api.getGoldFingerHistory(page).then((result) => {
      const records = ((result && result.records) || []).map((item) => this.decorateRecord(item));
      this.setData({
        records,
        historyLoading: false,
        historyPage: Number(result && result.page) || 1,
        historyTotalPages: Number(result && result.totalPages) || 1,
      });
    }).catch(() => {
      this.setData({ historyLoading: false });
      wx.showToast({ title: '历史数据加载失败', icon: 'none' });
    });
  },

  goBannerNote(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/detail/detail?id=${encodeURIComponent(id)}` });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },
});
