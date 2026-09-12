const crypto = require('crypto');
const { compactDate } = require('./trading-date');
const { attachOrderContext, buildDarkFundReport, normalizeAnalysis } = require('./deepseek-vision');

const DARK_FUND_AUTHOR_ID = 'u1787979756047';
const AI_AUTO_COMPLETE_DELAY_MS = 3 * 60 * 1000;

function defaultDarkFundCopy(order) {
  const parts = String(order.tradeDate || '').split('-').map(Number);
  const date = parts.length === 3 && parts.every(Number.isFinite)
    ? `${parts[0]}年${parts[1]}月${parts[2]}日`
    : String(order.tradeDate || '');
  return `${date}，${order.stockCode}暗盘资金查询结果。\n\n风险提示：以上分析结果仅代表大模型观点，仅供参考，不作为投资建议。`;
}

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

function activateDarkFundOrder(data, order, transactionId, readyAt = Date.now()) {
  if (order.status === 'READY' || order.status === 'SUCCESS') return false;
  const shortDate = compactDate(order.tradeDate);
  const author = ensureDarkFundAuthor(data);
  order.status = 'READY';
  order.paidAt = readyAt;
  order.readyAt = readyAt;
  order.viewedAt = 0;
  order.transactionId = transactionId || order.transactionId || '';
  const images = Array.isArray(order.snapshotImages) ? order.snapshotImages.slice() : [];
  const note = {
    id: `dark_${order.id}`,
    visibility: 'public',
    title: `${order.stockCode}｜${shortDate}暗盘数据`,
    content: order.snapshotText || defaultDarkFundCopy(order),
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
    version: 1,
    product: '六位神奇数字',
    stockCode: order.stockCode,
    tradeDate: order.tradeDate,
    compactTradeDate: shortDate,
    generatedAt: readyAt,
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
    noteId: order.noteId || (order.snapshot && order.snapshot.note && order.snapshot.note.id) || '',
    snapshot: order.snapshot || null,
  };
}

function prepareAiAutoCompletion(order, now = Date.now()) {
  if (!order || !order.aiAnalysis || !order.aiImageUrl) return false;
  const normalized = attachOrderContext(normalizeAnalysis(order.aiAnalysis), order);
  order.aiAnalysis = normalized;
  if (!normalized.validation || normalized.validation.passed !== true) {
    order.aiReviewStatus = 'QUESTIONABLE';
    order.aiAutoCompleteAt = 0;
    return false;
  }
  order.aiDraftText = buildDarkFundReport(normalized);
  order.aiReviewStatus = 'PASS';
  const reviewedAt = Number(order.aiReviewedAt) || now;
  order.aiAutoCompleteAt = Number(order.aiAutoCompleteAt) || reviewedAt + AI_AUTO_COMPLETE_DELAY_MS;
  return Boolean(order.aiDraftText);
}

function processDueAiWorkOrders(data, now = Date.now()) {
  let prepared = 0;
  let completed = 0;
  (data.darkFundOrders || []).forEach((order) => {
    if (!order || order.status === 'READY' || order.status === 'SUCCESS') return;
    // 仅处理新流程明确排定的工单，避免升级时误完成历史测试数据。
    if (!Number(order.aiAutoCompleteAt)) return;
    const before = JSON.stringify({
      aiAnalysis: order.aiAnalysis,
      aiDraftText: order.aiDraftText,
      aiReviewStatus: order.aiReviewStatus,
      aiAutoCompleteAt: order.aiAutoCompleteAt,
    });
    if (!prepareAiAutoCompletion(order, now)) return;
    const after = JSON.stringify({
      aiAnalysis: order.aiAnalysis,
      aiDraftText: order.aiDraftText,
      aiReviewStatus: order.aiReviewStatus,
      aiAutoCompleteAt: order.aiAutoCompleteAt,
    });
    if (before !== after) prepared += 1;
    if (order.aiAutoCompleteAt > now) return;
    order.snapshotImages = [order.aiImageUrl];
    order.snapshotText = order.aiDraftText;
    if (activateDarkFundOrder(data, order, 'AI_AUTO', now)) completed += 1;
  });
  return { prepared, completed };
}

module.exports = {
  AI_AUTO_COMPLETE_DELAY_MS,
  activateDarkFundOrder,
  prepareAiAutoCompletion,
  processDueAiWorkOrders,
  publicDarkFundOrder,
};
