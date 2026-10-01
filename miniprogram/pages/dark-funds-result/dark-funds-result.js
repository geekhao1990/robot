const api = require('../../utils/api');

const YELLOW = '#ffe50a';
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
  },
  onLoad(options) {
    if (String(options && options.mock || '') === '1') {
      this.applyResult(createMockCloseResult(options));
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
  applyResult(result) {
    const days = result.days.slice().sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
    result.days = days;
    const latest = days[days.length - 1];
    const unit = chooseUnit([latest.main, latest.listed, latest.grey]);
    const main = Number(latest.main) || 0;
    const summary = [
      { label: '主力净流入', value: main },
      { label: '散户流入', value: -main },
    ].map((item) => ({ ...item, text: formatByUnit(item.value, unit), positive: item.value >= 0 }));
    const dayBars = withBars([
      { label: '主力明盘', value: Number(latest.listed) || 0, text: formatByUnit(latest.listed, unit) },
      { label: '主力暗盘', value: Number(latest.grey) || 0, text: formatByUnit(latest.grey, unit) },
      { label: '散户流入', value: -main, text: formatByUnit(-main, unit) },
    ]);
    const rows = days.slice().reverse().slice(0, 7).map((row) => ({
      ...row,
      displayDate: row.tradeDate.slice(5),
      ...formatGroup(row, ['main', 'grey', 'listed']),
      ...formatGroup(row, ['super_large', 'large', 'middle', 'small']),
    }));
    result.displayName = hybridStockName(result.stockName, result.stockInitials);
    result.displayCode = marketStockCode(result.stockCode);
    this.trends = { trend3: rolling(days, 3), trend5: rolling(days, 5) };
    this.setData({ loading: false, result, unitLabel: unit.label, summary, dayBars, rows });
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
      context.fillStyle = TREND_AREA_GREEN;
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
});
