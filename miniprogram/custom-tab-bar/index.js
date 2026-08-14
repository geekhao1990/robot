Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/index/index', text: '首页' },
      { pagePath: '/pages/agent/agent', text: '联系客服' },
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
  },
});
