const api = require('../../utils/api');
const store = require('../../utils/store');
const config = require('../../utils/config');

function formatTime(timestamp) {
  const value = Number(timestamp) || 0;
  if (!value) return '';
  const diff = Math.max(0, Date.now() - value);
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const ICON_TEXT = {
  followed_note: '文',
  dark_recharge: '充',
  dark_ready: '暗',
  gold_changed: '金',
};

Page({
  data: {
    loading: true,
    list: [],
    unread: 0,
    page: 1,
    totalPages: 1,
    total: 0,
    messageCenterAdUnitId: /^adunit-/i.test(String(config.messageCenterAdUnitId || '')) ? String(config.messageCenterAdUnitId) : '',
    messageCenterBottomAdUnitId: /^adunit-/i.test(String(config.messageCenterBottomAdUnitId || '')) ? String(config.messageCenterBottomAdUnitId) : '',
    messageCenterAdLoadFailed: false,
    messageCenterBottomAdLoadFailed: false,
  },

  onLoad() {
    if (!store.isLogin()) return wx.redirectTo({ url: '/pages/login/login' });
    api.getAppSettings().then((settings) => {
      const id = String((settings && settings.messageCenterAdUnitId) || config.messageCenterAdUnitId || '');
      const bottomId = String((settings && settings.messageCenterBottomAdUnitId) || config.messageCenterBottomAdUnitId || '');
      this.setData({
        messageCenterAdUnitId: /^adunit-/i.test(id) ? id : '',
        messageCenterBottomAdUnitId: /^adunit-/i.test(bottomId) ? bottomId : '',
        messageCenterAdLoadFailed: false,
        messageCenterBottomAdLoadFailed: false,
      });
    });
    this.load();
  },
  onMessageCenterAdError() { this.setData({ messageCenterAdLoadFailed: true }); },
  onMessageCenterBottomAdError() { this.setData({ messageCenterBottomAdLoadFailed: true }); },

  load(page = 1) {
    if (this.data.loading && this._loadedOnce) return Promise.resolve();
    this.setData({ loading: true });
    return api.getSystemNotifications(page)
      .then((result) => {
        const list = ((result && result.list) || []).map((item) => ({
          ...item,
          unread: !Number(item.readAt),
          iconText: ICON_TEXT[item.type] || '信',
          timeText: formatTime(item.createdAt),
        }));
        this._loadedOnce = true;
        this.setData({
          list,
          unread: Number(result && result.unread) || 0,
          page: Number(result && result.page) || 1,
          totalPages: Number(result && result.totalPages) || 1,
          total: Number(result && result.total) || 0,
        });
      })
      .catch(() => wx.showToast({ title: '消息加载失败', icon: 'none' }))
      .finally(() => this.setData({ loading: false }));
  },

  changePage(e) {
    const page = Number(e.currentTarget.dataset.page);
    if (!Number.isInteger(page) || page < 1 || page > this.data.totalPages || page === this.data.page) return;
    this.load(page);
  },

  openGoldNote(item) {
    const open = (settings) => {
      const noteId = String((item && item.targetId) || (settings && settings.featuredNoteId) || '').trim();
      if (!noteId) {
        wx.showToast({ title: '金手指笔记暂未配置', icon: 'none' });
        return;
      }
      wx.navigateTo({
        url: `/pages/detail/detail?id=${encodeURIComponent(noteId)}&from=goldNotification`,
        fail: () => wx.showToast({ title: '页面打开失败，请重试', icon: 'none' }),
      });
    };
    return api.getAppSettings()
      .then((settings) => {
        if (!settings || settings.goldAccess !== true) {
          wx.showToast({ title: '金手指权益尚未开通', icon: 'none' });
          return;
        }
        open(settings);
      })
      .catch(() => wx.showToast({ title: '金手指笔记暂时无法打开', icon: 'none' }));
  },

  openMessage(e) {
    const item = this.data.list.find((entry) => entry.id === e.currentTarget.dataset.id);
    if (!item) return;
    const navigate = () => {
      if (item.targetType === 'note' && item.targetId) {
        wx.navigateTo({ url: `/pages/detail/detail?id=${encodeURIComponent(item.targetId)}` });
      } else if (item.targetType === 'dark_home') {
        wx.navigateTo({ url: '/pages/dark-funds/dark-funds' });
      } else if (item.targetType === 'dark_history') {
        wx.navigateTo({ url: '/pages/dark-funds/dark-funds?tab=history' });
      } else if (item.targetType === 'gold') {
        // 金手指通知必须先进入入口笔记，再由笔记里的“点击领取”执行权益和广告校验。
        this.openGoldNote(item);
      }
    };
    if (!item.unread) return navigate();
    api.readSystemNotification(item.id).then((result) => {
      this.setData({
        unread: Number(result && result.unread) || 0,
        list: this.data.list.map((entry) => entry.id === item.id ? { ...entry, unread: false } : entry),
      });
      navigate();
    }).catch(navigate);
  },
});
