const api = require('../utils/api');
const config = require('../utils/config');
const FEATURED_CACHE_KEY = 'xhs_featured_note_id';

function cachedFeaturedNoteId() {
  try {
    return wx.getStorageSync(FEATURED_CACHE_KEY) || config.featuredNoteId || 'n3';
  } catch (e) {
    return config.featuredNoteId || 'n3';
  }
}

Component({
  data: {
    selected: 0,
    featuredNoteId: cachedFeaturedNoteId(),
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
        const featuredNoteId = typeof settings.featuredNoteId === 'string'
          ? settings.featuredNoteId
          : this.data.featuredNoteId;
        this.setData({ featuredNoteId });
        try {
          if (featuredNoteId) wx.setStorageSync(FEATURED_CACHE_KEY, featuredNoteId);
          else wx.removeStorageSync(FEATURED_CACHE_KEY);
        } catch (e) {}
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
        const id = this.data.featuredNoteId;
        if (!id) return wx.showToast({ title: '暂未配置金手指内容', icon: 'none' });
        return wx.navigateTo({ url: `/pages/detail/detail?id=${encodeURIComponent(id)}` });
      }
      const url = item.pagePath;
      this.setData({ selected: index });
      wx.switchTab({ url });
    },
  },
});
