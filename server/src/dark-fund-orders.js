const crypto = require('crypto');
const { compactDate } = require('./trading-date');

const DARK_FUND_AUTHOR_ID = 'u1787979756047';

function ensureDarkFundAuthor(data) {
  let author = data.users.find((item) => item.id === DARK_FUND_AUTHOR_ID);
  if (!author) {
    author = {
      id: DARK_FUND_AUTHOR_ID,
      name: '暗盘',
      avatar: '/images/profile-dark-funds.png',
      desc: '暗盘资金数据',
      fans: 0,
      follows: 0,
      likes: 0,
      vip: false,
      vipPlan: '',
      vipExpire: 0,
      vipPermanent: false,
      official: true,
      darkFundEnabled: false,
      darkFundRemaining: 0,
      darkFundManualRemaining: 0,
      darkFundVipRemaining: 0,
      darkFundVipMonth: '',
      createdAt: Date.now(),
      tags: [],
    };
    data.users.push(author);
  }
  author.name = '暗盘';
  author.official = true;
  return author;
}

function callbackNumber(value, field) {
  if (value === null || value === undefined || value === '') throw new Error(`${field}缺失`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${field}格式不正确`);
  return number;
}

function normalizeCollectorResult(payload, order) {
  const analysis = payload && payload.analysis && typeof payload.analysis === 'object' ? payload.analysis : {};
  const paragraph1 = String(analysis.paragraph_1 || '').trim();
  const paragraph2 = String(analysis.paragraph_2 || '').trim();
  const paragraph3 = String(analysis.paragraph_3 || '').trim();
  const result = {
    orderId: String(payload.order_id || '').trim(),
    stockCode: String(payload.stock_code || '').trim(),
    stockName: String(payload.stock_name || '').trim(),
    tradingDate: String(payload.trading_date || '').trim(),
    capturedAt: String(payload.captured_at || '').trim(),
    latestPrice: callbackNumber(payload.latest_price, '最新价'),
    pctChange: callbackNumber(payload.pct_change, '涨跌幅'),
    fundUnit: callbackNumber(payload.fund_unit, '资金单位'),
    mainNet: callbackNumber(payload.main_net, '主力净流入'),
    brightNet: callbackNumber(payload.bright_net, '主力明盘'),
    darkNet: callbackNumber(payload.dark_net, '主力暗盘'),
    source: ['cache', 'phone'].includes(String(payload.source || '')) ? String(payload.source) : 'phone',
    analysis: {
      paragraph_1: paragraph1,
      ...(paragraph2 ? { paragraph_2: paragraph2 } : {}),
      paragraph_3: paragraph3,
    },
  };
  if (result.orderId !== order.id) throw new Error('回调订单号不匹配');
  if (result.stockCode !== order.stockCode) throw new Error('回调股票代码不匹配');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result.tradingDate)) throw new Error('交易日格式不正确');
  if (result.tradingDate !== order.tradeDate) throw new Error('回调交易日不匹配');
  if (!result.stockName) throw new Error('股票名称缺失');
  if (![0, 1].includes(result.fundUnit)) throw new Error('资金单位仅允许0（万元）或1（亿元）');
  if (!paragraph1 || !paragraph3) throw new Error('三段论文字不完整');
  const tolerance = Math.max(0.02, Math.abs(result.mainNet) * 0.01);
  if (Math.abs(result.brightNet + result.darkNet - result.mainNet) > tolerance) {
    throw new Error('主力明盘与暗盘加总存在误差');
  }
  return result;
}

function activateDarkFundOrder(data, order, collectorResult, readyAt = Date.now()) {
  if (order.status === 'READY' || order.status === 'SUCCESS') return false;
  const shortDate = compactDate(order.tradeDate);
  const author = ensureDarkFundAuthor(data);
  const result = collectorResult || order.collectorResult;
  if (!result || !result.analysis) throw new Error('采集结果不存在');
  const paragraphs = [result.analysis.paragraph_1, result.analysis.paragraph_2, result.analysis.paragraph_3].filter(Boolean);
  order.status = 'READY';
  order.readyAt = readyAt;
  order.viewedAt = 0;
  order.collectorResult = result;
  order.callbackAt = readyAt;
  const images = [];
  const note = {
    id: `dark_${order.id}`,
    visibility: 'public',
    title: `${result.stockName}（${order.stockCode}）｜${shortDate}暗盘数据`,
    content: paragraphs.join('\n\n'),
    images,
    cover: images[0] || '',
    coverRatio: 1.25,
    authorId: author.id,
    author: { id: author.id, name: '暗盘', avatar: author.avatar || '' },
    category: '资料',
    type: 'material',
    tags: ['暗盘资金', order.stockCode],
    likes: crypto.randomInt(5, 101),
    collects: crypto.randomInt(5, 101),
    riskDisclaimerEnabled: true,
    visible: true,
    free: false,
    video: false,
    time: readyAt,
  };
  order.noteId = note.id;
  order.snapshot = {
    version: 2,
    product: '六位神奇数字',
    stockCode: order.stockCode,
    stockName: result.stockName,
    tradeDate: order.tradeDate,
    compactTradeDate: shortDate,
    generatedAt: readyAt,
    result,
    note,
  };
  data.notes = Array.isArray(data.notes) ? data.notes : [];
  if (!data.notes.some((item) => item.id === note.id)) data.notes.unshift(note);
  return true;
}

function publicDarkFundOrder(order) {
  const ready = order.status === 'READY' || order.status === 'SUCCESS';
  return {
    id: order.id,
    stockCode: order.stockCode,
    tradeDate: order.tradeDate,
    compactTradeDate: compactDate(order.tradeDate),
    amount: order.amount,
    status: order.status,
    ready,
    unread: order.status === 'READY' && !order.viewedAt,
    createdAt: order.createdAt,
    paidAt: order.paidAt || 0,
    readyAt: order.readyAt || order.paidAt || 0,
    viewedAt: order.viewedAt || 0,
    dispatchedAt: order.dispatchedAt || 0,
    failedAt: order.failedAt || 0,
    error: order.status === 'FAILED' || order.status === 'DISPATCH_FAILED'
      ? (order.collectorError || order.dispatchError || '查询失败')
      : '',
    source: order.collectorResult ? order.collectorResult.source : '',
    noteId: order.noteId || (order.snapshot && order.snapshot.note && order.snapshot.note.id) || '',
    snapshot: order.snapshot || null,
  };
}

module.exports = {
  activateDarkFundOrder,
  normalizeCollectorResult,
  publicDarkFundOrder,
};
