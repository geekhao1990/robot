const api = require('../utils/api');

const GOLD_FINGER_ICON = 'https://app.nankaitechschool.com/uploads/up_1787930384458_5f0008fd90bf8d07.png';

function makeList(settings = {}) {
  const middle = settings.goldFingerEntryEnabled
    ? { action: 'goldNote', text: '金手指', finger: true, icon: GOLD_FINGER_ICON, noteId: settings.featuredNoteId }
    : { spacer: true, text: '空白' };
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
  },

  pageLifetimes: {
    show() { this.syncRole(); },
  },

  methods: {
    syncRole() {
      const sequence = (this._syncSequence || 0) + 1;
      this._syncSequence = sequence;
      this.setData({ list: makeList() });
      api.getAppSettings().then((settings) => {
        if (sequence !== this._syncSequence) return;
        this.setData({ list: makeList(settings) });
      });
    },

    switchTab(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      if (!item || item.spacer) return;
      if (item.action === 'goldNote') {
        if (!item.noteId) return wx.showToast({ title: '金手指笔记暂未配置', icon: 'none' });
        return wx.navigateTo({ url: '/pages/detail/detail?id=' + encodeURIComponent(item.noteId) });
      }
      const url = item.pagePath;
      this.setData({ selected: index });
      wx.switchTab({ url });
    },
  },
});
