const api = require('../../utils/api');
const store = require('../../utils/store');
const { formatCount, fromNow, toast } = require('../../utils/util');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    headerHeight: 64,
    note: null,
    current: 0,
    swiperHeight: 1000,
    followed: false,
    likeText: '0',
    collectText: '0',
    commentText: '0',
    timeText: '',
  },

  onLoad(options) {
    const app = getApp();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      headerHeight: app.globalData.statusBarHeight + app.globalData.navBarHeight,
    });
    this.noteId = options.id;
    this.loadNote();
  },

  loadNote() {
    api.getNoteById(this.noteId).then((note) => {
      if (!note) {
        toast('笔记不存在');
        return;
      }
      const ratio = note.coverRatio || 1.3;
      // swiper 高度 = 屏宽(750rpx) * 比例
      const swiperHeight = Math.min(750 * ratio, 1000);
      const commentList = (note.commentList || []).map((c) => ({
        ...c,
        timeText: fromNow(c.time),
      }));
      this.setData({
        note: { ...note, commentList },
        swiperHeight,
        followed: store.isFollowed(note.authorId),
        likeText: formatCount(note.likes),
        collectText: formatCount(note.collects),
        commentText: formatCount(note.comments),
        timeText: fromNow(note.time),
      });
    });
  },

  onSwiperChange(e) {
    this.setData({ current: e.detail.current });
  },

  previewImage(e) {
    wx.previewImage({
      current: e.currentTarget.dataset.url,
      urls: this.data.note.images,
    });
  },

  onLike() {
    const note = this.data.note;
    const liked = store.toggleLike(note.id);
    const likes = note.likes + (liked ? 1 : -1);
    this.setData({
      'note.liked': liked,
      'note.likes': likes,
      likeText: formatCount(likes),
    });
  },

  onCollect() {
    const note = this.data.note;
    const collected = store.toggleCollect(note.id);
    const collects = note.collects + (collected ? 1 : -1);
    this.setData({
      'note.collected': collected,
      'note.collects': collects,
      collectText: formatCount(collects),
    });
    toast(collected ? '已收藏' : '已取消收藏');
  },

  onFollow() {
    if (!store.isLogin()) {
      return this.requireLogin();
    }
    const followed = store.toggleFollow(this.data.note.authorId);
    this.setData({ followed });
  },

  onComment() {
    if (!store.isLogin()) {
      return this.requireLogin();
    }
    toast('评论功能演示中～');
  },

  goUser() {
    wx.navigateTo({ url: `/pages/user/user?id=${this.data.note.authorId}` });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },

  requireLogin() {
    wx.showModal({
      title: '提示',
      content: '登录后才能操作哦',
      confirmText: '去登录',
      success: (res) => {
        if (res.confirm) wx.navigateTo({ url: '/pages/login/login' });
      },
    });
  },
});
