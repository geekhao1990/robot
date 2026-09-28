// app.js
const store = require('./utils/store');

App({
  globalData: {
    userInfo: null,
    statusBarHeight: 20,
    navBarHeight: 44,
  },

  onLaunch(options) {
    // 读取系统信息，计算自定义导航栏高度
    try {
      const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
      this.globalData.statusBarHeight = sys.statusBarHeight || 20;
      if (menu) {
        // 导航栏高度 = 胶囊高度 + (胶囊上边距 - 状态栏高度) * 2
        this.globalData.navBarHeight =
          menu.height + (menu.top - this.globalData.statusBarHeight) * 2;
      }
    } catch (e) {
      console.warn('getSystemInfo failed', e);
    }

    // 初始化本地缓存，并从后端同步当前用户与交互状态
    store.init();
    store.captureInvite(options);
    this.globalData.userInfo = store.getUser();
    if (store.isLogin()) {
      store.syncMe().then((user) => {
        this.globalData.userInfo = user;
      });
    }
  },

  onShow(options) {
    store.captureInvite(options);
  },
});
