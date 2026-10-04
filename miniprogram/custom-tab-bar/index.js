const api = require('../utils/api');
const { openGoldEntry } = require('../utils/gold-entry');

const GOLD_FINGER_ICON = '/images/gold-tab-default.png';
const GOLD_FINGER_ACTIVE_ICON = '/images/gold-tab.png';

function makeList(settings = {}) {
  const noteId = String(settings.featuredNoteId || '').trim();
  const middle = noteId ? {
    action: 'goldNote',
    text: '金手指',
    finger: true,
    icon: GOLD_FINGER_ICON,
    activeIcon: GOLD_FINGER_ACTIVE_ICON,
    noteId,
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
        const pages = getCurrentPages();
        const page = pages[pages.length - 1];
        const isGoldNote = !!(page && page.route === 'pages/detail/detail' && page.options && String(page.options.id || '') === settings.featuredNoteId);
        this.setData({ list: makeList(settings), selected: isGoldNote ? 1 : this.data.selected });
    },

    switchTab(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      if (!item || item.spacer) return;
      if (item.action === 'goldNote') {
        return openGoldEntry({
          source: 'goldTab',
          beforeNavigate: () => this.setData({ selected: 1 }),
          onNavigateFail: () => this.setData({ selected: 0 }),
        });
      }
      const url = item.pagePath;
      this.setData({ selected: index });
      wx.switchTab({ url });
    },
  },
});
