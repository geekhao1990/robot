const api = require('../../utils/api');
const store = require('../../utils/store');
const { fromNow, refreshTabBar } = require('../../utils/util');

Page({
  data: {
    user: null,
    conversations: [],
    likeCount: 0,
    followCount: 0,
    commentCount: 0,
  },

  onShow() {
    refreshTabBar(this, 3);
    const user = store.getUser();
    this.setData({ user });
    if (!user) return;
    this.loadData();
  },

  onPullDownRefresh() {
    refreshTabBar(this, 3);
    if (store.getUser()) this.loadData();
    wx.stopPullDownRefresh();
  },

  loadData() {
    const applyCounts = () => {
      const u = store.messageUnread();
      this.setData({ likeCount: u.like, followCount: u.follow, commentCount: u.comment });
    };
    applyCounts();
    store.refreshMessageSummary().then(applyCounts);

    api.getConversations().then((list) => {
      this.setData({
        conversations: (list || []).map((c) => ({
          ...c,
          unread: store.isConvRead(c.id) ? 0 : c.unread,
          timeText: fromNow(Date.now() - c.time * 3600 * 1000),
        })),
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
