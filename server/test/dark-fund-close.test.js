const test = require('node:test');
const assert = require('node:assert/strict');
const { SAMPLE_CLOSE_PAYLOAD, exactSearchStock, normalizeCloseDarkFund } = require('../src/dark-fund-close');

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
  assert.throws(() => normalizeCloseDarkFund(invalid, '600105'), /加总存在误差/);
});

test('盘后搜索结果按六位代码精确匹配', () => {
  const hit = exactSearchStock([
    { code: 'sh600104', name: '上汽集团' },
    { code: 'sh600105', name: '永鼎股份' },
  ], '600105');
  assert.equal(hit.code, 'sh600105');
  assert.equal(exactSearchStock([{ code: 'sh600104' }], '600105'), null);
});
