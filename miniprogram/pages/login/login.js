const store = require('../../utils/store');

Page({
  onWechatLogin() {
    wx.showLoading({ title: '微信登录中' });
    wx.login({
      timeout: 10000,
      success: ({ code }) => {
        if (!code) return this.loginFailed('未获取到微信登录凭证');
        this.doLogin({ code });
      },
      fail: (err) => this.loginFailed(err.errMsg || '无法调起微信登录'),
    });
  },

  doLogin(payload) {
    store.login(payload).then(() => {
      wx.hideLoading();
      wx.showToast({ title: '登录成功', icon: 'success' });
      setTimeout(() => {
        const pages = getCurrentPages();
        if (pages.length > 1) wx.navigateBack();
        else wx.switchTab({ url: '/pages/profile/profile' });
      }, 500);
    }).catch((err) => {
      const detail = (err && (err.errMsg || (err.data && err.data.error))) || '未知错误';
      this.loginFailed(detail);
    });
  },

  loginFailed(detail) {
    wx.hideLoading();
    wx.showModal({ title: '微信登录失败', content: detail, showCancel: false });
  },
});
