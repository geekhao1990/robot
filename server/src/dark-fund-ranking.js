const { lookupStock } = require('./stock-lookup');
const { chinaToday, isTradingDay } = require('./trading-date');

const MAX_CANDIDATES = 100;
const THS_HOT_LIST_URL = 'https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock?list_type=normal&stock_type=a&type=day';

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeThsHotListResponse(payload) {
  const rows = payload && payload.data && payload.data.stock_list;
  if (Number(payload && payload.status_code) !== 0 || !Array.isArray(rows) || !rows.length) {
    throw Object.assign(new Error('同花顺热榜接口未返回股票列表'), { status: 502 });
  }
  return {
    source: '同花顺热榜-24小时',
    fetchedAt: Date.now(),
    stocks: rows.slice(0, MAX_CANDIDATES).map((item, index) => ({
      stockCode: String(item && item.code || '').trim(),
      stockName: String(item && item.name || '').trim(),
      rank: Number(item && item.order) || index + 1,
      changePercent: finiteNumberOrNull(item && item.rise_and_fall),
    })),
  };
}

async function fetchThsHotList({ timeoutMs = 15000, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw Object.assign(new Error('当前 Node 环境不支持网络请求'), { status: 500 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(THS_HOT_LIST_URL, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        Referer: 'https://eq.10jqka.com.cn/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw Object.assign(new Error(`同花顺热榜请求失败（HTTP ${response.status}）`), { status: 502 });
    return normalizeThsHotListResponse(await response.json());
  } catch (error) {
    if (error && error.name === 'AbortError') throw Object.assign(new Error('同花顺热榜请求超时'), { status: 504 });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function candidateRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  return payload.stocks || payload.items || payload.list || payload.data || [];
}

function normalizeCandidates(payload) {
  const seen = new Set();
  const rows = candidateRows(payload);
  if (!Array.isArray(rows)) throw Object.assign(new Error('热榜 JSON 中未找到股票列表'), { status: 400 });
  const candidates = [];
  rows.forEach((row, index) => {
    const stockCode = String(typeof row === 'string' ? row : (row.stockCode || row.code || row.ticker || '')).replace(/^(sh|sz)/i, '').trim();
    if (!/^\d{6}$/.test(stockCode) || /^(4|8|92)/.test(stockCode) || seen.has(stockCode)) return;
    let mapped;
    try { mapped = lookupStock(stockCode); } catch (error) { return; }
    if (!mapped.matched) return;
    seen.add(stockCode);
    candidates.push({
      stockCode,
      stockName: mapped.stockName,
      stockDisplayName: mapped.stockDisplayName,
      hotRank: Number(typeof row === 'object' && (row.hotRank || row.rank || row.order)) || index + 1,
      changePercent: finiteNumberOrNull(typeof row === 'object'
        ? (row.changePercent ?? row.rise_and_fall ?? row.pct_change)
        : null),
    });
  });
  if (!candidates.length) throw Object.assign(new Error('热榜 JSON 没有匹配到本地股票 Map'), { status: 400 });
  if (candidates.length > MAX_CANDIDATES) candidates.length = MAX_CANDIDATES;
  return candidates;
}

function cachedCloseResult(data, stockCode, tradeDate) {
  const entry = data.darkFundCloseCache && data.darkFundCloseCache[stockCode];
  const result = entry && (entry.result || entry);
  // 榜单重跑按指定交易日复用精确的收盘快照，不受“下个交易日开盘前”这一用户查询缓存窗口影响。
  if (!result || !isCloseRankingResult(result, stockCode, tradeDate)) return null;
  return JSON.parse(JSON.stringify(result));
}

function storeCloseResult(data, stockCode, result) {
  data.darkFundCloseCache = data.darkFundCloseCache && typeof data.darkFundCloseCache === 'object' ? data.darkFundCloseCache : {};
  data.darkFundCloseCache[stockCode] = {
    stockCode,
    versionKey: String(result.versionKey || ''),
    tradeDate: String(result.tradeDate || ''),
    cachedAt: Date.now(),
    result: JSON.parse(JSON.stringify(result)),
  };
}

function isCloseRankingResult(result, stockCode, tradeDate) {
  const normalizedCode = (value) => String(value || '').replace(/^(sh|sz)/i, '');
  return Boolean(result
    && result.type === 'close_snapshot'
    && Number(result.validationVersion) >= 2
    && String(result.kind || '').toLowerCase() === 'close'
    && normalizedCode(result.stockCode) === normalizedCode(stockCode)
    && String(result.tradeDate || '') === String(tradeDate || ''));
}

function closeDayFunds(result, tradeDate) {
  const days = Array.isArray(result && result.days) ? result.days : [];
  const day = days.find((item) => String(item.tradeDate || '') === String(tradeDate || ''))
    || days.slice().sort((a, b) => String(b.tradeDate || '').localeCompare(String(a.tradeDate || '')))[0];
  if (!day) return {};
  const numberOrNull = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
  const main = numberOrNull(day.main);
  const grey = numberOrNull(day.grey);
  const listed = numberOrNull(day.listed);
  const middle = numberOrNull(day.middle);
  const small = numberOrNull(day.small);
  const retail = middle !== null && small !== null
    ? middle + small
    : (main !== null ? -main : null);
  return { main, grey, listed, retail };
}

function rankingItem(candidate, result, cacheHit) {
  if (!isCloseRankingResult(result, candidate.stockCode, result && result.tradeDate)) {
    throw new Error('今日暗盘榜仅允许收盘普通查询结果');
  }
  const funds = closeDayFunds(result, result.tradeDate);
  if (!Number.isFinite(funds.grey)) throw new Error('返回结果缺少当日暗盘资金');
  return {
    stockCode: candidate.stockCode,
    stockName: result.stockName || candidate.stockName,
    stockDisplayName: candidate.stockDisplayName,
    hotRank: candidate.hotRank,
    changePercent: candidate.changePercent,
    ...funds,
    cacheHit,
    queryMode: 'close',
    querySource: 'web',
    result: JSON.parse(JSON.stringify(result)),
  };
}

async function mapConcurrent(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return output;
}

async function generateRanking({ data, payload, tradeDate, fetchClose, concurrency = 3, onProgress = null }) {
  const candidates = normalizeCandidates(payload);
  let processedCount = 0;
  let successCount = 0;
  let failureCount = 0;
  let cacheHitCount = 0;
  let lastError = '';
  const processed = await mapConcurrent(candidates, concurrency, async (candidate) => {
    let outcome;
    if (typeof onProgress === 'function') {
      await onProgress({
        phase: 'querying',
        processedCount,
        candidateCount: candidates.length,
        successCount,
        failureCount,
        cacheHitCount,
        currentStockCode: candidate.stockCode,
        currentStockName: candidate.stockName,
        lastError,
        updatedAt: Date.now(),
      });
    }
    try {
      let result = cachedCloseResult(data, candidate.stockCode, tradeDate);
      const cacheHit = Boolean(result);
      if (!result) {
        result = await fetchClose(candidate.stockCode);
        if (!isCloseRankingResult(result, candidate.stockCode, tradeDate)) {
          throw new Error(`盘后数据不是${tradeDate}收盘普通查询结果`);
        }
        storeCloseResult(data, candidate.stockCode, result);
      }
      outcome = { ok: true, item: rankingItem(candidate, result, cacheHit) };
    } catch (error) {
      outcome = { ok: false, stockCode: candidate.stockCode, stockName: candidate.stockName, error: String(error && error.message || '查询失败').slice(0, 200) };
    }
    processedCount += 1;
    if (outcome.ok) {
      successCount += 1;
      if (outcome.item.cacheHit) cacheHitCount += 1;
    } else {
      failureCount += 1;
      lastError = outcome.error;
    }
    if (typeof onProgress === 'function') {
      await onProgress({
        phase: 'completed',
        processedCount,
        candidateCount: candidates.length,
        successCount,
        failureCount,
        cacheHitCount,
        currentStockCode: candidate.stockCode,
        currentStockName: candidate.stockName,
        lastError,
        updatedAt: Date.now(),
      });
    }
    return outcome;
  });
  const successful = processed.filter((item) => item.ok).map((item) => item.item);
  const publicItem = (item) => ({
    stockCode: item.stockCode,
    stockName: item.stockName,
    stockDisplayName: item.stockDisplayName,
    hotRank: item.hotRank,
    changePercent: item.changePercent,
    main: item.main,
    grey: item.grey,
    listed: item.listed,
    retail: item.retail,
    cacheHit: item.cacheHit,
    queryMode: item.queryMode,
    querySource: item.querySource,
  });
  const ranking = {
    tradeDate,
    source: '同花顺热榜',
    generatedAt: Date.now(),
    candidateCount: candidates.length,
    successCount: successful.length,
    cacheHitCount: successful.filter((item) => item.cacheHit).length,
    inflow: successful.filter((item) => item.grey > 0).sort((a, b) => b.grey - a.grey).slice(0, 10).map(publicItem),
    outflow: successful.filter((item) => item.grey < 0).sort((a, b) => a.grey - b.grey).slice(0, 10).map(publicItem),
    failed: processed.filter((item) => !item.ok),
    results: Object.fromEntries(successful.map((item) => [item.stockCode, item.result])),
  };
  data.darkFundRankings = data.darkFundRankings && typeof data.darkFundRankings === 'object' ? data.darkFundRankings : {};
  data.darkFundRankings[tradeDate] = ranking;
  data.latestDarkFundRankingDate = tradeDate;
  return ranking;
}

function beijingMinutes(timestamp = Date.now()) {
  const date = new Date(timestamp + 8 * 3600 * 1000);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function rankingTitle(tradeDate) {
  const match = String(tradeDate || '').match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!match) return '收盘暗盘榜';
  return `${Number(match[1])}月${Number(match[2])}日暗盘榜`;
}

function publicRanking(ranking, timestamp = Date.now()) {
  if (!ranking) return null;
  const { results, ...visible } = ranking;
  const validCodes = new Set(Object.entries(results || {})
    .filter(([stockCode, result]) => isCloseRankingResult(result, stockCode, ranking.tradeDate))
    .map(([stockCode]) => stockCode));
  const today = chinaToday(timestamp);
  const waitingForToday = isTradingDay(today) && String(ranking.tradeDate || '') !== today;
  const hydrate = (item) => ({
    ...item,
    ...closeDayFunds(results && results[String(item.stockCode || '')], ranking.tradeDate),
  });
  return JSON.parse(JSON.stringify({
    ...visible,
    inflow: (visible.inflow || []).filter((item) => validCodes.has(String(item.stockCode || ''))).map(hydrate),
    outflow: (visible.outflow || []).filter((item) => validCodes.has(String(item.stockCode || ''))).map(hydrate),
    title: rankingTitle(ranking.tradeDate),
    updateHint: waitingForToday
      ? (beijingMinutes(timestamp) < 15 * 60 + 30 ? '当天收盘后更新' : '今日榜单更新中')
      : '',
  }));
}

function latestRanking(data) {
  const rankings = data.darkFundRankings || {};
  const date = String(data.latestDarkFundRankingDate || Object.keys(rankings).sort().pop() || '');
  return rankings[date] || null;
}

module.exports = {
  MAX_CANDIDATES,
  THS_HOT_LIST_URL,
  fetchThsHotList,
  generateRanking,
  isCloseRankingResult,
  latestRanking,
  normalizeCandidates,
  normalizeThsHotListResponse,
  publicRanking,
  rankingTitle,
};
