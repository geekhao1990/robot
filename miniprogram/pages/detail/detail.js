const api = require('../../utils/api');
const store = require('../../utils/store');
const config = require('../../utils/config');
const { confirmPurchase } = require('../../utils/payment-ui');
const { formatCount, fromNow, toast } = require('../../utils/util');
const RISK_DISCLAIMER = '数据来自交易所和互联网公开数据，由本人整理发布，不构成投资建议';

function detailImageHeight(width, height) {
  if (!Number(width) || !Number(height)) return 750;
  const ratio = Math.max(0.65, Math.min(Number(height) / Number(width), 1.5));
  return Math.round(750 * ratio);
}

function isDarkFundNote(note) {
  return !!(note && (
    String(note.id || '').indexOf('dark_') === 0
    || (Array.isArray(note.tags) && note.tags.indexOf('暗盘资金') >= 0)
  ));
}

function rewardedAdErrorText(error) {
  const code = Number(error && (error.errCode || error.err_code));
  const messages = {
    1000: '微信广告服务暂时异常',
    1001: '广告请求参数错误',
    1002: '广告位无效，请检查广告位 ID',
    1003: '微信广告组件内部错误',
    1004: '当前暂无合适的广告，请稍后再试',
    1005: '广告位正在审核中',
    1006: '广告位审核未通过',
    1007: '当前小程序的广告能力已被限制',
    1008: '该广告位已关闭',
    1009: '广告加载超时，请检查网络后重试',
    1100: '操作过于频繁，请稍后再试',
    1101: '广告已过期，正在重新加载',
    1102: '当前微信版本不支持该广告能力',
    1103: '当前运行环境无法展示广告',
    1104: '网络异常，请检查网络后重试',
    1105: '广告尚未加载成功，请稍后再试',
    1106: '广告展示失败，请稍后再试',
    2002: '距离上次广告展示时间太短，请稍后再试',
    2003: '广告正在播放，请勿重复点击',
    2000: '微信广告服务返回未知错误',
  };
  const message = messages[code] || String((error && error.errMsg) || '广告加载失败，请稍后再试');
  return { code: Number.isFinite(code) ? code : '', message };
}

