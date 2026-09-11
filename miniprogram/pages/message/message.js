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
    refreshing: false,
    refreshReady: false,
  },

  onShow() {
    refreshTabBar(this, 3);
    const user = store.getUser();
    this.setData({ user });
    if (!user) return;
    this.loadData();
  },

  onRefresherPulling(e) {
    if (this.data.refreshing) return;
    const refreshReady = Number(e.detail && e.detail.dy) >= 64;
    if (refreshReady !== this.data.refreshReady) this.setData({ refreshReady });
  },

  onRefresherRefresh() {
    if (this.data.refreshing) return;
    this.setData({ refreshing: true, refreshReady: false });
    refreshTabBar(this, 3);
    const request = store.getUser() ? this.loadData() : Promise.resolve();
    Promise.resolve(request).finally(() => this.finishRefresh());
  },

  onRefresherRestore() {
    if (this.data.refreshReady) this.setData({ refreshReady: false });
  },

  onRefresherAbort() {
    if (this.data.refreshReady) this.setData({ refreshReady: false });
  },

  finishRefresh() {
    if (this.data.refreshing || this.data.refreshReady) this.setData({ refreshing: false, refreshReady: false });
  },

  loadData() {
    const applyCounts = () => {
      const u = store.messageUnread();
      this.setData({ likeCount: u.like, followCount: u.follow, commentCount: u.comment });
    };
    applyCounts();
    const summaryRequest = store.refreshMessageSummary().then(applyCounts);

    const conversationsRequest = api.getConversations().then((list) => {
      this.setData({
        conversations: (list || []).map((c) => ({
          ...c,
          unread: store.isConvRead(c.id) ? 0 : c.unread,
          timeText: fromNow(Date.now() - c.time * 3600 * 1000),
        })),
      });
    });
    return Promise.allSettled([summaryRequest, conversationsRequest]);
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
