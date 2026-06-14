const api = require('../../utils/api');
const store = require('../../utils/store');
const { fromNow, updateMessageBadge } = require('../../utils/util');

Page({
  data: {
    user: null,
    conversations: [],
    likeCount: 0,
    followCount: 0,
    commentCount: 0,
  },

  onShow() {
    updateMessageBadge();
    const user = store.getUser();
    this.setData({ user });
    if (!user) return;
    this.loadData();
  },

  onPullDownRefresh() {
    updateMessageBadge();
    if (store.getUser()) this.loadData();
    wx.stopPullDownRefresh();
  },

  loadData() {
    api.getNotifications('all').then((list) => {
      this.setData({
        likeCount: list.filter((n) => n.type === 'like' || n.type === 'collect').length,
        followCount: list.filter((n) => n.type === 'follow').length,
        commentCount: list.filter((n) => n.type === 'comment').length,
      });
    });

    api.getConversations().then((list) => {
      this.setData({
        conversations: list.map((c) => ({ ...c, timeText: fromNow(Date.now() - c.time * 3600 * 1000) })),
      });
    });
  },

  goNotify(e) {
    wx.navigateTo({ url: `/pages/notify/notify?type=${e.currentTarget.dataset.type}` });
  },

  goChat(e) {
    wx.navigateTo({ url: `/pages/chat/chat?id=${e.currentTarget.dataset.id}` });
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },
});
