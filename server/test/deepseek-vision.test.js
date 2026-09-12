const test = require('node:test');
const assert = require('node:assert/strict');
const { attachOrderContext, classifyDailyFunds, normalizeAnalysis, uploadedImagePath } = require('../src/deepseek-vision');

test('normalizes a valid same-direction outflow result', () => {
  const result = normalizeAnalysis({
    stockName: '华胜天成',
    stockCode: '600410',
    capturedAt: '11:24',
    unit: '亿元',
    mainNet: -16.98,
    visibleNet: -9.73,
    darkNet: -7.25,
    retailNet: 16.98,
  });
  assert.equal(result.relation, '同步流出');
  assert.equal(result.processedResult.fundSituation, '趋势流出');
  assert.equal(result.processedResult.interpretation, '倾向做空');
  assert.equal(result.validation.fundSumPassed, true);
  assert.equal(result.validation.balancePassed, true);
  assert.equal(result.validation.passed, true);
});

test('maps daily visible and dark funds without five-day data', () => {
  assert.equal(classifyDailyFunds(120, 80).fundSituation, '趋势流入');
  assert.equal(classifyDailyFunds(-120, -80).fundSituation, '趋势流出');
  assert.equal(classifyDailyFunds(-20, 80).fundSituation, '暗盘领跑');
  assert.equal(classifyDailyFunds(80, -20).fundSituation, '明盘掩护');
  assert.equal(classifyDailyFunds(0, -20).fundSituation, '当日分歧');
  assert.equal(classifyDailyFunds(null, -20), null);
});

test('takes stock code, query date and request time from the frontend order', () => {
  const result = attachOrderContext({ stockCode: '999999', mainNet: -10 }, {
    id: 'DF123', stockCode: '600105', tradeDate: '2026-09-10', createdAt: 1789000000000,
  });
  assert.equal(result.orderId, 'DF123');
  assert.equal(result.stockCode, '600105');
  assert.equal(result.queryDate, '2026-09-10');
  assert.equal(result.requestedAt, 1789000000000);
  assert.match(result.requestedAtText, /^2026-09-/);
});

test('rejects an inconsistent result', () => {
  const result = normalizeAnalysis({
    unit: '万元', mainNet: -2446.3, visibleNet: -1947.3, darkNet: -400, retailNet: 2446.3,
  });
  assert.equal(result.validation.fundSumPassed, false);
  assert.equal(result.validation.passed, false);
});

test('does not accept arbitrary local paths', () => {
  assert.equal(uploadedImagePath('file:///etc/passwd'), null);
  assert.equal(uploadedImagePath('/uploads/../secret.txt'), null);
  assert.match(uploadedImagePath('/uploads/up_123.jpg'), /up_123\.jpg$/);
});
