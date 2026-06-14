// app.js
const store = require('./utils/store');

App({
  globalData: {
    userInfo: null,
    statusBarHeight: 20,
    navBarHeight: 44,
    cloudEnabled: false,
    editNoteId: null, // 从详情页「编辑」进入发布页时携带
    openDraft: false, // 从「我-草稿箱」进入发布页时为 true
  },

  onLaunch() {
    // 初始化云开发（用于 AI 客服知识库云函数）。
    // 需先在开发者工具开通「云开发」；未开通时静默跳过，AI 助手走本地降级回复。
    if (wx.cloud) {
      try {
        wx.cloud.init({ env: wx.cloud.DYNAMIC_CURRENT_ENV, traceUser: true });
        this.globalData.cloudEnabled = true;
      } catch (e) {
        this.globalData.cloudEnabled = false;
      }
    }

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
