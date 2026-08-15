const api = require('../utils/api');
const config = require('../utils/config');

Component({
  data: {
    selected: 0,
    featuredNoteId: config.featuredNoteId || 'n13',
    list: [
      { pagePath: '/pages/index/index', text: '首页' },
      { action: 'featured', text: '', plus: true },
      { pagePath: '/pages/profile/profile', text: '我' },
    ],
  },

  lifetimes: {
    attached() {
      this.loadSettings();
    },
  },

  methods: {
    loadSettings() {
      if (this._settingsPromise) return this._settingsPromise;
      this._settingsPromise = api.getAppSettings().then((settings) => {
        this.setData({ featuredNoteId: settings.featuredNoteId || this.data.featuredNoteId });
        this._settingsPromise = null;
        return settings;
      }).catch(() => {
        this._settingsPromise = null;
        return { featuredNoteId: this.data.featuredNoteId };
      });
      return this._settingsPromise;
    },
    switchTab(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      if (item.action === 'featured') {
        wx.showLoading({ title: '加载中' });
        return this.loadSettings().then(() => {
          wx.hideLoading();
          const id = this.data.featuredNoteId;
          if (!id) return wx.showToast({ title: '暂未配置入口笔记', icon: 'none' });
          wx.navigateTo({ url: `/pages/detail/detail?id=${encodeURIComponent(id)}` });
        });
      }
      const url = item.pagePath;
      this.setData({ selected: index });
      wx.switchTab({ url });
    },
  },
});
