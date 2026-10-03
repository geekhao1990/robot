const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchThsHotList, generateRanking, normalizeCandidates, normalizeThsHotListResponse, publicRanking } = require('../src/dark-fund-ranking');
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

test('daily ranking scheduler uses Beijing time and a configurable post-close slot', () => {
  assert.equal(parseSchedule('16:35'), 16 * 60 + 35);
  assert.equal(parseSchedule('bad-value'), 16 * 60 + 35);
  assert.equal(chinaMinutes(Date.parse('2026-09-30T08:35:00Z')), 16 * 60 + 35);
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
