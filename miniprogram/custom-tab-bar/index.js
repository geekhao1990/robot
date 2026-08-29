const store = require('../utils/store');

function makeList(isOfficial) {
  return [
    { pagePath: '/pages/index/index', text: '首页' },
    isOfficial
      ? { action: 'goldFingerManage', text: '金手指管理', plus: true }
      : { pagePath: '/pages/agent/agent', text: 'AI 助手', ai: true },
    { pagePath: '/pages/profile/profile', text: '我' },
  ];
}

Component({
  data: { selected: 0, list: makeList(false) },

  lifetimes: {
    attached() { this.syncRole(); },
  },

  pageLifetimes: {
    show() { this.syncRole(); },
  },

  methods: {
    syncRole() {
      const user = store.getUser();
      this.setData({ list: makeList(!!(user && user.official)) });
    },

    switchTab(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      if (item.action === 'goldFingerManage') {
        if (!store.isLogin()) return wx.navigateTo({ url: '/pages/login/login' });
        if (!(store.getUser() || {}).official) {
          this.syncRole();
          return wx.showToast({ title: '请使用官方账号登录', icon: 'none' });
        }
        return wx.navigateTo({ url: '/pages/gold-finger-manage/gold-finger-manage' });
      }
      const url = item.pagePath;
      this.setData({ selected: index });
      wx.switchTab({ url });
    },
  },
});
