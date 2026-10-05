const api = require('../../utils/api');
const config = require('../../utils/config');

const GOLD_FINGER_ICON = 'https://app.nankaitechschool.com/uploads/up_1787930384458_5f0008fd90bf8d07.png';
const SILVER_FINGER_ICON = 'https://app.nankaitechschool.com/uploads/up_1787930384616_32050eca372a0969.png';
const TREND_UP_ICON = '/images/trend-up.png';
const TREND_DOWN_ICON = '/images/trend-down.png';
const store = require('../../utils/store');
const REFRESH_WINDOW_MS = 5 * 60 * 1000;
const REFRESH_LIMIT = 2;
const REFRESH_HISTORY_KEY = 'gold_finger_manual_refresh_history';

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    headerHeight: 64,
    loading: true,
    record: null,
    records: [],
    banners: [],
    historyExpanded: false,
    historyLoading: false,
    refreshing: false,
    hasMoreHistory: false,
    historyPage: 1,
    historyTotalPages: 1,
    goldFingerAdUnitId: /^adunit-/i.test(String(config.goldFingerAdUnitId || ''))
      ? String(config.goldFingerAdUnitId)
      : '',
    adLoadFailed: false,
    refreshSlotKey: '',
    nextRefreshAt: 0,
    posterGenerating: false,
    posterPath: '',
  },

  onLoad() {
    const app = getApp();
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      headerHeight: app.globalData.statusBarHeight + app.globalData.navBarHeight,
    });
    if (!store.isLogin()) return wx.redirectTo({ url: '/pages/login/login' });
    api.getAppSettings().then((settings) => {
      const id = String((settings && settings.goldFingerAdUnitId) || config.goldFingerAdUnitId || '');
      const interstitialId = String((settings && settings.goldFingerInterstitialAdUnitId) || config.goldFingerInterstitialAdUnitId || '');
      const rewardedId = String((settings && settings.goldRewardedVideoAdUnitId) || config.goldRewardedVideoAdUnitId || '');
      this.setData({ goldFingerAdUnitId: /^adunit-/i.test(id) ? id : '', adLoadFailed: false });
      if (/^adunit-/i.test(interstitialId)) this.createGoldInterstitialAd(interstitialId);
      if (/^adunit-/i.test(rewardedId)) this.createGoldRewardedAd(rewardedId);
    });
    this.loadData();
  },

  loadData(options = {}) {
    const silent = options.silent === true;
    if (this.data.refreshing && options.force !== true) return Promise.resolve();
    this.setData(silent ? { refreshing: true } : { loading: true });
    return api.getGoldFinger().then((result) => {
      const record = result && result.record;
      const records = ((result && result.records) || (record ? [record] : [])).map((item) => this.decorateRecord(item));
      this.setData({
        loading: false,
        refreshing: false,
        record: record || null,
        records,
        banners: (result && result.banners) || [],
        historyExpanded: false,
        hasMoreHistory: result && result.hasMoreHistory === true,
        historyPage: 1,
        historyTotalPages: 1,
        refreshSlotKey: String(result && result.refreshPolicy && result.refreshPolicy.slotKey || ''),
        nextRefreshAt: Number(result && result.refreshPolicy && result.refreshPolicy.nextRefreshAt) || 0,
      });
    }).catch((error) => {
      this.setData({ loading: false, refreshing: false });
      if (silent) throw error;
      const statusCode = error && error.statusCode;
      wx.showModal({
        title: statusCode === 403 ? '会员专享功能' : '加载失败',
        content: statusCode === 403 ? '请前往「我—礼品卡」兑换金手指卡或服务包后使用。' : '数据暂时无法加载，请稍后重试。',
        showCancel: false,
        success: () => this.goBack(),
      });
    });
  },

  createGoldInterstitialAd(adUnitId) {
    if (this._goldInterstitialAd || !wx.createInterstitialAd) return;
    this._goldInterstitialAd = wx.createInterstitialAd({ adUnitId });
    this._goldInterstitialAd.onClose(() => {
      this._goldInterstitialShowing = false;
      const done = this._goldInterstitialRefreshDone;
      this._goldInterstitialRefreshDone = null;
      if (done) done(true);
    });
    this._goldInterstitialAd.onError((error) => {
      this._goldInterstitialShowing = false;
      console.error('[GoldInterstitialAd]', error);
      const done = this._goldInterstitialRefreshDone;
      this._goldInterstitialRefreshDone = null;
      // 广告拉取失败不阻断业务刷新。
      if (done) done(true);
    });
    this.showGoldInterstitialAd();
  },

  showGoldInterstitialAd() {
    if (!this._goldInterstitialAd || this._goldInterstitialShowing) return Promise.resolve(false);
    this._goldInterstitialShowing = true;
    return this._goldInterstitialAd.show().then(() => true).catch((error) => {
      this._goldInterstitialShowing = false;
      console.error('[GoldInterstitialAd:show]', error);
      return false;
    });
  },

  showGoldInterstitialForRefresh() {
    if (!this._goldInterstitialAd) return Promise.resolve(true);
    return new Promise((resolve) => {
      let finished = false;
      const done = (allowed) => {
        if (finished) return;
        finished = true;
        resolve(allowed !== false);
      };
      this._goldInterstitialRefreshDone = done;
      this.showGoldInterstitialAd().then((shown) => {
        if (!shown) {
          this._goldInterstitialRefreshDone = null;
          done(true);
        }
      });
    });
  },

  createGoldRewardedAd(adUnitId) {
    if (this._goldRewardedAd || !wx.createRewardedVideoAd) return;
    this._goldRewardedAd = wx.createRewardedVideoAd({ adUnitId });
    this._goldRewardedAd.onClose((result) => {
      // 只有明确返回 isEnded=false 才属于用户中途关闭；旧基础库不返回结果时按已完成处理。
      this.finishGoldRewardedAd(!result || result.isEnded !== false);
      if (this._goldRewardedAd) this._goldRewardedAd.load().catch(() => {});
    });
    this._goldRewardedAd.onError((error) => {
      console.error('[GoldRewardedVideoAd]', error);
      this.finishGoldRewardedAd(true);
    });
    this._goldRewardedAd.load().catch((error) => {
      console.error('[GoldRewardedVideoAd:load]', error);
    });
  },

  finishGoldRewardedAd(shouldRefresh = true) {
    if (this._goldRewardedAdTimer) clearTimeout(this._goldRewardedAdTimer);
    this._goldRewardedAdTimer = null;
    const done = this._goldRewardedAdDone;
    this._goldRewardedAdDone = null;
    if (done) done(shouldRefresh);
  },

  showGoldRewardedAd() {
    if (!this._goldRewardedAd && /^adunit-/i.test(String(config.goldRewardedVideoAdUnitId || ''))) {
      this.createGoldRewardedAd(String(config.goldRewardedVideoAdUnitId));
    }
    // 广告能力或广告实例不可用属于拉取失败，不能阻断刷新。
    if (!this._goldRewardedAd) return Promise.resolve(true);
    return new Promise((resolve) => {
      let finished = false;
      const done = (shouldRefresh) => {
        if (finished) return;
        finished = true;
        resolve(shouldRefresh !== false);
      };
      this._goldRewardedAdDone = done;
      // 极少数客户端既不 reject 也不触发 onError；兜底继续刷新，避免广告 SDK 卡死业务。
      this._goldRewardedAdTimer = setTimeout(() => this.finishGoldRewardedAd(true), 8000);
      const show = () => this._goldRewardedAd.show().then(() => {
        if (this._goldRewardedAdTimer) clearTimeout(this._goldRewardedAdTimer);
        this._goldRewardedAdTimer = null;
      });
      show().catch((error) => {
        console.error('[GoldRewardedVideoAd:show]', error);
        this.finishGoldRewardedAd(true);
      });
    });
  },

  reserveRefreshAttempt() {
    const user = store.getUser() || {};
    const now = Date.now();
    const key = `${REFRESH_HISTORY_KEY}_${user.id || 'unknown'}`;
    let history = [];
    try {
      const saved = wx.getStorageSync(key);
      history = Array.isArray(saved) ? saved : [];
    } catch (error) {}
    history = history.filter((time) => Number(time) > now - REFRESH_WINDOW_MS);
    if (history.length >= REFRESH_LIMIT) return false;
    history.push(now);
    try { wx.setStorageSync(key, history); } catch (error) {}
    return true;
  },

  refreshGoldFinger() {
    if (this.data.loading || this.data.refreshing) return;
    if (!this.reserveRefreshAttempt()) {
      wx.showToast({ title: '操作频繁，请稍后再试', icon: 'none' });
      return;
    }
    // 时段只控制数据请求；广告沿用原规则，同一时段也正常展示。
    const shouldRequestData = !this.data.nextRefreshAt || this.data.nextRefreshAt <= Date.now();
    this.setData({ refreshing: true });
    wx.showLoading({ title: '加载中', mask: true });
    const loadUser = shouldRequestData
      ? store.syncMe().catch(() => store.getUser())
      : Promise.resolve(store.getUser());
    loadUser
      .then((user) => {
        if (user && user.serviceActive === true) {
          return this.showGoldInterstitialForRefresh();
        }
        return this.showGoldRewardedAd();
      })
      .then((shouldRefresh) => {
        if (!shouldRefresh) {
          wx.hideLoading();
          this.setData({ refreshing: false });
          wx.showToast({ title: '广告未播放完成，未刷新', icon: 'none' });
          return false;
        }
        if (shouldRequestData) return this.loadData({ silent: true, force: true }).then(() => true);
        return new Promise((resolve) => setTimeout(() => resolve(true), 450));
      })
      .then((refreshed) => {
        if (!refreshed) return;
        wx.hideLoading();
        this.setData({ refreshing: false });
        wx.showToast({ title: '金手指已更新', icon: 'success', duration: 1200 });
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ refreshing: false });
        wx.showToast({ title: '刷新失败，请稍后重试', icon: 'none' });
      });
  },

  decorateRecord(record) {
    const yang = Math.max(0, Math.min(100, Number(record.yang) || 0));
    const yin = 100 - yang;
    return {
      ...record,
      yang,
      yin,
      fingerIcon: record.finger === 'silver' ? SILVER_FINGER_ICON : GOLD_FINGER_ICON,
      trendIcon: record.trend === 'down' ? TREND_DOWN_ICON : TREND_UP_ICON,
      yangClass: yang > 50 ? 'strong' : '',
      yinClass: yin > 50 ? 'strong' : '',
    };
  },

  loadMoreHistory() {
    this.loadHistoryPage(1);
  },

  changeHistoryPage(e) {
    this.loadHistoryPage(Number(e.currentTarget.dataset.page));
  },

  loadHistoryPage(page) {
    if (this.data.historyLoading || !Number.isInteger(page) || page < 1) return;
    if (this.data.historyExpanded && page > this.data.historyTotalPages) return;
    this.setData({ historyExpanded: true, historyLoading: true });
    api.getGoldFingerHistory(page).then((result) => {
      const records = ((result && result.records) || []).map((item) => this.decorateRecord(item));
      this.setData({
        records,
        historyLoading: false,
        historyPage: Number(result && result.page) || 1,
        historyTotalPages: Number(result && result.totalPages) || 1,
      });
    }).catch(() => {
      this.setData({ historyLoading: false });
      wx.showToast({ title: '历史数据加载失败', icon: 'none' });
    });
  },

  goBannerNote(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/detail/detail?id=${encodeURIComponent(id)}` });
  },

  onAdError() {
    this.setData({ adLoadFailed: true });
  },

  generateSharePoster() {
    if (this.data.posterGenerating || !this.data.record) return;
    this.setData({ posterGenerating: true });
    wx.showLoading({ title: '正在生成', mask: true });
    wx.createSelectorQuery().in(this).select('#goldSharePosterCanvas').fields({ node: true, size: true }).exec((queryResult) => {
      const target = queryResult && queryResult[0];
      if (!target || !target.node) return this.finishPosterError('画布初始化失败');
      try {
        const canvas = target.node;
        const width = 750;
        const height = 1440;
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        Promise.all([
          this.loadPosterImage(canvas, ['/images/dark-share-bg-v2.jpg', '../../images/dark-share-bg-v2.jpg']),
          this.loadPosterImage(canvas, ['/images/indicator-warehouse-mini-code.jpg', '../../images/indicator-warehouse-mini-code.jpg']),
          this.loadPosterImage(canvas, ['/images/gold-share-dark-funds.png', '../../images/gold-share-dark-funds.png']),
        ])
          .then(([backgroundImage, qrImage, darkFundImage]) => {
            this.drawGoldSharePoster(context, width, height, { backgroundImage, qrImage, darkFundImage });
            wx.canvasToTempFilePath({
              canvas,
              width,
              height,
              destWidth: width,
              destHeight: height,
              fileType: 'png',
              quality: 1,
              success: ({ tempFilePath }) => {
                wx.hideLoading();
                this.setData({ posterGenerating: false, posterPath: tempFilePath });
                if (typeof wx.showShareImageMenu === 'function') {
                  wx.showShareImageMenu({ path: tempFilePath, fail: () => wx.previewImage({ current: tempFilePath, urls: [tempFilePath] }) });
                } else {
                  wx.previewImage({ current: tempFilePath, urls: [tempFilePath] });
                }
              },
              fail: () => this.finishPosterError('生成分享图失败'),
            });
          })
          .catch(() => this.finishPosterError('分享图素材加载失败'));
      } catch (error) {
        this.finishPosterError('生成分享图失败');
      }
    });
  },

  loadPosterImage(canvas, sources) {
    return new Promise((resolve, reject) => {
      const load = (index) => {
        const image = canvas.createImage();
        image.onload = () => resolve(image);
        image.onerror = () => {
          if (index + 1 < sources.length) return load(index + 1);
          reject(new Error('image load failed'));
        };
        image.src = sources[index];
      };
      load(0);
    });
  },

  finishPosterError(message) {
    wx.hideLoading();
    this.setData({ posterGenerating: false });
    wx.showToast({ title: message, icon: 'none' });
  },

  drawGoldSharePoster(context, width, height, assets) {
    const record = this.data.record || {};
    const yang = Number(record.yang) || 0;
    const yin = Number(record.yin) || 0;
    const fingerText = record.finger === 'silver' ? '银手指' : '金手指';
    const headline = record.finger === 'silver' ? '是倒车接人还是调整开始？' : '准备进攻还是诱多发套？';
    const fingerColor = record.finger === 'silver' ? '#eef3fa' : '#f4cf70';
    const warning = yang >= 75
      ? '阳谱接近80：警惕风险，随时可能调整'
      : (yin >= 75 ? '阴谱接近80：不要放弃，随时可能反弹修复' : '');
    const roundRect = (x, y, w, h, r) => {
      context.beginPath();
      context.moveTo(x + r, y); context.lineTo(x + w - r, y); context.quadraticCurveTo(x + w, y, x + w, y + r);
      context.lineTo(x + w, y + h - r); context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      context.lineTo(x + r, y + h); context.quadraticCurveTo(x, y + h, x, y + h - r);
      context.lineTo(x, y + r); context.quadraticCurveTo(x, y, x + r, y); context.closePath();
    };
    const text = (value, x, y, size, color = '#fff', weight = '400', align = 'left') => {
      context.font = `${weight} ${size}px "Microsoft YaHei", sans-serif`;
      context.fillStyle = color;
      context.textAlign = align;
      context.textBaseline = 'middle';
      context.fillText(String(value), x, y);
    };
    const artText = (value, x, y, size) => {
      context.save();
      context.font = `italic 900 ${size}px Impact, "Microsoft YaHei", sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.lineJoin = 'round';
      context.lineWidth = 12;
      context.strokeStyle = '#170406';
      context.shadowColor = 'rgba(255,40,48,.7)';
      context.shadowBlur = 22;
      context.strokeText(value, x, y);
      const gradient = context.createLinearGradient(x - 260, y - size / 2, x + 260, y + size / 2);
      gradient.addColorStop(0, '#fff5d0');
      gradient.addColorStop(.46, record.finger === 'silver' ? '#dce5ef' : '#ffd15a');
      gradient.addColorStop(.52, '#ff4b45');
      gradient.addColorStop(1, '#d71924');
      context.fillStyle = gradient;
      context.fillText(value, x, y);
      context.restore();
    };
    if (assets.backgroundImage) context.drawImage(assets.backgroundImage, 0, 0, width, height);
    const shade = context.createLinearGradient(0, 0, 0, height);
    shade.addColorStop(0, 'rgba(1,5,10,.25)');
    shade.addColorStop(.38, 'rgba(2,7,13,.72)');
    shade.addColorStop(1, 'rgba(2,6,11,.88)');
    context.fillStyle = shade;
    context.fillRect(0, 0, width, height);

    artText(fingerText, 222, 94, 92);
    text(record.date || '--', 515, 112, 25, '#fff', '700');
    text('把握市场情绪 · 抢先一步', 54, 164, 27, '#f2f2f4', '600');
    context.fillStyle = '#e8383f';
    context.fillRect(52, 192, 646, 3);

    roundRect(30, 210, 690, 190, 28);
    context.fillStyle = 'rgba(9,7,10,.82)';
    context.fill();
    context.strokeStyle = 'rgba(239,51,59,.72)';
    context.lineWidth = 2;
    context.stroke();
    roundRect(486, 222, 196, 44, 22);
    context.fillStyle = 'rgba(100,18,22,.72)';
    context.fill();
    text(`指标 · ${fingerText}`, 584, 244, 21, fingerColor, '700', 'center');
    artText(headline, width / 2, 295, 54);
    text('趋势、仓位及实时金手指请登录小程序查看', width / 2, 365, 23, '#f3f3f5', '700', 'center');

    roundRect(30, 420, 690, 280, 28);
    context.fillStyle = 'rgba(5,10,18,.9)';
    context.fill();
    context.strokeStyle = 'rgba(239,51,59,.55)';
    context.stroke();
    text('▮▮ 市场情绪', 58, 466, 32, '#fff', '900');
    roundRect(500, 442, 180, 48, 24);
    context.fillStyle = 'rgba(96,18,22,.75)';
    context.fill();
    text(`${fingerText} · 情绪分析`, 590, 466, 20, '#f5d9da', '600', 'center');

    const cards = [
      { label: '阳谱', value: `${yang}%`, color: '#ff625b' },
      { label: '阴谱', value: `${yin}%`, color: '#2ad6a3' },
    ];
    cards.forEach((item, index) => {
      const x = 52 + index * 326;
      roundRect(x, 510, 310, 122, 18);
      context.fillStyle = index === 0 ? 'rgba(74,13,17,.7)' : 'rgba(4,55,47,.72)';
      context.fill();
      context.strokeStyle = index === 0 ? 'rgba(239,59,64,.45)' : 'rgba(23,196,151,.42)';
      context.stroke();
      text(item.label, x + 28, 548, 27, '#f4f4f5', '700');
      text(item.value, x + 28, 596, 48, item.color, '900');
    });

    if (warning) {
      roundRect(52, 646, 646, 40, 14);
      context.fillStyle = yang >= 75 ? 'rgba(104,22,24,.88)' : 'rgba(4,67,54,.88)';
      context.fill();
      text(warning, width / 2, 666, 20, yang >= 75 ? '#ffb4ae' : '#84f3d1', '700', 'center');
    }

    roundRect(30, 720, 690, 465, 26);
    context.fillStyle = 'rgba(250,250,250,.98)';
    context.fill();
    context.strokeStyle = 'rgba(239,51,59,.52)';
    context.stroke();
    if (assets.darkFundImage) context.drawImage(assets.darkFundImage, 42, 732, 666, 441);
    roundRect(568, 744, 120, 38, 19);
    context.fillStyle = 'rgba(211,33,42,.9)';
    context.fill();
    text('静态样例', 628, 763, 19, '#fff', '800', 'center');

    roundRect(30, 1205, 690, 190, 26);
    context.fillStyle = 'rgba(8,10,16,.92)';
    context.fill();
    context.strokeStyle = 'rgba(235,55,55,.48)';
    context.stroke();
    if (assets.qrImage) context.drawImage(assets.qrImage, 52, 1223, 154, 154);
    text('查看实时金手指和暗盘资金', 238, 1252, 30, '#fff', '900');
    text('搜索“指标仓库”小程序', 238, 1310, 28, '#f0c96b', '800');
    text('长按识别小程序码', 238, 1357, 21, '#e4676e', '600');
    text('数据来自互联网，仅供参考，不构成投资建议', width / 2, 1422, 17, '#777d88', '400', 'center');
  },

  onUnload() {
    if (this._goldInterstitialRefreshDone) this._goldInterstitialRefreshDone(false);
    this._goldInterstitialRefreshDone = null;
    this.finishGoldRewardedAd(false);
    if (this._goldRewardedAd && this._goldRewardedAd.destroy) this._goldRewardedAd.destroy();
    this._goldRewardedAd = null;
    if (this._goldInterstitialAd && this._goldInterstitialAd.destroy) this._goldInterstitialAd.destroy();
    this._goldInterstitialAd = null;
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },
});
