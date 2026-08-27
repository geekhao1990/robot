const store = require('../../utils/store');
const config = require('../../utils/config');

Page({
  data: {
    loggingIn: false,
    phoneStep: false,
    bindingPhone: false,
    loginText: config.wechatAuthRemote ? '微信快捷登录' : '注册并进入预览',
    loginTip: config.wechatAuthRemote ? '使用微信账号快捷登录' : '连接本地后台并创建预览账号',
  },

  onLoad(options) {
    store.captureInvite(options);
  },

  onWechatLogin() {
    if (this.data.loggingIn) return;
    this.setData({ loggingIn: true, loginText: '登录中…' });
    wx.showLoading({ title: config.wechatAuthRemote ? '微信登录中' : '连接后台中' });
    if (!config.wechatAuthRemote) {
      return this.doLogin({
        preview: true,
        name: '微信用户',
        avatar: 'https://i.pravatar.cc/150?img=68',
      });
    }
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
    store.login(payload).then((user) => {
      wx.hideLoading();
      this.setData({ loggingIn: false, loginText: '已登录' });
      wx.showToast({ title: '登录成功', icon: 'success' });
      if (config.wechatAuthRemote && !(user && user.phone)) {
        this.setData({ phoneStep: true });
      } else {
        setTimeout(() => this.enterApp(), 250);
      }
    }).catch((err) => {
      const detail = (err && (err.errMsg || (err.data && err.data.error))) || '未知错误';
      this.loginFailed(detail);
    });
  },

  onGetPhoneNumber(e) {
    if (this.data.bindingPhone) return;
    const detail = e.detail || {};
    if (!detail.code || !/getPhoneNumber:ok/i.test(detail.errMsg || '')) {
      return this.skipPhone();
    }
    this.setData({ bindingPhone: true });
    wx.showLoading({ title: '绑定手机号' });
    store.bindPhone(detail.code)
      .then(() => wx.showToast({ title: '手机号已绑定', icon: 'success' }))
      .catch(() => wx.showToast({ title: '未绑定，可稍后重试', icon: 'none' }))
      .finally(() => {
        wx.hideLoading();
        this.setData({ bindingPhone: false, phoneStep: false });
        setTimeout(() => this.enterApp(), 200);
      });
  },

  skipPhone() {
    this.setData({ phoneStep: false });
    this.enterApp();
  },

  enterApp() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/profile/profile' });
  },

  loginFailed(detail) {
    wx.hideLoading();
    this.setData({
      loggingIn: false,
      loginText: config.wechatAuthRemote ? '微信快捷登录' : '注册并进入预览',
    });
    wx.showModal({ title: '微信登录失败', content: detail, showCancel: false });
  },
});
