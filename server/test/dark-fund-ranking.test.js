const test = require('node:test');
const assert = require('node:assert/strict');
const { generateRanking, normalizeCandidates, publicRanking } = require('../src/dark-fund-ranking');

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
