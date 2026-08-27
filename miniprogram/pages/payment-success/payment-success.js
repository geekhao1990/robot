const api = require('../../utils/api');
const store = require('../../utils/store');
const config = require('../../utils/config');

Page({
  data: {
    verified: false,
    loading: true,
    vipQr: config.vipQr,
    memberCode: '',
    orderId: '',
    expireText: '',
  },

  onLoad(options) {
    this.orderId = options.orderId || '';
    if (!this.orderId) return this.fail('支付订单不存在');
    api.getVipOrder(this.orderId)
      .then((result) => {
        if (!result || result.status !== 'SUCCESS' || !result.user) throw new Error('支付结果尚未确认');
        store.setUser(result.user);
        this.setData({
          verified: true,
          loading: false,
          memberCode: result.user.id,
          orderId: this.orderId,
          expireText: this.formatExpire(result.user.vipExpire),
        });
      })
      .catch((error) => this.fail((error && (error.data && error.data.error || error.message)) || '支付结果确认失败'));
  },

  formatExpire(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  },

  fail(message) {
    this.setData({ loading: false });
    wx.showModal({ title: '暂未确认', content: message, showCancel: false, success: () => this.goBack() });
  },

  previewQr() {
    wx.previewImage({ current: config.vipQr, urls: [config.vipQr] });
  },

  copyVerifyInfo() {
    if (!this.data.orderId || !this.data.memberCode) return;
    wx.setClipboardData({
      data: `订单号：${this.data.orderId}\n会员编号：${this.data.memberCode}`,
      success: () => wx.showToast({ title: '核销信息已复制', icon: 'none' }),
    });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },
});