function darkArticleParagraphs(note, content) {
  const parts = String(content || '').split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  const paragraphs = [parts[0] || '', parts[1] || '', parts.slice(2).join('\n\n')];
  if (note.riskDisclaimerEnabled && String(content || '').indexOf(RISK_DISCLAIMER) < 0) {
    paragraphs[2] = `${paragraphs[2]}${paragraphs[2] ? '\n\n' : ''}${RISK_DISCLAIMER}`;
  }
  return paragraphs;
}

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
    isDarkFundNote: false,
    canShareNote: false,
    darkParagraphs: [],
    darkArticleAdUnitId: /^adunit-/i.test(String(config.darkArticleAdUnitId || ''))
      ? String(config.darkArticleAdUnitId)
      : '',
    articleAdLoadFailed: false,
    followed: false,
    isOwnNote: false,
    inviteCode: '',
    resourceModalVisible: false,
    resourceOptions: [],
    resourceClaiming: false,
    pageRenderLoading: true,
  },

  onLoad(options) {
    this._goldTabEntryLoading = options.from === 'goldTab';
    store.captureInvite(options);
    const app = getApp();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      headerHeight: app.globalData.statusBarHeight + app.globalData.navBarHeight,
    });
    api.getAppSettings().then((settings) => {
      const id = String((settings && settings.articleAdUnitId) || config.darkArticleAdUnitId || '');
      this.setData({ darkArticleAdUnitId: /^adunit-/i.test(id) ? id : '', articleAdLoadFailed: false });
    });
    this.noteId = String((options && options.id) || '').trim();
    if (!this.noteId) {
      this.finishPageRenderLoading();
      wx.showToast({ title: '笔记参数无效', icon: 'none' });
      setTimeout(() => this.goBack(), 600);
      return;
    }
    this.loadInviteCode();
    this.loadNote();
  },

  onShow() {
    this._loginRedirected = false;
    if (this.noteId && !this.data.note) {
      this.loadNote();
    } else {
      this.syncAuthorAction();
    }
  },

  syncAuthorAction() {
    const note = this.data.note;
    if (!note) return;
    const authorId = note.authorId || (note.author && note.author.id);
    const user = store.getUser();
    const isOwnNote = !!(user && authorId && user.id === authorId);
    const canShareNote = !this.data.isDarkFundNote && !!(user && user.official === true);
    this.setData({
      isOwnNote,
      canShareNote,
      followed: !isOwnNote && store.isFollowed(authorId),
    });
    if (!canShareNote && wx.hideShareMenu) wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    else if (canShareNote && wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
  },

  loadInviteCode() {
    const user = store.getUser();
    const cachedCode = user && user.inviteCode;
    if (cachedCode) this.setData({ inviteCode: cachedCode });
    if (!store.isLogin()) return Promise.resolve('');
    return api.getInvites()
      .then((result) => {
        const inviteCode = (result && result.inviteCode) || cachedCode || '';
        this.setData({ inviteCode });
        return inviteCode;
      })
      .catch(() => cachedCode || '');
  },

  loadNote() {
    if (this._loadingNote) return;
    this._loadingNote = true;
    api.getNoteById(this.noteId).then((note) => {
      this._loadingNote = false;
      if (!note) {
        this.finishGoldTabLoading();
        this.finishPageRenderLoading();
        return toast('笔记不存在');
      }
      const content = String(note.content || '').replace(/\s+$/, '');
      const darkFundNote = isDarkFundNote(note);
      // 骨架层只等待首屏图片；后续图片继续后台加载，避免多图笔记等待过久。
      const firstImageIndex = (note.images || []).findIndex(Boolean);
      const pageImageIndexes = firstImageIndex >= 0 ? [firstImageIndex] : [];
      this._pageImageExpected = new Set(pageImageIndexes);
      this._pageImageSettled = new Set();
      this._pageImageErrorShown = false;
      note.displayContent = note.riskDisclaimerEnabled
        ? `${content}${content ? '\n\n' : ''}${RISK_DISCLAIMER}`
        : content;
      const authorId = note.authorId || (note.author && note.author.id);
      const user = store.getUser();
      const isOwnNote = !!(user && authorId && user.id === authorId);
      const canShareNote = !darkFundNote && !!(user && user.official === true);
      this._imageRatios = {};
      this.setData({
        note,
        current: 0,
        swiperHeight: detailImageHeight(1, note.coverRatio || 1.3),
        likeText: formatCount(note.likes),
        collectText: formatCount(note.collects),
        timeText: fromNow(note.time),
        isDarkFundNote: darkFundNote,
        canShareNote,
        darkParagraphs: darkFundNote ? darkArticleParagraphs(note, content) : [],
        resourceLabel: darkFundNote ? '查询暗盘' : (note.type === 'gold' ? '查看金手指' : '点击领取'),
        articleAdLoadFailed: false,
        isOwnNote,
        followed: !isOwnNote && store.isFollowed(authorId),
        pageRenderLoading: pageImageIndexes.length > 0,
      }, () => {
        if (!canShareNote && wx.hideShareMenu) {
          wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
        } else if (wx.showShareMenu) {
          wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
        }
        this.finishGoldTabLoading();
        if (!pageImageIndexes.length) this.finishPageRenderLoading();
      });
    }).catch((err) => {
      this._loadingNote = false;
      this.setData({ pageRenderLoading: false });
      this.finishGoldTabLoading();
      const code = err && err.statusCode;
      wx.showModal({
        title: code === 401 ? '请先登录' : '加载失败',
        content: code === 401 ? '登录后才能查看内容。' : '内容暂时无法加载，请稍后重试。',
        showCancel: false,
        success: () => { if (code === 401) this.requireLogin(); },
      });
    });
  },

  onDetailImageLoad(e) {
    const index = Number(e.currentTarget.dataset.index) || 0;
    this.settlePageImage(index, false);
    const width = Number(e.detail && e.detail.width);
    const height = Number(e.detail && e.detail.height);
    if (!width || !height) return;
    this._imageRatios = this._imageRatios || {};
    this._imageRatios[index] = { width, height };
    if (index === this.data.current) this.setData({ swiperHeight: detailImageHeight(width, height) });
  },

  onPageImageLoad(e) {
    this.settlePageImage(Number(e.currentTarget.dataset.index), false);
  },
  onPageImageError(e) {
    this.settlePageImage(Number(e.currentTarget.dataset.index), true);
  },
  settlePageImage(index, failed) {
    if (!this._pageImageExpected || !this._pageImageExpected.has(index)) return;
    this._pageImageSettled = this._pageImageSettled || new Set();
    this._pageImageSettled.add(index);
    if (failed && !this._pageImageErrorShown) {
      this._pageImageErrorShown = true;
      wx.showToast({ title: '部分图片加载失败，请检查网络', icon: 'none' });
    }
    if (this._pageImageSettled.size >= this._pageImageExpected.size) this.finishPageRenderLoading();
  },
  finishPageRenderLoading() {
    if (!this.data.pageRenderLoading) return;
    wx.nextTick(() => setTimeout(() => this.setData({ pageRenderLoading: false }), 80));
  },
  onSwiperChange(e) {
    const current = Number(e.detail.current) || 0;
    const dimensions = this._imageRatios && this._imageRatios[current];
    this.setData({
      current,
      ...(dimensions ? { swiperHeight: detailImageHeight(dimensions.width, dimensions.height) } : {}),
    });
  },
  onNoteImageTap(e) {
    if (this.data.note && this.data.note.type === 'gold' && Number(e.currentTarget.dataset.index) === 0) {
      return this.openGoldFeature();
    }
    wx.previewImage({ current: e.currentTarget.dataset.url, urls: this.data.note.images });
  },
  onLike() {
    if (!store.isLogin()) return this.requireLogin();
    const note = this.data.note;
    const liked = store.toggleLike(note.id);
    const likes = note.likes + (liked ? 1 : -1);
    this.setData({ 'note.liked': liked, 'note.likes': likes, likeText: formatCount(likes) });
  },
  onCollect() {
    if (!store.isLogin()) return this.requireLogin();
    const note = this.data.note;
    const collected = store.toggleCollect(note.id);
    const collects = note.collects + (collected ? 1 : -1);
    this.setData({ 'note.collected': collected, 'note.collects': collects, collectText: formatCount(collects) });
    toast(collected ? '已收藏' : '已取消收藏');
  },
  onFollow() {
    if (this.data.isOwnNote) return;
    if (!store.isLogin()) return this.requireLogin();
    const note = this.data.note;
    const authorId = note.authorId || note.author.id;
    const followed = store.toggleFollow(authorId);
    this.setData({ followed });
    toast(followed ? '已关注' : '已取消关注');
  },
  onGetResource() {
    if (!store.isLogin()) return this.requireLogin();
    if (this.data.isDarkFundNote) {
      return wx.navigateTo({ url: '/pages/dark-funds/dark-funds' });
    }
    if (this.data.note && this.data.note.type === 'gold') return this.openGoldFeature();
    return this.handleGetResource(this.data.note && this.data.note.free === true);
  },

  finishGoldTabLoading() {
    if (!this._goldTabEntryLoading) return;
    this._goldTabEntryLoading = false;
  },
  hasGoldAccess(user) {
    return !!(user && (user.goldAccess || Number(user.goldExpire) > Date.now() || this.hasServiceAccess(user)));
  },
  hasServiceAccess(user) {
    return !!(user && (user.serviceActive || Number(user.serviceExpire) > Date.now()));
  },
  hasAnnualServiceAccess(user) {
    return !!(this.hasServiceAccess(user) && user && user.servicePlan === 'service_year');
  },
  showGoldCardRequired() {
    wx.showModal({
      title: '需要金手指卡',
      content: '请前往「我—礼品卡」兑换金手指卡或服务包后使用金手指功能。',
      confirmText: '去兑换',
      success: (result) => {
        if (result.confirm) wx.switchTab({ url: '/pages/profile/profile' });
      },
    });
  },
  purchaseGoldAccess(onSuccess) {
    let orderId = '';
    return confirmPurchase('金手指年卡（360天）', '¥9.90')
      .then((confirmed) => {
        if (!confirmed) return null;
        wx.showLoading({ title: '创建订单', mask: true });
        return api.createGoldPurchaseOrder();
      })
      .then((order) => {
        if (!order) return null;
        wx.hideLoading();
        orderId = String(order && order.orderId || '');
        if (!orderId || !order.payment) throw new Error('支付订单创建失败');
        return new Promise((resolve, reject) => wx.requestPayment({
          ...order.payment,
          success: resolve,
          fail: reject,
        }));
      })
      .then(() => {
        if (!orderId) return null;
        wx.showLoading({ title: '确认开通', mask: true });
        return api.getGoldPurchaseOrder(orderId);
      })
      .then((result) => {
        if (!orderId) return;
        wx.hideLoading();
        if (!result || result.status !== 'SUCCESS') {
          return wx.showModal({
            title: '支付处理中',
            content: '支付结果正在确认，请稍后重新点击“查看金手指”。',
            showCancel: false,
          });
        }
        if (result.user) store.setUser(result.user);
        // 本次支付成功只赠送一次免激励广告进入机会；进入后立即消费，不影响后续广告规则。
        this._skipGoldRewardedAdOnce = true;
        wx.showToast({ title: '金手指已开通', icon: 'success', duration: 1400 });
        return onSuccess();
      })
      .catch((error) => {
        wx.hideLoading();
        const message = String((error && (error.errMsg || (error.data && error.data.error) || error.message)) || '请稍后再试');
        if (/cancel/i.test(message) || /取消/.test(message)) return;
        return wx.showModal({ title: '支付失败', content: message, showCancel: false });
      })
      .finally(() => this.releaseResourceClaim());
  },
  handleGetResource(skipAd = false) {
    const note = this.data.note;
    if (this._resourceClaiming) return;
    if (!note.hasResource) return toast('管理员尚未配置获取地址');
    this._resourceClaiming = true;
    this.setData({ resourceClaiming: true });
    if (skipAd) return this.showResource().finally(() => this.releaseResourceClaim());
    return this.showRewardedAd(() => this.showResource().finally(() => this.releaseResourceClaim()));
  },
  releaseResourceClaim() {
    this._resourceClaiming = false;
    if (this.data.resourceClaiming) this.setData({ resourceClaiming: false });
  },
  showRewardedAd(onComplete, settingsKey = 'rewardedVideoAdUnitId') {
    const fallbackId = String(config[settingsKey] || '').trim();
    return api.getAppSettings().then(
      (settings) => {
        if (!settings || settings.rewardedAdEnabled !== true) return onComplete();
        const adUnitId = String((settings && settings[settingsKey]) || fallbackId).trim();
        return this.openRewardedAd(adUnitId, onComplete);
      },
      () => this.openRewardedAd(fallbackId, onComplete),
    );
  },
  showRewardedAdError(error) {
    const detail = rewardedAdErrorText(error);
    console.error('[RewardedVideoAd]', error || detail);
    return wx.showModal({
      title: '广告暂时不可用',
      content: `${detail.message}${detail.code ? `（错误码 ${detail.code}）` : ''}`,
      showCancel: false,
    });
  },
  openRewardedAd(adUnitId, onComplete) {
    if (!adUnitId || /x{4,}/i.test(adUnitId)) {
      this.releaseResourceClaim();
      return wx.showModal({
        title: '暂时无法领取',
        content: '激励视频广告位尚未配置，请联系管理员。',
        showCancel: false,
      });
    }
    if (!wx.createRewardedVideoAd) {
      this.releaseResourceClaim();
      return toast('当前微信版本不支持激励广告');
    }
    if (!this.rewardAd) {
      this.rewardAd = wx.createRewardedVideoAd({ adUnitId });
      this.rewardAd.onClose((res) => {
        const complete = this._rewardedAdComplete;
        this._rewardedAdComplete = null;
        this._rewardedAdShowing = false;
        // 旧基础库不返回 res；少数客户端返回空对象。只有明确返回 false 才视为中途退出。
        if (!res || res.isEnded !== false) {
          if (complete) complete();
          else this.releaseResourceClaim();
          return;
        }
        this.releaseResourceClaim();
        if (complete) toast('广告尚未播放完成，请看完后再领取');
      });
      this.rewardAd.onError((error) => {
        // 已经展示后的客户端异常仍可能继续触发 onClose，不能提前清空领取回调。
        this._rewardedAdLastError = error;
        console.error('[RewardedVideoAd:onError]', error);
        if (this._rewardedAdShowing) this.showRewardedAdError(error);
      });
    }
    this._rewardedAdComplete = onComplete;
    this._rewardedAdLastError = null;
    const showAd = () => this.rewardAd.show().then(() => {
      this._rewardedAdShowing = true;
    });
    return showAd().catch((firstError) => {
      const firstCause = this._rewardedAdLastError || firstError;
      const firstCode = Number(firstCause && (firstCause.errCode || firstCause.err_code));
      if (firstCode === 2003) {
        this._rewardedAdShowing = false;
        this._rewardedAdComplete = null;
        this.releaseResourceClaim();
        return this.showRewardedAdError(firstCause);
      }
      return this.rewardAd.load()
        .then(showAd)
        .catch((error) => {
          this._rewardedAdShowing = false;
          this._rewardedAdComplete = null;
          this.releaseResourceClaim();
          return this.showRewardedAdError(this._rewardedAdLastError || error);
        });
    });
  },
  openGoldFeature() {
    if (this._checkingGoldFeature || this._resourceClaiming) return;
    if (!store.isLogin()) return this.requireLogin();
    this._checkingGoldFeature = true;
    this._resourceClaiming = true;
    this.setData({ resourceClaiming: true });
    wx.showLoading({ title: '请稍后...', mask: true });
    return store.syncMe()
      .then((user) => {
        wx.hideLoading();
        const open = () => wx.navigateTo({ url: '/pages/gold-finger/gold-finger' });
        if (!this.hasGoldAccess(user)) {
          return this.purchaseGoldAccess(() => {
            const skipRewardedAd = this._skipGoldRewardedAdOnce === true;
            this._skipGoldRewardedAdOnce = false;
            if (skipRewardedAd) {
              this.releaseResourceClaim();
              return open();
            }
            return this.showRewardedAd(() => {
              this.releaseResourceClaim();
              return open();
            }, 'goldRewardedVideoAdUnitId');
          });
        }
        if (this.hasAnnualServiceAccess(user)) {
          this.releaseResourceClaim();
          return open();
        }
        return this.showRewardedAd(() => {
          this.releaseResourceClaim();
          return open();
        }, 'goldRewardedVideoAdUnitId');
      })
      .catch((error) => {
        this.releaseResourceClaim();
        if (error && error.statusCode === 401) return this.requireLogin();
        toast('金手指功能暂时不可用，请稍后重试');
      })
      .finally(() => {
        wx.hideLoading();
        this._checkingGoldFeature = false;
      });
  },
  showResource() {
    return api.getResource(this.data.note.id).then((result) => {
      let resources = Array.isArray(result.resources) ? result.resources : [];
      if (!resources.length && result.url) {
        const provider = /quark\.cn/i.test(result.url) ? 'quark' : 'baidu';
        resources = [{
          provider,
          name: provider === 'quark' ? '夸克网盘' : '百度网盘',
          url: result.url,
        }];
      }
      resources = resources.filter((item) => item && item.url).map((item) => ({
        provider: item.provider === 'quark' ? 'quark' : 'baidu',
        name: item.name || (item.provider === 'quark' ? '夸克网盘' : '百度网盘'),
        url: item.url,
      }));
      if (!resources.length) return toast('管理员尚未配置获取地址');
      this.setData({ resourceOptions: resources, resourceModalVisible: true });
    }).catch((err) => {
      toast('获取地址失败，请联系客服');
    });
  },
  closeResourceModal() {
    this.setData({ resourceModalVisible: false });
  },
  noop() {},
  onArticleAdError() {
    this.setData({ articleAdLoadFailed: true });
  },
  copyResourceLink(e) {
    const resource = this.data.resourceOptions[Number(e.currentTarget.dataset.index)];
    if (!resource || !resource.url) return;
    wx.setClipboardData({
      data: resource.url,
      success: () => {
        this.closeResourceModal();
        wx.showToast({ title: `已复制，请打开${resource.name}`, icon: 'none', duration: 2200 });
      },
      fail: () => toast('复制失败，请重试'),
    });
  },
  onShareAppMessage() {
    if (!this.data.canShareNote) return {};
    const note = this.data.note || {};
    const inviteCode = this.data.inviteCode || '';
    const query = [`id=${encodeURIComponent(note.id || this.noteId || '')}`];
    if (inviteCode) query.push(`invite=${encodeURIComponent(inviteCode)}`);
    const share = {
      title: note.title || '分享一篇笔记给你',
      path: `/pages/detail/detail?${query.join('&')}`,
    };
    if (note.images && note.images[0]) share.imageUrl = note.images[0];
    return share;
  },
  goBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) }); },
  requireLogin() {
    if (this._loginRedirected) return;
    this._loginRedirected = true;
    wx.navigateTo({ url: '/pages/login/login' });
  },
});
