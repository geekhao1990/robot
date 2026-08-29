Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/index/index', text: '首页' },
      { pagePath: '/pages/agent/agent', text: 'AI 助手', ai: true },
      { pagePath: '/pages/profile/profile', text: '我' },
    ],
  },

  methods: {
    switchTab(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      const url = item.pagePath;
      this.setData({ selected: index });
      wx.switchTab({ url });
    },
  },
});
