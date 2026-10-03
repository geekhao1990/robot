const { isReusableCloseResult } = require('./dark-fund-close');
const { lookupStock } = require('./stock-lookup');

const MAX_CANDIDATES = 30;
const THS_HOT_LIST_URL = 'https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock?list_type=normal&stock_type=a&type=day';

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
    });
  });
  if (!candidates.length) throw Object.assign(new Error('热榜 JSON 没有匹配到本地股票 Map'), { status: 400 });
  if (candidates.length > MAX_CANDIDATES) candidates.length = MAX_CANDIDATES;
  return candidates;
}

function cachedCloseResult(data, stockCode, tradeDate) {
  const entry = data.darkFundCloseCache && data.darkFundCloseCache[stockCode];
  const result = entry && (entry.result || entry);
  if (!result || !isReusableCloseResult(result, stockCode) || String(result.tradeDate || '') !== tradeDate) return null;
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

function rankingItem(candidate, result, cacheHit) {
  const days = Array.isArray(result.days) ? result.days : [];
  const day = days.find((item) => String(item.tradeDate || '') === String(result.tradeDate || ''))
    || days.slice().sort((a, b) => String(b.tradeDate || '').localeCompare(String(a.tradeDate || '')))[0];
  if (!day || !Number.isFinite(Number(day.grey))) throw new Error('返回结果缺少当日暗盘资金');
  return {
    stockCode: candidate.stockCode,
    stockName: result.stockName || candidate.stockName,
    stockDisplayName: candidate.stockDisplayName,
    hotRank: candidate.hotRank,
    grey: Number(day.grey),
    cacheHit,
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

async function generateRanking({ data, payload, tradeDate, fetchClose, concurrency = 3 }) {
  const candidates = normalizeCandidates(payload);
  const processed = await mapConcurrent(candidates, concurrency, async (candidate) => {
    try {
      let result = cachedCloseResult(data, candidate.stockCode, tradeDate);
      const cacheHit = Boolean(result);
      if (!result) {
        result = await fetchClose(candidate.stockCode);
        if (String(result && result.tradeDate || '') !== tradeDate || String(result && result.kind || '') !== 'close') {
          throw new Error(`盘后数据不是${tradeDate}收盘结果`);
        }
        storeCloseResult(data, candidate.stockCode, result);
      }
      return { ok: true, item: rankingItem(candidate, result, cacheHit) };
    } catch (error) {
      return { ok: false, stockCode: candidate.stockCode, stockName: candidate.stockName, error: String(error && error.message || '查询失败').slice(0, 200) };
    }
  });
  const successful = processed.filter((item) => item.ok).map((item) => item.item);
  const publicItem = (item) => ({
    stockCode: item.stockCode,
    stockName: item.stockName,
    stockDisplayName: item.stockDisplayName,
    hotRank: item.hotRank,
    grey: item.grey,
    cacheHit: item.cacheHit,
  });
  const ranking = {
    tradeDate,
    source: '同花顺热榜',
    generatedAt: Date.now(),
    candidateCount: candidates.length,
    successCount: successful.length,
    cacheHitCount: successful.filter((item) => item.cacheHit).length,
    inflow: successful.filter((item) => item.grey > 0).sort((a, b) => b.grey - a.grey).slice(0, 5).map(publicItem),
    outflow: successful.filter((item) => item.grey < 0).sort((a, b) => a.grey - b.grey).slice(0, 5).map(publicItem),
    failed: processed.filter((item) => !item.ok),
    results: Object.fromEntries(successful.map((item) => [item.stockCode, item.result])),
  };
  data.darkFundRankings = data.darkFundRankings && typeof data.darkFundRankings === 'object' ? data.darkFundRankings : {};
  data.darkFundRankings[tradeDate] = ranking;
  data.latestDarkFundRankingDate = tradeDate;
  return ranking;
}

function publicRanking(ranking) {
  if (!ranking) return null;
  const { results, ...visible } = ranking;
  return JSON.parse(JSON.stringify(visible));
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
  latestRanking,
  normalizeCandidates,
  normalizeThsHotListResponse,
  publicRanking,
};
