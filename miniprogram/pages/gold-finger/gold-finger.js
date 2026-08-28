const api = require('../../utils/api');
const store = require('../../utils/store');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    headerHeight: 64,
    loading: true,
    record: null,
    notice: '',
    fingerText: '',
    trendText: '',
    dateText: '',
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
      this.setData({
        loading: false,
        record: record || null,
        notice: (result && result.notice) || '法定节假日休市，以最新交易日数据为准。',
        fingerText: record && record.finger === 'silver' ? '银手指' : '金手指',
        trendText: record && record.trend === 'down' ? '下跌' : '上涨',
        dateText: record ? this.formatDate(record.date) : '',
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

  formatDate(value) {
    const parts = String(value || '').split('-');
    if (parts.length !== 3) return value || '';
    return `${parts[0]}年${Number(parts[1])}月${Number(parts[2])}日`;
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },
});
