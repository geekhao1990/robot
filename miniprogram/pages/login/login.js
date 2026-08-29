const store = require('../../utils/store');
const config = require('../../utils/config');

Page({
  data: {
    loggingIn: false,
    loginText: config.wechatAuthRemote ? '微信快捷登录' : '注册并进入预览',
    loginTip: config.wechatAuthRemote ? '使用微信账号快捷登录' : '连接本地后台并创建预览账号',
  },

  onLoad(options) {
    store.captureInvite(options);
  },

  onWechatLogin(e) {
    if (this.data.loggingIn) return;
    const detail = (e && e.detail) || {};
    const phoneCode = detail.code && /getPhoneNumber:ok/i.test(detail.errMsg || '')
      ? detail.code
      : '';
    this.setData({ loggingIn: true, loginText: '登录中…' });
    wx.showLoading({ title: config.wechatAuthRemote ? '微信登录中' : '连接后台中' });
    if (!config.wechatAuthRemote) {
      return this.doLogin({
        preview: true,
        name: '微信用户',
        avatar: 'https://i.pravatar.cc/150?img=68',
      }, '');
    }
    wx.login({
      timeout: 10000,
      success: ({ code }) => {
        if (!code) return this.loginFailed('未获取到微信登录凭证');
        this.doLogin({ code }, phoneCode);
      },
      fail: (err) => this.loginFailed(err.errMsg || '无法调起微信登录'),
    });
  },

  doLogin(payload, phoneCode) {
    store.login(payload).then((user) => {
      if (!phoneCode || !config.wechatAuthRemote) return user;
      return store.bindPhone(phoneCode).catch(() => user);
    }).then(() => {
      wx.hideLoading();
      this.setData({ loggingIn: false, loginText: '已登录' });
      wx.showToast({ title: '登录成功', icon: 'success' });
      setTimeout(() => this.enterApp(), 250);
    }).catch((err) => {
      const detail = (err && (err.errMsg || (err.data && err.data.error))) || '未知错误';
      this.loginFailed(detail);
    });
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
