const api = require('../../utils/api');
const store = require('../../utils/store');

function today() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function displayRecord(record) {
  const yang = Math.max(0, Math.min(100, Number(record.yang) || 0));
  return {
    ...record,
    yang,
    yin: 100 - yang,
    fingerText: record.finger === 'silver' ? '银手指' : '金手指',
    trendText: record.trend === 'down' ? '下跌' : '上涨',
  };
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    headerHeight: 64,
    loading: true,
    saving: false,
    records: [],
    fingerOptions: ['金手指', '银手指'],
    trendOptions: ['上涨', '下跌'],
    form: {
      date: today(),
      yang: '50',
      fingerIndex: 0,
      fingerText: '金手指',
      trendIndex: 0,
      trendText: '上涨',
      position: '50',
    },
  },

  onLoad() {
    const app = getApp();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      headerHeight: app.globalData.statusBarHeight + app.globalData.navBarHeight,
    });
    const user = store.getUser();
    if (!store.isLogin() || !user || !user.official) {
      wx.showModal({
        title: '无管理权限',
        content: '请使用后台标记为官方账号的微信账号登录。',
        showCancel: false,
        success: () => this.goBack(),
      });
      return;
    }
    this.loadRecords();
  },

  loadRecords() {
    this.setData({ loading: true });
    api.getOfficialGoldFinger().then((records) => {
      this.setData({ loading: false, records: (records || []).map(displayRecord) });
    }).catch((error) => {
      this.setData({ loading: false });
      wx.showToast({ title: (error && error.data && error.data.message) || '加载失败', icon: 'none' });
    });
  },

  setFormValue(key, value) {
    this.setData({ [`form.${key}`]: value });
  },

  onDateChange(e) { this.setFormValue('date', e.detail.value); },
  onYangInput(e) { this.setFormValue('yang', e.detail.value); },
  onPositionInput(e) { this.setFormValue('position', e.detail.value); },
  onFingerChange(e) {
    const fingerIndex = Number(e.detail.value);
    this.setData({ 'form.fingerIndex': fingerIndex, 'form.fingerText': this.data.fingerOptions[fingerIndex] });
  },
  onTrendChange(e) {
    const trendIndex = Number(e.detail.value);
    this.setData({ 'form.trendIndex': trendIndex, 'form.trendText': this.data.trendOptions[trendIndex] });
  },

  save() {
    if (this.data.saving) return;
    const form = this.data.form;
    const yang = Number(form.yang);
    const position = Number(form.position);
    if (!Number.isInteger(yang) || yang < 0 || yang > 100 || !Number.isInteger(position) || position < 0 || position > 100) {
      return wx.showToast({ title: '阳谱和仓位须为0-100整数', icon: 'none' });
    }
    this.setData({ saving: true });
    api.saveOfficialGoldFinger(form.date, {
      yang,
      position,
      finger: form.fingerIndex === 1 ? 'silver' : 'gold',
      trend: form.trendIndex === 1 ? 'down' : 'up',
    }).then(() => {
      this.setData({ saving: false });
      wx.showToast({ title: '已保存', icon: 'success' });
      this.loadRecords();
    }).catch((error) => {
      this.setData({ saving: false });
      wx.showToast({ title: (error && error.data && error.data.message) || '保存失败', icon: 'none' });
    });
  },

  edit(e) {
    const record = e.currentTarget.dataset.record;
    if (!record) return;
    this.setData({
      form: {
        date: record.date,
        yang: String(record.yang),
        fingerIndex: record.finger === 'silver' ? 1 : 0,
        fingerText: record.finger === 'silver' ? '银手指' : '金手指',
        trendIndex: record.trend === 'down' ? 1 : 0,
        trendText: record.trend === 'down' ? '下跌' : '上涨',
        position: String(record.position),
      },
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 250 });
  },

  remove(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    wx.showModal({
      title: '删除记录',
      content: `确认删除 ${date} 的金手指数据吗？`,
      success: (result) => {
        if (!result.confirm) return;
        api.deleteOfficialGoldFinger(date).then(() => {
          wx.showToast({ title: '已删除', icon: 'success' });
          this.loadRecords();
        }).catch((error) => {
          wx.showToast({ title: (error && error.data && error.data.message) || '删除失败', icon: 'none' });
        });
      },
    });
  },

  reset() {
    this.setData({ form: { date: today(), yang: '50', fingerIndex: 0, fingerText: '金手指', trendIndex: 0, trendText: '上涨', position: '50' } });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },
});
