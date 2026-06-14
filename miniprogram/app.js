// app.js
const store = require('./utils/store');

App({
  globalData: {
    userInfo: null,
    statusBarHeight: 20,
    navBarHeight: 44,
  },

  onLaunch() {
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

    // 初始化本地数据（用户交互状态等）
    store.init();
    this.globalData.userInfo = store.getUser();
  },
});
