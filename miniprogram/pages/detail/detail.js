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
    likeText: '0',
    collectText: '0',
    timeText: '',
    resourceLabel: '点击领取',
    followed: false,
    rewardedAdEnabled: config.rewardedAdEnabled === true,
  },

  onLoad(options) {
    const app = getApp();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      headerHeight: app.globalData.statusBarHeight + app.globalData.navBarHeight,
    });
    this.noteId = options.id;
    this.loadSettings();
    this.loadNote();
  },

  onShow() {
    if (this.noteId && !this.data.note && store.isLogin()) {
      this._loginRedirected = false;
      this.loadNote();
    }
  },

  loadSettings() {
    this.settingsPromise = api.getAppSettings().then((settings) => {
      this.setData({
        rewardedAdEnabled: settings.rewardedAdEnabled === true,
      });
      return settings;
    });
    return this.settingsPromise;
  },

  loadNote() {
    if (!store.isLogin()) return this.requireLogin();
    if (this._loadingNote) return;
    this._loadingNote = true;
    api.getNoteById(this.noteId).then((note) => {
      this._loadingNote = false;
      if (!note) return toast('笔记不存在');
      this.setData({
        note,
        swiperHeight: Math.min(750 * (note.coverRatio || 1.3), 1000),
        likeText: formatCount(note.likes),
        collectText: formatCount(note.collects),
        timeText: fromNow(note.time),
        followed: store.isFollowed(note.authorId || note.author.id),
      });
    }).catch((err) => {
      this._loadingNote = false;
      const code = err && err.statusCode;
      wx.showModal({
        title: code === 401 ? '请先登录' : '加载失败',
        content: code === 401 ? '登录后才能查看内容。' : '内容暂时无法加载，请稍后重试。',
        showCancel: false,
        success: () => { if (code === 401) this.requireLogin(); },
      });
    });
  },

  onSwiperChange(e) { this.setData({ current: e.detail.current }); },
  previewImage(e) {
    wx.previewImage({ current: e.currentTarget.dataset.url, urls: this.data.note.images });
  },
  onLike() {
    const note = this.data.note;
    const liked = store.toggleLike(note.id);
    const likes = note.likes + (liked ? 1 : -1);
    this.setData({ 'note.liked': liked, 'note.likes': likes, likeText: formatCount(likes) });
  },
  onCollect() {
    const note = this.data.note;
    const collected = store.toggleCollect(note.id);
    const collects = note.collects + (collected ? 1 : -1);
    this.setData({ 'note.collected': collected, 'note.collects': collects, collectText: formatCount(collects) });
    toast(collected ? '已收藏' : '已取消收藏');
  },
  onFollow() {
    const note = this.data.note;
    const authorId = note.authorId || note.author.id;
    const followed = store.toggleFollow(authorId);
    this.setData({ followed });
    toast(followed ? '已关注' : '已取消关注');
  },
  onGetResource() {
    if (this.data.note && this.data.note.type === 'gold') return this.showEnterpriseWechat();
    return Promise.resolve(this.settingsPromise).then(() => this.handleGetResource());
  },
  handleGetResource() {
    const note = this.data.note;
    if (!note.hasResource) return toast('管理员尚未配置获取地址');
    if (!this.data.rewardedAdEnabled) return this.showResource();
    const adUnitId = config.rewardedVideoAdUnitId;
    if (!adUnitId || /x{4,}/i.test(adUnitId)) {
      return wx.showModal({
        title: '暂时无法领取',
        content: '领取服务暂未配置完成，请稍后再试。',
        showCancel: false,
      });
    }
    if (!wx.createRewardedVideoAd) return toast('当前微信版本不支持激励广告');
    if (!this.rewardAd) {
      this.rewardAd = wx.createRewardedVideoAd({ adUnitId });
      this.rewardAd.onClose((res) => {
        if (res && res.isEnded) this.showResource();
        else toast('看完广告后才能获取内容');
      });
      this.rewardAd.onError(() => toast('广告加载失败，请稍后再试'));
    }
    this.rewardAd.show().catch(() => this.rewardAd.load().then(() => this.rewardAd.show()).catch(() => {}));
  },
  showEnterpriseWechat() {
    const user = store.getUser();
    if (!user) return wx.navigateTo({ url: '/pages/login/login' });
    wx.setClipboardData({
      data: user.id,
      success: () => {
        wx.showModal({
          title: '添加企业微信',
          content: '会员编号已复制。添加企业微信后发送该编号，由管理员在后台开通会员。',
          confirmText: '查看二维码',
          success: (res) => {
            if (res.confirm) wx.previewImage({ current: config.vipQr, urls: [config.vipQr] });
          },
        });
      },
      fail: () => wx.previewImage({ current: config.vipQr, urls: [config.vipQr] }),
    });
  },
  showResource() {
    api.getResource(this.data.note.id).then(({ url }) => {
      wx.showModal({
        title: '领取成功',
        content: url,
        confirmText: '复制链接',
        cancelText: '关闭',
        success: (res) => { if (res.confirm) wx.setClipboardData({ data: url }); },
      });
    }).catch(() => toast('获取地址失败，请联系客服'));
  },
  goService() { wx.switchTab({ url: '/pages/agent/agent' }); },
  goBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) }); },
  requireLogin() {
    if (this._loginRedirected) return;
    this._loginRedirected = true;
    wx.navigateTo({ url: '/pages/login/login' });
  },
});
