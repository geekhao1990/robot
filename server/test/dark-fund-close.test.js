const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SAMPLE_CLOSE_PAYLOAD,
  exactSearchStock,
  isReusableCloseResult,
  nextTradingOpenAt,
  normalizeCloseDarkFund,
  searchCloseStock,
} = require('../src/dark-fund-close');

test('盘后暗盘 JSON 被标准化为独立快照结果', () => {
  const result = normalizeCloseDarkFund(SAMPLE_CLOSE_PAYLOAD, '600105');
  assert.equal(result.type, 'close_snapshot');
  assert.equal(result.stockCode, '600105');
  assert.equal(result.stockName, '永鼎股份');
  assert.equal(result.tradeDate, '2026-09-30');
  assert.equal(result.days.length, 7);
  assert.equal(result.days[6].tradeDate, '2026-09-30');
  assert.equal(result.days[6].grey + result.days[6].listed, result.days[6].main);
});

test('盘后暗盘 JSON 拒绝错股和明暗资金误差', () => {
  assert.throws(() => normalizeCloseDarkFund(SAMPLE_CLOSE_PAYLOAD, '600106'), /代码不匹配/);
  const invalid = JSON.parse(JSON.stringify(SAMPLE_CLOSE_PAYLOAD));
  invalid.days[0].grey = 1;
  assert.throws(() => normalizeCloseDarkFund(invalid, '600105'), /误差超过2%/);
});

test('盘后暗盘逐日允许2%以内误差并拒绝任意一天的过大误差', () => {
  const rounding = JSON.parse(JSON.stringify(SAMPLE_CLOSE_PAYLOAD));
  rounding.days[2].grey += Math.abs(rounding.days[2].main) * 0.019;
  assert.doesNotThrow(() => normalizeCloseDarkFund(rounding, '600105'));
  rounding.days[4].grey += Math.abs(rounding.days[4].main) * 0.021;
  assert.throws(() => normalizeCloseDarkFund(rounding, '600105'), /误差超过2%/);
});

test('收盘结果缓存持续到下一个交易日开市前', () => {
  const result = normalizeCloseDarkFund(SAMPLE_CLOSE_PAYLOAD, '600105');
  const openAt = nextTradingOpenAt(result.tradeDate);
  assert.equal(openAt, Date.parse('2026-10-08T01:30:00Z'));
  assert.equal(isReusableCloseResult(result, '600105', openAt - 1), true);
  assert.equal(isReusableCloseResult(result, '600105', openAt), false);
  assert.equal(isReusableCloseResult(result, '600106', openAt - 1), false);
});

test('盘后搜索结果按六位代码精确匹配', () => {
  const hit = exactSearchStock([
    { code: 'sh600104', name: '上汽集团' },
    { code: 'sh600105', name: '永鼎股份' },
  ], '600105');
  assert.equal(hit.code, 'sh600105');
  assert.equal(exactSearchStock([{ code: 'sh600104' }], '600105'), null);
});

test('盘后股票搜索失败只请求一次', async () => {
  let requestCount = 0;
  await assert.rejects(searchCloseStock('600105', async () => {
    requestCount += 1;
    return [];
  }), { status: 404 });
  assert.equal(requestCount, 1);
});
