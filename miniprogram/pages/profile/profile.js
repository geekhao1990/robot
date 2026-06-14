const api = require('../../utils/api');
const store = require('../../utils/store');
const mock = require('../../mock/data');
const { formatCount, refreshTabBar } = require('../../utils/util');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    user: null,
    likeCollectCount: '0',
    followCount: 0,
    fansCount: 0,
    tabs: ['笔记', '收藏', '赞过'],
    tabIndex: 0,
    currentNotes: [],
    left: [],
    right: [],
    emptyText: '还没有内容～',
  },

  onLoad() {
    const app = getApp();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
    });
  },

  onShow() {
    refreshTabBar(this, 3);
    const user = store.getUser();
    if (user) {
      const s = this.computeStats();
      this.setData({
        user,
        likeCollectCount: formatCount(s.likes + s.collects),
        followCount: store.followedIds().length,
        fansCount: mock.users.length,
      });
    } else {
      this.setData({ user, likeCollectCount: '0', followCount: 0, fansCount: 0 });
    }
    this.loadTab(this.data.tabIndex);
  },

  // 统计我的发布笔记数 / 获得点赞数 / 获得收藏数
  computeStats() {
    const notes = store.getMyNotes();
    let likes = 0, collects = 0;
    notes.forEach((n) => {
      likes += n.likes || 0;
      collects += n.collects || 0;
    });
    return { noteCount: notes.length, likes, collects };
  },

  goRelations(e) {
    const type = e.currentTarget.dataset.type;
    wx.navigateTo({ url: `/pages/relations/relations?type=${type}` });
  },

  showStats() {
    const s = this.computeStats();
    wx.showModal({
      title: '我的数据',
      content: `发布笔记：${s.noteCount}\n获得点赞：${s.likes}\n获得收藏：${s.collects}`,
      showCancel: false,
      confirmText: '知道了',
    });
  },

  onPullDownRefresh() {
    this.onShow();
    wx.stopPullDownRefresh();
  },

  onTab(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ tabIndex: index });
    this.loadTab(index);
  },

  loadTab(index) {
    const user = store.getUser();
    let promise;
    let emptyText;
    if (index === 0) {
      // 我的笔记：已发布 + 该用户作为作者的 mock 笔记
      const mine = store.getMyNotes();
      if (user) {
        promise = api.getNotesByAuthor(user.id).then((authored) => {
          const ids = new Set(mine.map((n) => n.id));
          return mine.concat(authored.filter((n) => !ids.has(n.id)));
        });
      } else {
        promise = Promise.resolve(mine);
      }
      emptyText = user ? '还没有发布笔记，去发布第一篇吧~' : '登录后查看你的笔记';
    } else if (index === 1) {
      promise = api.getNotesByIds(store.collectedIds());
      emptyText = '还没有收藏的笔记';
    } else {
      promise = api.getNotesByIds(store.likedIds());
      emptyText = '还没有赞过的笔记';
    }

    promise.then((notes) => {
      const left = [], right = [];
      let lh = 0, rh = 0;
      notes.forEach((n) => {
        const h = n.coverRatio || 1.3;
        if (lh <= rh) { left.push(n); lh += h; }
        else { right.push(n); rh += h; }
      });
      this.setData({ currentNotes: notes, left, right, emptyText });
    });
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  onLogout() {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          store.logout();
          this.setData({ user: null });
          this.loadTab(this.data.tabIndex);
        }
      },
    });
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.detail.id}` });
  },
});
