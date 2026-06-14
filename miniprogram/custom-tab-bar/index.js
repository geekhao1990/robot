const store = require('../utils/store');

Component({
  data: {
    selected: 0,
    badge: 0,
    list: [
      { pagePath: '/pages/index/index', text: '首页' },
      { pagePath: '/pages/publish/publish', text: '发布' },
      { pagePath: '/pages/message/message', text: '消息' },
      { pagePath: '/pages/profile/profile', text: '我' },
    ],
  },

  methods: {
    switchTab(e) {
      const index = e.currentTarget.dataset.index;
      const url = this.data.list[index].pagePath;
      this.setData({ selected: index });
      wx.switchTab({ url });
    },

    // 由各 tab 页 onShow 调用，刷新消息未读角标
    refreshBadge() {
      this.setData({ badge: store.messageUnread().total });
    },
  },
});
