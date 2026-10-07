const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchThsHotList, generateRanking, isCloseRankingResult, normalizeCandidates, normalizeThsHotListResponse, publicRanking, rankingTitle } = require('../src/dark-fund-ranking');
const { chinaMinutes, parseSchedule } = require('../src/dark-fund-ranking-sync');

function closeResult(stockCode, stockName, tradeDate, grey) {
  return {
    type: 'close_snapshot', validationVersion: 2, stockCode, stockName, stockInitials: '',
    tradeDate, versionKey: `${tradeDate}Tclose`, versionLabel: '收盘', kind: 'close',
    days: [{ tradeDate, main: grey, grey, listed: 0, super_large: 0, large: 0, middle: 0, small: -grey }],
  };
}

test('hot-list candidates are deduplicated and validated through the stock map', () => {
  const rows = normalizeCandidates({ stocks: [
    { stockCode: '600105', rank: 1 },
    { code: 'sh600105', rank: 2 },
    { ticker: '600159', rank: 3 },
    { code: '920001', rank: 4 },
    { code: '999999', rank: 5 },
  ] });
  assert.deepEqual(rows.map((item) => item.stockCode), ['600105', '600159']);
  assert.equal(rows[0].stockDisplayName, '永鼎GF');
});

test('THS hot-list response is converted to ranking candidates', async () => {
  const source = normalizeThsHotListResponse({
    status_code: 0,
    data: { stock_list: [
      { code: '600105', name: '永鼎股份', order: 1 },
      { code: '600159', name: '大龙地产', order: 2 },
    ] },
  });
  assert.equal(source.source, '同花顺热榜-24小时');
  assert.deepEqual(source.stocks.map((item) => item.stockCode), ['600105', '600159']);
  const fetched = await fetchThsHotList({
    fetchImpl: async (url, options) => {
      assert.match(url, /10jqka\.com\.cn/);
      assert.match(options.headers.Referer, /10jqka/);
      return { ok: true, json: async () => ({ status_code: 0, data: { stock_list: [{ code: '600105', name: '永鼎股份', order: 1 }] } }) };
    },
  });
  assert.equal(fetched.stocks[0].stockCode, '600105');
});

test('daily ranking scheduler uses Beijing time and the 15:30 post-close slot', () => {
  assert.equal(parseSchedule('15:30'), 15 * 60 + 30);
  assert.equal(parseSchedule('bad-value'), 15 * 60 + 30);
  assert.equal(chinaMinutes(Date.parse('2026-09-30T07:30:00Z')), 15 * 60 + 30);
});

test('ranking title keeps the previous trading day visible before 15:30', () => {
  assert.equal(rankingTitle('2026-09-29'), '9月29日暗盘榜');
  const ranking = { tradeDate: '2026-09-29', results: {}, inflow: [], outflow: [] };
  const beforeClose = publicRanking(ranking, Date.parse('2026-09-30T06:00:00Z'));
  const afterClose = publicRanking(ranking, Date.parse('2026-09-30T07:31:00Z'));
  assert.equal(beforeClose.title, '9月29日暗盘榜');
  assert.equal(beforeClose.updateHint, '当天收盘后更新');
  assert.equal(afterClose.updateHint, '今日榜单更新中');
});

test('daily ranking reuses same-day close cache and sorts inflow/outflow', async () => {
  const tradeDate = '2026-09-30';
  const cached = closeResult('600105', '永鼎股份', tradeDate, -70000000);
  const data = {
    darkFundCloseCache: {
      600105: { stockCode: '600105', tradeDate, result: cached },
    },
  };
  let fetchCount = 0;
  const ranking = await generateRanking({
    data,
    tradeDate,
    payload: { stocks: [{ stockCode: '600105' }, { stockCode: '600159' }] },
    fetchClose: async (stockCode) => {
      fetchCount += 1;
      return closeResult(stockCode, '大龙地产', tradeDate, 90000000);
    },
  });
  assert.equal(fetchCount, 1);
  assert.equal(ranking.cacheHitCount, 1);
  assert.equal(ranking.inflow[0].stockCode, '600159');
  assert.equal(ranking.outflow[0].stockCode, '600105');
  assert.equal(publicRanking(ranking).results, undefined);
  assert(data.darkFundRankings[tradeDate]);
});

test('daily ranking only accepts close snapshots and excludes intraday collector data', async () => {
  const tradeDate = '2026-09-30';
  const intraday = {
    ...closeResult('600105', '永鼎股份', tradeDate, 70000000),
    type: 'collector_result',
    kind: 'intraday',
  };
  assert.equal(isCloseRankingResult(intraday, '600105', tradeDate), false);
  const ranking = await generateRanking({
    data: {},
    tradeDate,
    payload: { stocks: [{ stockCode: '600105' }] },
    fetchClose: async () => intraday,
  });
  assert.equal(ranking.successCount, 0);
  assert.equal(ranking.inflow.length, 0);
  assert.equal(ranking.outflow.length, 0);
  assert.match(ranking.failed[0].error, /收盘盘后查询结果/);
});

test('daily ranking reports durable per-stock progress during a serial batch', async () => {
  const tradeDate = '2026-09-30';
  const progress = [];
  const ranking = await generateRanking({
    data: {},
    tradeDate,
    concurrency: 1,
    payload: { stocks: [{ stockCode: '600105' }, { stockCode: '600159' }] },
    fetchClose: async (stockCode) => closeResult(stockCode, stockCode === '600105' ? '永鼎股份' : '大龙地产', tradeDate, 10000000),
    onProgress: async (value) => progress.push({ ...value }),
  });
  assert.equal(ranking.successCount, 2);
  assert.equal(progress.length, 4);
  assert.equal(progress[0].phase, 'querying');
  assert.equal(progress[0].currentStockCode, '600105');
  assert.equal(progress[1].processedCount, 1);
  assert.equal(progress[3].processedCount, 2);
  assert.equal(progress[3].successCount, 2);
  assert.equal(progress[3].candidateCount, 2);
});
