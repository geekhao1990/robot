const api = require('../../utils/api');
const config = require('../../utils/config');
const store = require('../../utils/store');
const { exactAmount, posterMetrics } = require('../../utils/dark-fund-poster');

const YELLOW = '#ffe50a';
const TREND_AREA_RED = '#ff0000';
const TREND_AREA_GREEN = '#00ff00';

function chooseUnit(values) {
  return values.some((value) => Math.abs(Number(value) || 0) >= 100000000)
    ? { divisor: 100000000, label: '亿元', suffix: '亿', digits: 2 }
    : { divisor: 10000, label: '万元', suffix: '万', digits: 1 };
}

function formatByUnit(value, unit, suffix = false) {
  const number = (Number(value) || 0) / unit.divisor;
  return `${number.toFixed(unit.digits)}${suffix ? unit.suffix : ''}`;
}

function roundedUnitValue(value, unit) {
  const factor = 10 ** unit.digits;
  const rounded = Math.round(((Number(value) || 0) / unit.divisor) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function formatRoundedUnit(value, unit, suffix = false) {
  return `${value.toFixed(unit.digits)}${suffix ? unit.suffix : ''}`;
}

function balancedMainGroup(row, unit, suffix = false) {
  const main = roundedUnitValue(row.main, unit);
  let listed = roundedUnitValue(row.listed, unit);
  let grey = roundedUnitValue(row.grey, unit);
  const residual = Number((main - listed - grey).toFixed(unit.digits));
  if (Math.abs(listed) >= Math.abs(grey)) listed = Number((listed + residual).toFixed(unit.digits));
  else grey = Number((grey + residual).toFixed(unit.digits));
  return {
    mainValue: main,
    listedValue: listed,
    greyValue: grey,
    mainText: formatRoundedUnit(main, unit, suffix),
    listedText: formatRoundedUnit(listed, unit, suffix),
    greyText: formatRoundedUnit(grey, unit, suffix),
  };
}

function formatGroup(row, keys) {
  const unit = chooseUnit(keys.map((key) => row[key]));
  const output = {};
  keys.forEach((key) => { output[`${key}Text`] = formatByUnit(row[key], unit, true); });
  return output;
}

function rolling(days, size) {
  return days.map((row, index) => ({
    date: row.tradeDate.slice(5),
    value: index + 1 < size
      ? null
      : days.slice(index - size + 1, index + 1).reduce((sum, item) => sum + Number(item.grey || 0), 0),
  }));
}

function withBars(items) {
  const max = Math.max(...items.map((item) => Math.abs(item.value)), 1);
  return items.map((item) => ({
    ...item,
    height: Math.max(12, Math.round(Math.abs(item.value) / max * 120)),
    positive: item.value >= 0,
  }));
}

function marketStockCode(code) {
  const value = String(code || '').replace(/^(sh|sz)/i, '');
  return `${/^[569]/.test(value) ? 'sh' : 'sz'}${value}`;
}

function hybridStockName(name, initials) {
  const stockName = String(name || '').trim();
  const letters = String(initials || '').replace(/[^a-z]/gi, '').toUpperCase();
  if (!stockName) return letters;
  if (stockName.length <= 2 || !letters) return stockName;
  return `${stockName.slice(0, 2)}${letters.slice(2) || stockName.slice(2)}`;
}

function createMockCloseResult() {
  const days = [
    { tradeDate: '2026-09-30', main: -279681505.83274597, grey: -70262426.83274597, listed: -209419079, super_large: -146578422.84490156, large: -133103082.9878444, middle: -18850426.15509844, small: 298531931.9878445 },
    { tradeDate: '2026-09-29', main: -234428686.71112993, grey: -123071051.71112993, listed: -111357635, super_large: -9165579.480624594, large: -225263107.23050535, middle: -18165255.519375376, small: 252593942.2305054 },
    { tradeDate: '2026-09-28', main: -1342328107.9458745, grey: -605460166.9458745, listed: -736867941, super_large: -734231920.2085357, large: -608096187.7373387, middle: 365773509.208536, small: 976554598.7373394 },
    { tradeDate: '2026-09-24', main: -502823098.275403, grey: -159935303.275403, listed: -342887795, super_large: -292457773.44773275, large: -210365324.82767022, middle: -58856301.552267365, small: 561679399.8276703 },
    { tradeDate: '2026-09-23', main: -490129791.2829146, grey: -42902723.28291457, listed: -447227068, super_large: -215148291.9512939, large: -274981499.3316207, middle: 43362163.95129384, small: 446767627.3316206 },
    { tradeDate: '2026-09-22', main: -861658891.3149973, grey: -242033011.31499732, listed: -619625880, super_large: -617310498.8877808, large: -244348392.4272165, middle: -63311021.112219155, small: 924969912.4272175 },
    { tradeDate: '2026-09-21', main: 22542169.263435997, grey: 17156209.263435997, listed: 5385960, super_large: 12113368.197681013, large: 10428801.065754985, middle: -100601528.197681, small: 78059358.93424496 },
  ];
  return {
    type: 'close_snapshot',
    stockCode: '600105',
    stockName: '永鼎股份',
    stockInitials: 'YDGF',
    tradeDate: '2026-09-30',
    versionKey: '2026-09-30Tclose',
    versionLabel: '收盘',
    kind: 'close',
    updatedAt: '2026-09-30T16:41:05+08:00',
    debit: true,
    balanceAfter: 2,
    unlimited: false,
    expiresAt: null,
    summary: {
      sevenDayMain: -3688507912.0996294,
      greyTotal: -1226508474.0996292,
      listedTotal: -2461999438,
    },
    days,
  };
}

Page({
  data: {
    loading: true,
    error: '',
    result: null,
    unitLabel: '',
    summary: [],
    dayBars: [],
    rows: [],
    fundView: 'main',
    detailView: 'core',
    trendMetricLabel: '',
    trendMetricText: '',
    trendMetricPositive: true,
    trendHasData: false,
    closeBannerAdUnitId: /^adunit-/i.test(String(config.darkFundsCloseBannerAdUnitId || ''))
      ? String(config.darkFundsCloseBannerAdUnitId)
      : '',
    closeBannerAdLoadFailed: false,
    posterGenerating: false,
    posterPath: '',
    isOfficial: false,
    skeletonRows: [1, 2, 3, 4, 5],
  },
  onLoad(options) {
    const currentUser = store.getUser();
    const isOfficial = !!(currentUser && currentUser.official === true);
    const requestedPoster = String(options && options.poster || '');
    this.autoPosterWithoutQr = isOfficial && requestedPoster === 'noqr';
    this.autoPosterWithQr = requestedPoster === 'qr';
    this.setData({ isOfficial });
    this.loadCloseAds();
    if (String(options && options.mock || '') === '1') {
      this.applyResult(createMockCloseResult(options));
      return;
    }
    const rankingStockCode = String(options && options.ranking || '').replace(/\D/g, '').slice(0, 6);
    if (rankingStockCode) {
      api.getDarkFundRankingResult(rankingStockCode)
        .then((payload) => {
          const result = payload && payload.result;
          if (!result || result.type !== 'close_snapshot' || !Array.isArray(result.days) || !result.days.length) throw new Error('榜单数据不存在');
          this.applyResult(result);
        })
        .catch((error) => this.setData({ loading: false, error: error && (error.errMsg || error.message) || '加载失败' }));
      return;
    }
    this.orderId = String(options && options.id || '');
    if (!this.orderId) return this.setData({ loading: false, error: '查询结果不存在' });
    api.getDarkFundOrder(this.orderId)
      .then((order) => {
        const result = order && order.snapshot && order.snapshot.result;
        if (!result || result.type !== 'close_snapshot' || !Array.isArray(result.days) || !result.days.length) throw new Error('盘后数据不存在');
        this.applyResult(result);
      })
      .catch((error) => this.setData({ loading: false, error: error && (error.errMsg || error.message) || '加载失败' }));
  },
  loadCloseAds() {
    api.getAppSettings().then((settings) => {
      const bannerId = String((settings && settings.darkFundsCloseBannerAdUnitId) || config.darkFundsCloseBannerAdUnitId || '');
      const interstitialId = String((settings && settings.darkFundsCloseInterstitialAdUnitId) || config.darkFundsCloseInterstitialAdUnitId || '');
      this.setData({
        closeBannerAdUnitId: /^adunit-/i.test(bannerId) ? bannerId : '',
        closeBannerAdLoadFailed: false,
      });
      this.showCloseInterstitial(interstitialId);
    }).catch(() => {});
  },
  showCloseInterstitial(adUnitId) {
    if (!/^adunit-/i.test(String(adUnitId || '')) || typeof wx.createInterstitialAd !== 'function') return;
    try {
      const ad = wx.createInterstitialAd({ adUnitId });
      this.closeInterstitialAd = ad;
      Promise.resolve(ad.show()).catch(() => (typeof ad.load === 'function'
        ? Promise.resolve(ad.load()).then(() => ad.show()).catch(() => {})
        : undefined));
    } catch (error) {}
  },
  onCloseBannerAdError() {
    this.setData({ closeBannerAdLoadFailed: true });
  },
  onUnload() {
    if (this.closeInterstitialAd && typeof this.closeInterstitialAd.destroy === 'function') this.closeInterstitialAd.destroy();
    this.closeInterstitialAd = null;
  },
  applyResult(result) {
    const days = result.days.slice().sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
    result.days = days;
    const latest = days[days.length - 1];
    const unit = chooseUnit([latest.main, latest.listed, latest.grey]);
    const main = Number(latest.main) || 0;
    const balancedLatest = balancedMainGroup(latest, unit);
    const summary = [
      { label: '主力净流入', value: main },
      { label: '散户流入', value: -main },
    ].map((item) => ({ ...item, text: formatByUnit(item.value, unit), positive: item.value >= 0 }));
    const dayBars = withBars([
      { label: '主力明盘', value: Number(latest.listed) || 0, text: formatRoundedUnit(balancedLatest.listedValue, unit) },
      { label: '主力暗盘', value: Number(latest.grey) || 0, text: formatRoundedUnit(balancedLatest.greyValue, unit) },
      { label: '散户流入', value: -main, text: formatByUnit(-main, unit) },
    ]);
    const rows = days.slice().reverse().slice(0, 7).map((row) => {
      const mainUnit = chooseUnit([row.main, row.grey, row.listed]);
      return {
        ...row,
        displayDate: row.tradeDate.slice(5),
        ...balancedMainGroup(row, mainUnit, true),
        ...formatGroup(row, ['super_large', 'large', 'middle', 'small']),
      };
    });
    result.displayName = hybridStockName(result.stockName, result.stockInitials);
    result.displayCode = marketStockCode(result.stockCode);
    this.trends = { trend3: rolling(days, 3), trend5: rolling(days, 5) };
    this.setData({ loading: false, result, unitLabel: unit.label, summary, dayBars, rows }, () => {
      if (this.autoPosterWithoutQr) {
        this.autoPosterWithoutQr = false;
        wx.nextTick(() => this.generateSharePoster({ currentTarget: { dataset: { noQr: 'true' } } }));
      } else if (this.autoPosterWithQr) {
        this.autoPosterWithQr = false;
        wx.nextTick(() => this.generateSharePoster({ currentTarget: { dataset: {} } }));
      }
    });
  },
  switchFundView(event) {
    const fundView = String(event.currentTarget.dataset.view || 'main');
    if (!['main', 'trend3', 'trend5'].includes(fundView) || fundView === this.data.fundView) return;
    if (fundView === 'main') return this.setData({ fundView });
    const size = fundView === 'trend5' ? 5 : 3;
    const series = this.trends && this.trends[fundView] || [];
    const latest = series.slice().reverse().find((item) => item.value !== null);
    const unit = chooseUnit([latest ? latest.value : 0]);
    this.trendUnit = unit;
    this.setData({
      fundView,
      trendMetricLabel: `${size}日暗盘净流入`,
      trendMetricText: latest ? formatByUnit(latest.value, unit, true) : '—',
      trendMetricPositive: !latest || latest.value >= 0,
      trendHasData: !!latest,
    }, () => {
      if (latest) wx.nextTick(() => this.drawTrend(series));
    });
  },
  switchDetailView(event) {
    this.setData({ detailView: event.currentTarget.dataset.view === 'orders' ? 'orders' : 'core' });
  },
  onResize() {
    const series = this.trends && this.trends[this.data.fundView];
    if (series && this.data.trendHasData) wx.nextTick(() => this.drawTrend(series));
  },
  drawTrend(series) {
    wx.createSelectorQuery().in(this).select('#trendCanvas').fields({ node: true, size: true }).exec((result) => {
      const target = result && result[0];
      if (!target || !target.node || !target.width || !target.height) return;
      const canvas = target.node;
      const context = canvas.getContext('2d');
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const ratio = Number(info.pixelRatio) || 1;
      canvas.width = target.width * ratio;
      canvas.height = target.height * ratio;
      context.scale(ratio, ratio);
      const width = target.width;
      const height = target.height;
      const padding = { left: 62, right: 12, top: 18, bottom: 30 };
      const plotWidth = width - padding.left - padding.right;
      const plotHeight = height - padding.top - padding.bottom;
      const valid = series.map((item, index) => item.value === null ? null : ({ ...item, index })).filter(Boolean);
      if (!valid.length) return;
      const values = valid.map((item) => item.value);
      const unit = this.trendUnit || chooseUnit([valid[valid.length - 1].value]);
      let min = Math.min(0, ...values);
      let max = Math.max(0, ...values);
      const span = Math.max(max - min, Math.abs(max), Math.abs(min), 1);
      min -= span * 0.12;
      max += span * 0.12;
      const xAt = (index) => padding.left + (series.length <= 1 ? plotWidth / 2 : index / (series.length - 1) * plotWidth);
      const yAt = (value) => padding.top + (max - value) / (max - min) * plotHeight;
      const zeroY = yAt(0);
      context.clearRect(0, 0, width, height);
      context.font = '10px sans-serif';
      context.textBaseline = 'middle';
      for (let step = 0; step <= 4; step += 1) {
        const value = max - (max - min) * step / 4;
        const y = yAt(value);
        context.beginPath();
        context.setLineDash(step === 0 || step === 4 ? [] : [4, 4]);
        context.strokeStyle = Math.abs(value) < span / 20 ? '#9da3aa' : '#eceff2';
        context.lineWidth = Math.abs(value) < span / 20 ? 1.2 : 1;
        context.moveTo(padding.left, y);
        context.lineTo(width - padding.right, y);
        context.stroke();
        context.fillStyle = '#8a9098';
        context.textAlign = 'right';
        context.fillText(formatByUnit(value, unit, true), padding.left - 6, y);
      }
      context.setLineDash([]);
      context.beginPath();
      context.strokeStyle = '#9da3aa';
      context.lineWidth = 1.2;
      context.moveTo(padding.left, zeroY);
      context.lineTo(width - padding.right, zeroY);
      context.stroke();
      const areaPath = () => {
        context.beginPath();
        context.moveTo(xAt(valid[0].index), zeroY);
        valid.forEach((item) => context.lineTo(xAt(item.index), yAt(item.value)));
        context.lineTo(xAt(valid[valid.length - 1].index), zeroY);
        context.closePath();
      };
      context.save();
      context.beginPath();
      context.rect(padding.left, padding.top, plotWidth, Math.max(0, zeroY - padding.top));
      context.clip();
      areaPath();
      context.fillStyle = TREND_AREA_RED;
      context.fill();
      context.restore();
      context.save();
      context.beginPath();
      context.rect(padding.left, zeroY, plotWidth, Math.max(0, padding.top + plotHeight - zeroY));
      context.clip();
      areaPath();
      context.fillStyle = TREND_AREA_GREEN;
      context.fill();
      context.restore();
      if (valid[0].index > 0) {
        context.beginPath();
        context.setLineDash([5, 4]);
        context.strokeStyle = YELLOW;
        context.lineWidth = 2;
        context.moveTo(xAt(0), zeroY);
        context.lineTo(xAt(valid[0].index), yAt(valid[0].value));
        context.stroke();
        context.setLineDash([]);
      }
      context.beginPath();
      valid.forEach((item, index) => {
        const x = xAt(item.index);
        const y = yAt(item.value);
        if (!index) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.strokeStyle = YELLOW;
      context.lineWidth = 2.5;
      context.stroke();
      context.fillStyle = '#70757d';
      context.textAlign = 'center';
      series.forEach((item, index) => context.fillText(item.date, xAt(index), height - 12));
    });
  },
  generateSharePoster(event) {
    if (this.data.posterGenerating || !this.data.result) return;
    const withoutQr = String(event && event.currentTarget && event.currentTarget.dataset.noQr || '') === 'true';
    this.setData({ posterGenerating: true });
    wx.showLoading({ title: '正在生成', mask: true });
    wx.createSelectorQuery().in(this).select('#sharePosterCanvas').fields({ node: true, size: true }).exec((queryResult) => {
      const target = queryResult && queryResult[0];
      if (!target || !target.node) return this.finishPosterError('画布初始化失败');
      try {
        const canvas = target.node;
        const width = 750;
        const height = 1334;
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        const metrics = posterMetrics(this.data.result, {
          unitLabel: this.data.unitLabel,
          dayBars: this.data.dayBars,
        });
        Promise.all([
          this.loadPosterImage(canvas, ['/images/dark-share-bg-v2.jpg', '../../images/dark-share-bg-v2.jpg'], '分享图背景'),
          withoutQr
            ? Promise.resolve(null)
            : this.loadPosterImage(canvas, ['/images/indicator-warehouse-mini-code.jpg', '../../images/indicator-warehouse-mini-code.jpg'], '小程序码'),
        ]).then(([backgroundImage, qrImage]) => {
          this.drawSharePoster(context, metrics, width, height, { backgroundImage, qrImage, withoutQr });
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
              this.openShareImageMenu(tempFilePath);
            },
            fail: () => this.finishPosterError('生成分享图失败'),
          });
        }).catch((error) => this.finishPosterError(error && error.message || '分享图素材加载失败'));
      } catch (error) {
        this.finishPosterError('生成分享图失败');
      }
    });
  },
  loadPosterImage(canvas, sources, label) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (image) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(image);
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`${label}加载失败`));
      };
      const load = (source, index) => {
        const image = canvas.createImage();
        image.onload = () => finish(image);
        image.onerror = () => {
          if (index + 1 < sources.length) return load(sources[index + 1], index + 1);
          wx.getImageInfo({
            src: sources[0],
            success: ({ path }) => {
              const fallbackImage = canvas.createImage();
              fallbackImage.onload = () => finish(fallbackImage);
              fallbackImage.onerror = fail;
              fallbackImage.src = path;
            },
            fail,
          });
        };
        image.src = source;
      };
      const timer = setTimeout(fail, 8000);
      load(sources[0], 0);
    });
  },
  finishPosterError(message) {
    wx.hideLoading();
    this.setData({ posterGenerating: false });
    wx.showToast({ title: message, icon: 'none' });
  },
  openShareImageMenu(path) {
    if (typeof wx.showShareImageMenu !== 'function') {
      wx.previewImage({ current: path, urls: [path] });
      return;
    }
    wx.showShareImageMenu({
      path,
      fail: () => wx.previewImage({ current: path, urls: [path] }),
    });
  },
  previewSharePoster() {
    if (!this.data.posterPath) return this.generateSharePoster();
    wx.previewImage({ current: this.data.posterPath, urls: [this.data.posterPath] });
  },
  saveSharePoster() {
    if (!this.data.posterPath) return this.generateSharePoster();
    wx.saveImageToPhotosAlbum({
      filePath: this.data.posterPath,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: (error) => {
        const denied = /auth deny|auth denied/i.test(String(error && error.errMsg || ''));
        if (!denied) return wx.showToast({ title: '保存失败', icon: 'none' });
        wx.showModal({ title: '需要相册权限', content: '请在设置中允许保存图片到相册。', confirmText: '去设置', success: (choice) => { if (choice.confirm) wx.openSetting(); } });
      },
    });
  },
  drawSharePoster(context, metrics, width, height, assets) {
    const roundRect = (x, y, w, h, r) => {
      context.beginPath();
      context.moveTo(x + r, y); context.lineTo(x + w - r, y); context.quadraticCurveTo(x + w, y, x + w, y + r);
      context.lineTo(x + w, y + h - r); context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      context.lineTo(x + r, y + h); context.quadraticCurveTo(x, y + h, x, y + h - r);
      context.lineTo(x, y + r); context.quadraticCurveTo(x, y, x + r, y); context.closePath();
    };
    const fillText = (text, x, y, size, color = '#fff', weight = '400', align = 'left') => {
      context.font = `${weight} ${size}px "Microsoft YaHei", sans-serif`;
      context.fillStyle = color; context.textAlign = align; context.textBaseline = 'middle'; context.fillText(String(text), x, y);
    };
    const drawArtTitle = () => {
      context.save();
      context.translate(48, 96);
      context.transform(1, 0, -0.13, 1, 0, 0);
      context.textAlign = 'left'; context.textBaseline = 'middle';
      context.font = '900 68px "Microsoft YaHei", "Arial Black", sans-serif';
      context.lineJoin = 'bevel'; context.lineWidth = 3;
      context.shadowColor = 'rgba(0,0,0,.88)'; context.shadowBlur = 9; context.shadowOffsetX = 7; context.shadowOffsetY = 8;
      const whiteMetal = context.createLinearGradient(0, -38, 0, 38);
      whiteMetal.addColorStop(0, '#ffffff'); whiteMetal.addColorStop(.42, '#fdfdfd'); whiteMetal.addColorStop(.53, '#aeb5bd'); whiteMetal.addColorStop(.72, '#ffffff'); whiteMetal.addColorStop(1, '#858d96');
      context.strokeStyle = '#111820'; context.strokeText('暗盘', 0, 0); context.fillStyle = whiteMetal; context.fillText('暗盘', 0, 0);
      const firstWidth = context.measureText('暗盘').width + 4;
      const redMetal = context.createLinearGradient(0, -38, 0, 38);
      redMetal.addColorStop(0, '#ff5a5f'); redMetal.addColorStop(.42, '#ff3339'); redMetal.addColorStop(.55, '#a70d18'); redMetal.addColorStop(.72, '#ff343b'); redMetal.addColorStop(1, '#830812');
      context.strokeStyle = '#3a0509'; context.strokeText('追踪', firstWidth, 0); context.fillStyle = redMetal; context.fillText('追踪', firstWidth, 0);
      context.shadowColor = 'transparent'; context.lineWidth = 1.2; context.strokeStyle = 'rgba(255,255,255,.5)';
      context.beginPath(); context.moveTo(4, -22); context.lineTo(firstWidth - 4, -22); context.stroke();
      context.strokeStyle = 'rgba(255,130,130,.55)'; context.beginPath(); context.moveTo(firstWidth + 4, -22); context.lineTo(firstWidth + context.measureText('追踪').width - 5, -22); context.stroke();
      context.restore();
    };
    const valueColor = (value) => Number(value) >= 0 ? '#ff4148' : '#00e4a8';
    const imageRatio = assets.backgroundImage.width / assets.backgroundImage.height;
    const targetRatio = width / height;
    const sourceWidth = imageRatio > targetRatio ? assets.backgroundImage.height * targetRatio : assets.backgroundImage.width;
    const sourceHeight = imageRatio > targetRatio ? assets.backgroundImage.height : assets.backgroundImage.width / targetRatio;
    const sourceX = (assets.backgroundImage.width - sourceWidth) / 2;
    const sourceY = (assets.backgroundImage.height - sourceHeight) / 2;
    context.drawImage(assets.backgroundImage, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
    const shade = context.createLinearGradient(0, 0, 0, height);
    shade.addColorStop(0, 'rgba(0,0,0,.12)'); shade.addColorStop(.42, 'rgba(0,0,0,.28)'); shade.addColorStop(1, 'rgba(0,0,0,.36)');
    context.fillStyle = shade; context.fillRect(0, 0, width, height);
    drawArtTitle();
    fillText('主力资金 · 先人一步', 50, 142, 23, '#d5dbe3', '400');
    context.fillStyle = '#ef343b'; context.fillRect(48, 174, 654, 3);
    roundRect(34, 205, 682, 840, 26); context.fillStyle = 'rgba(5,12,18,.90)'; context.fill(); context.strokeStyle = 'rgba(255,55,62,.55)'; context.lineWidth = 2; context.stroke();
    fillText(metrics.stockName, 62, 266, 46, '#fff', '800');
    fillText(metrics.stockCode, 690, 270, 22, '#b8c2cf', '400', 'right');
    fillText(`${metrics.tradeDate} 收盘暗盘数据`, 63, 312, 21, '#aab7c6');
    roundRect(52, 350, 418, 246, 20); context.fillStyle = 'rgba(0,64,54,.28)'; context.fill(); context.strokeStyle = 'rgba(0,228,168,.34)'; context.stroke();
    fillText('1日暗盘', 78, 397, 33, '#fff', '700');
    fillText(metrics.day1Text, 78, 476, 70, valueColor(metrics.day1), '800');
    fillText(metrics.day1 >= 0 ? '今日暗盘资金净流入' : '今日暗盘资金净流出', 78, 552, 22, '#b6cbd2');
    [['3日暗盘净流入', metrics.day3Text, metrics.day3], ['5日暗盘净流入', metrics.day5Text, metrics.day5]].forEach((item, index) => {
      const y = 350 + index * 123; roundRect(488, y, 208, 108, 15); context.fillStyle = 'rgba(19,28,35,.92)'; context.fill(); context.strokeStyle = 'rgba(255,255,255,.08)'; context.stroke();
      fillText(item[0], 510, y + 31, 18, '#dce3ea'); fillText(item[1], 510, y + 75, 32, valueColor(item[2]), '700');
    });
    fillText('1日暗盘资金截图', 62, 644, 27, '#fff', '700');
    fillText('(单位：万元)', 62, 680, 17, '#a8b4c1');
    const bars = [
      { label: '主力明盘', value: Number(metrics.latest.listed) || 0 },
      { label: '主力暗盘', value: Number(metrics.latest.grey) || 0 },
      { label: '散户流入', value: -(Number(metrics.latest.main) || 0) },
    ];
    const maximum = Math.max(...bars.map((item) => Math.abs(item.value)), 1), zeroY = 826;
    context.strokeStyle = '#89949f'; context.lineWidth = 1; context.beginPath(); context.moveTo(65, zeroY); context.lineTo(685, zeroY); context.stroke();
    bars.forEach((bar, index) => {
      const x = 145 + index * 215, barHeight = Math.max(18, Math.round(Math.abs(bar.value) / maximum * 125));
      context.fillStyle = valueColor(bar.value); roundRect(x - 24, bar.value >= 0 ? zeroY - barHeight : zeroY, 48, barHeight, 5); context.fill();
      fillText(metrics.barTexts[index] || exactAmount(bar.value), x, bar.value >= 0 ? zeroY - barHeight - 25 : zeroY + barHeight + 25, 20, valueColor(bar.value), '700', 'center');
      fillText(bar.label, x, 1005, 21, '#d7dee6', '400', 'center');
    });
    roundRect(34, 1062, 682, 226, 24); context.fillStyle = 'rgba(13,17,24,.94)'; context.fill(); context.strokeStyle = 'rgba(255,57,64,.42)'; context.stroke();
    context.save();
    const chartGlow = context.createRadialGradient(648, 1084, 4, 648, 1084, 108);
    chartGlow.addColorStop(0, 'rgba(255,35,46,.34)'); chartGlow.addColorStop(1, 'rgba(255,35,46,0)');
    context.fillStyle = chartGlow; context.fillRect(520, 1065, 180, 116);
    context.globalAlpha = .25; context.lineWidth = 1;
    [1082, 1112, 1142, 1172].forEach((y) => {
      context.strokeStyle = '#ad4650'; context.beginPath(); context.moveTo(526, y); context.lineTo(696, y); context.stroke();
    });
    [535, 575, 615, 655, 695].forEach((x) => {
      context.strokeStyle = '#71323a'; context.beginPath(); context.moveTo(x, 1072); context.lineTo(x, 1174); context.stroke();
    });
    context.globalAlpha = .9;
    [
      { x: 540, high: 1127, low: 1160, top: 1138, bottom: 1152, color: '#00d7a0' },
      { x: 565, high: 1118, low: 1151, top: 1127, bottom: 1144, color: '#ff3b43' },
      { x: 590, high: 1125, low: 1155, top: 1133, bottom: 1147, color: '#00d7a0' },
      { x: 615, high: 1099, low: 1140, top: 1109, bottom: 1132, color: '#ff3b43' },
      { x: 640, high: 1084, low: 1125, top: 1094, bottom: 1118, color: '#ff3b43' },
      { x: 665, high: 1071, low: 1109, top: 1080, bottom: 1102, color: '#ff3b43' },
    ].forEach((candle) => {
      context.strokeStyle = candle.color; context.lineWidth = 2; context.beginPath(); context.moveTo(candle.x, candle.high); context.lineTo(candle.x, candle.low); context.stroke();
      context.fillStyle = candle.color; roundRect(candle.x - 6, candle.top, 12, Math.max(5, candle.bottom - candle.top), 2); context.fill();
    });
    context.globalAlpha = 1; context.strokeStyle = '#ff343e'; context.lineWidth = 3;
    context.shadowColor = 'rgba(255,35,46,.9)'; context.shadowBlur = 10;
    context.beginPath(); context.moveTo(532, 1152); context.bezierCurveTo(565, 1138, 580, 1147, 603, 1129); context.bezierCurveTo(626, 1110, 651, 1093, 686, 1074); context.stroke();
    context.shadowColor = 'transparent'; context.fillStyle = '#ff343e'; context.beginPath(); context.moveTo(686, 1074); context.lineTo(671, 1077); context.lineTo(681, 1089); context.closePath(); context.fill();
    context.restore();
    const footerTextX = assets.withoutQr ? 64 : 254;
    if (!assets.withoutQr) {
      roundRect(54, 1090, 148, 148, 16); context.fillStyle = '#fff'; context.fill();
      context.drawImage(assets.qrImage, 60, 1096, 136, 136);
      context.strokeStyle = 'rgba(255,255,255,.24)'; context.lineWidth = 1; context.beginPath(); context.moveTo(226, 1092); context.lineTo(226, 1248); context.stroke();
    }
    fillText('搜索“指标仓库”小程序', footerTextX, 1096, 29, '#fff', '800');
    fillText('查看7天暗盘数据', footerTextX, 1139, 21, '#d0d6dd', '600');
    fillText('实时追踪主力资金动向', footerTextX, 1168, 18, '#9faab6');
    const ctaX = assets.withoutQr ? 62 : 250;
    const ctaWidth = assets.withoutQr ? 630 : 442;
    const callToAction = context.createLinearGradient(ctaX, 1190, ctaX + ctaWidth, 1248);
    callToAction.addColorStop(0, '#ff4b50'); callToAction.addColorStop(.45, '#ff3039'); callToAction.addColorStop(1, '#c91422');
    context.save(); context.shadowColor = 'rgba(255,35,47,.68)'; context.shadowBlur = 16; context.shadowOffsetY = 4;
    roundRect(ctaX, 1188, ctaWidth, 62, 17); context.fillStyle = callToAction; context.fill(); context.restore();
    roundRect(ctaX, 1188, ctaWidth, 62, 17); context.strokeStyle = 'rgba(255,150,154,.8)'; context.lineWidth = 1.5; context.stroke();
    const ctaHighlight = context.createLinearGradient(0, 1189, 0, 1210); ctaHighlight.addColorStop(0, 'rgba(255,255,255,.25)'); ctaHighlight.addColorStop(1, 'rgba(255,255,255,0)');
    roundRect(ctaX + 5, 1193, ctaWidth - 10, 23, 12); context.fillStyle = ctaHighlight; context.fill();
    fillText(assets.withoutQr ? '分享暗盘数据，关注“指标仓库”小程序' : '长按识别小程序码，查看个股暗盘数据', ctaX + 20, 1219, 18, '#fff', '600');
    context.beginPath(); context.arc(ctaX + ctaWidth - 26, 1219, 15, 0, Math.PI * 2); context.fillStyle = 'rgba(90,0,7,.24)'; context.fill();
    fillText('›', ctaX + ctaWidth - 25, 1217, 30, '#fff', '600', 'center');
    fillText('数据来自互联网，仅供参考，不构成投资建议', 375, 1310, 16, '#647180', '400', 'center');
  },
});
