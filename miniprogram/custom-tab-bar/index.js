const api = require('../utils/api');
const { openGoldEntry } = require('../utils/gold-entry');

function makeList(settings = {}) {
  const middle = settings.goldFingerEntryEnabled !== false ? {
    action: 'quickEntry',
    text: '功能入口',
    plus: true,
  } : { text: '金手指占位', spacer: true };
  return [
    { pagePath: '/pages/index/index', text: '首页' },
    middle,
    { pagePath: '/pages/profile/profile', text: '我' },
  ];
}

Component({
  data: { selected: 0, list: makeList() },

  lifetimes: {
    attached() { this.syncRole(); },
    detached() {
      if (this._settingsRetryTimer) clearTimeout(this._settingsRetryTimer);
    },
  },

  pageLifetimes: {
    show() { this.syncRole(); },
  },

  methods: {
    syncRole() {
      const sequence = (this._syncSequence || 0) + 1;
      this._syncSequence = sequence;
      if (this._settingsRetryTimer) clearTimeout(this._settingsRetryTimer);
      this.applySettings(api.getCachedAppSettings());
      this.refreshSettings(sequence, 0);
    },

    refreshSettings(sequence, attempt) {
      api.getAppSettings().then((settings) => {
        if (sequence !== this._syncSequence) return;
        this.applySettings(settings);
        if (settings._remoteFailed && attempt < 2) {
          this._settingsRetryTimer = setTimeout(() => this.refreshSettings(sequence, attempt + 1), 600 * (attempt + 1));
        }
      });
    },

    applySettings(settings) {
        this.setData({ list: makeList(settings) });
    },

    openQuickEntry() {
      wx.showActionSheet({
        itemList: ['查看暗盘', '查看金手指'],
        success: ({ tapIndex }) => {
          if (tapIndex === 0) {
            wx.navigateTo({
              url: '/pages/dark-funds/dark-funds',
              fail: () => wx.showToast({ title: '页面打开失败，请重试', icon: 'none' }),
            });
            return;
          }
          if (tapIndex === 1) openGoldEntry({ source: 'quickTab' });
        },
      });
    },

    switchTab(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      if (!item || item.spacer) return;
      if (item.action === 'quickEntry') return this.openQuickEntry();
      const url = item.pagePath;
      this.setData({ selected: index });
      wx.switchTab({ url });
    },
  },
});
