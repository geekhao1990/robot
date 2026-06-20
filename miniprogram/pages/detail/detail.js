const api = require('../../utils/api');
const store = require('../../utils/store');
const config = require('../../utils/config');
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
    commentTotal: 0,
    // 评论输入
    showInput: false,
    commentDraft: '',
    inputPlaceholder: '说点什么...',
    replyTarget: null, // { cid, name } 回复目标
    // 转发
    showShare: false,
    showFriends: false,
    friends: [],
    // 课程
    isCourse: false,
    myId: '',
    isMine: false,
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
        replies: (c.replies || []).map((r) => ({ ...r, timeText: fromNow(r.time) })),
      }));
      const me = store.getUser();
      this.setData({
        note: { ...note, commentList },
        swiperHeight,
        followed: store.isFollowed(note.authorId),
        likeText: formatCount(note.likes),
        collectText: formatCount(note.collects),
        commentText: formatCount(note.comments),
        commentTotal: note.comments,
        timeText: fromNow(note.time),
        isCourse: note.type === 'course',
        myId: me ? me.id : '',
        isMine: !!(me && note.authorId === me.id),
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

  // ---------- 评论 ----------
  onComment() {
    if (!store.isLogin()) return this.requireLogin();
    this.setData({
      showInput: true,
      replyTarget: null,
      commentDraft: '',
      inputPlaceholder: '说点什么...',
    });
  },

  onReply(e) {
    if (!store.isLogin()) return this.requireLogin();
    const { cid, name } = e.currentTarget.dataset;
    this.setData({
      showInput: true,
      replyTarget: { cid, name },
      commentDraft: '',
      inputPlaceholder: `回复 @${name}`,
    });
  },

  onDraft(e) {
    this.setData({ commentDraft: e.detail.value });
  },

  closeInput() {
    this.setData({ showInput: false, commentDraft: '' });
  },

  sendComment() {
    const text = this.data.commentDraft.trim();
    if (!text) return;
    const user = store.getUser();
    const me = { id: user.id, name: user.name, avatar: user.avatar };
    const now = Date.now();
    const commentList = this.data.note.commentList.slice();
    const target = this.data.replyTarget;

    if (target) {
      // 二级评论：追加到对应一级评论的 replies
      const idx = commentList.findIndex((c) => c.id === target.cid);
      if (idx > -1) {
        const c = commentList[idx];
        const replies = (c.replies || []).concat({
          id: `r${now}`,
          user: me,
          to: target.name,
          text,
          likes: 0,
          liked: false,
          time: now,
          timeText: '刚刚',
        });
        commentList[idx] = { ...c, replies };
      }
    } else {
      // 一级评论
      commentList.unshift({
        id: `c${now}`,
        user: me,
        text,
        likes: 0,
        liked: false,
        time: now,
        timeText: '刚刚',
        replies: [],
      });
    }

    const total = this.data.commentTotal + 1;
    this.setData({
      'note.commentList': commentList,
      commentTotal: total,
      commentText: formatCount(total),
      showInput: false,
      commentDraft: '',
      replyTarget: null,
    });
    toast('评论成功');
  },

  onCommentLike(e) {
    const { cid, rid } = e.currentTarget.dataset;
    const commentList = this.data.note.commentList.slice();
    const idx = commentList.findIndex((c) => c.id === cid);
    if (idx < 0) return;
    const c = { ...commentList[idx] };

    if (rid) {
      const replies = (c.replies || []).map((r) => {
        if (r.id !== rid) return r;
        const liked = !r.liked;
        return { ...r, liked, likes: r.likes + (liked ? 1 : -1) };
      });
      c.replies = replies;
    } else {
      const liked = !c.liked;
      c.liked = liked;
      c.likes = c.likes + (liked ? 1 : -1);
    }
    commentList[idx] = c;
    this.setData({ 'note.commentList': commentList });
  },

  // 删除自己的评论 / 回复（二次确认）
  onDeleteComment(e) {
    const { cid, rid } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除评论',
      content: '确定要删除这条评论吗？',
      confirmText: '删除',
      confirmColor: '#ff2442',
      success: (res) => {
        if (!res.confirm) return;
        let commentList = this.data.note.commentList.slice();
        if (rid) {
          const idx = commentList.findIndex((c) => c.id === cid);
          if (idx > -1) {
            const c = { ...commentList[idx] };
            c.replies = (c.replies || []).filter((r) => r.id !== rid);
            commentList[idx] = c;
          }
        } else {
          commentList = commentList.filter((c) => c.id !== cid);
        }
        const total = Math.max(0, this.data.commentTotal - 1);
        this.setData({
          'note.commentList': commentList,
          commentTotal: total,
          commentText: formatCount(total),
        });
        toast('已删除');
      },
    });
  },

  // ---------- 获取课程（激励广告 / VIP 跳过） ----------
  onGetCourse() {
    const user = store.getUser();
    if (!user) return this.requireLogin();
    const vipValid = user.vip && (!user.vipExpire || user.vipExpire > Date.now());
    if (vipValid) return this.showCourse(); // VIP 跳过广告
    this.playRewardAd();
  },

  showCourse() {
    const url = this.data.note.courseUrl || '（发布者暂未填写资料地址）';
    wx.showModal({
      title: '课程资料',
      content: url,
      confirmText: '复制链接',
      cancelText: '关闭',
      success: (res) => {
        if (res.confirm && this.data.note.courseUrl) {
          wx.setClipboardData({ data: this.data.note.courseUrl });
        }
      },
    });
  },

  playRewardAd() {
    if (!wx.createRewardedVideoAd) return this.simulateAd();
    if (!this.rewardAd) {
      this.rewardAd = wx.createRewardedVideoAd({ adUnitId: 'adunit-course-demo' });
      this.rewardAd.onClose((res) => {
        if (res && res.isEnded) this.showCourse();
        else toast('看完广告才能获取课程哦~');
      });
      this.rewardAd.onError(() => {
        this._adFailed = true;
      });
    }
    this.rewardAd
      .show()
      .catch(() =>
        this.rewardAd
          .load()
          .then(() => this.rewardAd.show())
          .catch(() => this.simulateAd())
      );
  },

  // 开发环境/未配置广告位时的演示降级
  simulateAd() {
    wx.showModal({
      title: '激励广告（演示）',
      content: '真机需在微信后台开通流量主并配置广告位 adUnitId。此处模拟「广告观看完成」。',
      confirmText: '已看完',
      showCancel: false,
      success: () => this.showCourse(),
    });
  },

  // ---------- 转发 ----------
  openShare() {
    this.setData({ showShare: true });
  },
  closeShare() {
    this.setData({ showShare: false });
  },
  noop() {},

  // 微信好友：拉起好友列表（mock 数据模拟）
  openFriends() {
    api.getFriends().then((friends) => {
      this.setData({ showShare: false, showFriends: true, friends });
    });
  },
  closeFriends() {
    this.setData({ showFriends: false });
  },
  backToShare() {
    this.setData({ showFriends: false, showShare: true });
  },
  shareToFriend(e) {
    const name = e.currentTarget.dataset.name;
    const n = this.data.note;
    wx.showModal({
      title: '分享给好友',
      content: `将《${n.title}》分享给「${name}」？`,
      confirmText: '发送',
      success: (res) => {
        if (res.confirm) {
          this.setData({ showFriends: false });
          wx.showToast({ title: `已分享给${name}`, icon: 'success' });
        }
      },
    });
  },

  shareToOfficial() {
    const n = this.data.note;
    wx.setClipboardData({
      data: `${n.title} —— 来自小红书：/pages/detail/detail?id=${n.id}`,
      success: () => {
        wx.showModal({
          title: '分享到公众号',
          content: '内容链接已复制，可粘贴到微信公众号编辑器中发布。',
          showCancel: false,
          confirmText: '知道了',
        });
      },
    });
    this.setData({ showShare: false });
  },

  // 保留：从系统右上角菜单转发给好友/群
  onShareAppMessage() {
    const n = this.data.note;
    return {
      title: n.title,
      path: `/pages/detail/detail?id=${n.id}`,
      imageUrl: n.cover,
    };
  },

  // 编辑自己的笔记 -> 跳发布页载入
  onEditNote() {
    getApp().globalData.editNoteId = this.data.note.id;
    wx.switchTab({ url: '/pages/publish/publish' });
  },

  // 删除自己的笔记（二次确认）
  onDeleteOwnNote() {
    wx.showModal({
      title: '删除笔记',
      content: '确定删除这篇笔记吗？删除后不可恢复。',
      confirmText: '删除',
      confirmColor: '#ff2442',
      success: (res) => {
        if (!res.confirm) return;
        const done = () => {
          wx.showToast({ title: '已删除', icon: 'success' });
          setTimeout(() => {
            wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
          }, 600);
        };
        if (config.useRemote) {
          api.deleteNote(this.data.note.id).then(done).catch(() => toast('删除失败，请重试'));
        } else {
          store.removeMyNote(this.data.note.id);
          done();
        }
      },
    });
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
