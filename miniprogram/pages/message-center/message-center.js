const api = require('../../utils/api');
const store = require('../../utils/store');

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
  },

  onLoad() {
    if (!store.isLogin()) return wx.redirectTo({ url: '/pages/login/login' });
    this.load();
  },

  load() {
    this.setData({ loading: true });
    return api.getSystemNotifications()
      .then((result) => {
        const list = ((result && result.list) || []).map((item) => ({
          ...item,
          unread: !Number(item.readAt),
          iconText: ICON_TEXT[item.type] || '信',
          timeText: formatTime(item.createdAt),
        }));
        this.setData({ list, unread: Number(result && result.unread) || 0 });
      })
      .catch(() => wx.showToast({ title: '消息加载失败', icon: 'none' }))
      .finally(() => this.setData({ loading: false }));
  },

  markAllRead() {
    if (!this.data.unread) return;
    api.readSystemNotification().then(() => {
      this.setData({
        unread: 0,
        list: this.data.list.map((item) => ({ ...item, unread: false })),
      });
    }).catch(() => wx.showToast({ title: '操作失败', icon: 'none' }));
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
        wx.navigateTo({ url: '/pages/gold-finger/gold-finger' });
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
