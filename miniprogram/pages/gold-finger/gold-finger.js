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
    records: [],
    historyExpanded: false,
    historyLoading: false,
    nextHistoryMonth: '',
    hasMoreHistory: false,
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
        notice: (result && result.notice) || '法定节假日休市，以最新交易日数据为准。',
        fingerText: record && record.finger === 'silver' ? '银手指' : '金手指',
        trendText: record && record.trend === 'down' ? '下跌' : '上涨',
        dateText: record ? this.formatDate(record.date) : '',
        records,
        historyExpanded: false,
        nextHistoryMonth: (result && result.historyMonth) || '',
        hasMoreHistory: result && result.hasMoreHistory === true,
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

  decorateRecord(record) {
    return {
      ...record,
      fingerText: record.finger === 'silver' ? '银手指' : '金手指',
      trendText: record.trend === 'down' ? '下跌' : '上涨',
    };
  },

  loadMoreHistory() {
    if (this.data.historyLoading || !this.data.nextHistoryMonth) return;
    this.setData({ historyExpanded: true, historyLoading: true });
    api.getGoldFingerHistory(this.data.nextHistoryMonth).then((result) => {
      const map = {};
      this.data.records.forEach((item) => { map[item.date] = item; });
      ((result && result.records) || []).forEach((item) => { map[item.date] = this.decorateRecord(item); });
      const records = Object.keys(map).map((date) => map[date]).sort((a, b) => String(b.date).localeCompare(String(a.date)));
      this.setData({
        records,
        historyLoading: false,
        hasMoreHistory: result && result.hasMore === true,
        nextHistoryMonth: (result && result.previousMonth) || '',
      });
    }).catch(() => {
      this.setData({ historyLoading: false });
      wx.showToast({ title: '历史数据加载失败', icon: 'none' });
    });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },
});
