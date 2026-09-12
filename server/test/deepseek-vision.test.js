const test = require('node:test');
const assert = require('node:assert/strict');
const { attachOrderContext, buildDarkFundReport, classifyDailyFunds, normalizeAnalysis, uploadedImagePath } = require('../src/deepseek-vision');

test('normalizes a valid same-direction outflow result', () => {
  const result = normalizeAnalysis({
    stockName: '华胜天成',
    stockCode: '600410',
    capturedAt: '11:24',
    quoteType: '盘中',
    price: 20.48,
    pctChange: -9.98,
    turnoverAmount: 12.1,
    turnoverAmountUnit: '亿元',
    turnoverRate: 5.25,
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
  assert.equal(result.price, 20.48);
  assert.equal(result.pctChange, -9.98);
  assert.equal(result.turnoverAmount, 12.1);
  assert.equal(result.turnoverRate, 5.25);
});

test('maps daily visible and dark funds without five-day data', () => {
  assert.equal(classifyDailyFunds(120, 80).fundSituation, '趋势流入');
  assert.equal(classifyDailyFunds(-120, -80).fundSituation, '趋势流出');
  assert.equal(classifyDailyFunds(-20, 80).fundSituation, '暗盘领跑');
  assert.equal(classifyDailyFunds(80, -20).fundSituation, '明盘掩护');
  assert.equal(classifyDailyFunds(0, -20).fundSituation, '当日分歧');
  assert.equal(classifyDailyFunds(null, -20), null);
});

test('takes stock code, query date and request time from the order but keeps the image stock name', () => {
  const result = attachOrderContext({ stockCode: '999999', stockName: '图片错误名称', mainNet: -10 }, {
    id: 'DF123', stockCode: '600105', stockName: '', tradeDate: '2026-09-10', createdAt: 1789000000000,
  });
  assert.equal(result.orderId, 'DF123');
  assert.equal(result.stockCode, '600105');
  assert.equal(result.stockName, '图片错误名称');
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
  assert.ok(result.validation.issues.includes('明盘与暗盘加总存在误差'));
});

test('builds a complete intraday report only after every field passes validation', () => {
  const result = attachOrderContext(normalizeAnalysis({
    stockName: '华胜天成', capturedAt: '11:24', quoteType: '盘中', price: 20.48,
    pctChange: -9.98, turnoverAmount: 8.16, turnoverAmountUnit: '万元', turnoverRate: 5.25,
    unit: '亿元', mainNet: -16.98, visibleNet: -9.73, darkNet: -7.25, retailNet: 16.98,
  }), { id: 'DF123', stockCode: '600410', tradeDate: '2026-09-11', createdAt: 1789000000000 });
  const report = buildDarkFundReport(result);
  assert.match(report, /2026年9月11日 11:24/);
  assert.match(report, /华胜天成（600410）现报20.48元/);
  assert.match(report, /成交额8.16万元/);
  assert.match(report, /暗盘资金净流出7.25亿元/);
  assert.doesNotMatch(report, /【|】/);
  assert.equal(buildDarkFundReport(normalizeAnalysis({ stockName: '缺字段' })), '');
});

test('accepts essential fields and omits sentences for missing optional quote fields', () => {
  const result = attachOrderContext(normalizeAnalysis({
    stockName: '华胜天成', pctChange: -9.98, unit: '亿元',
    mainNet: -16.98, visibleNet: -9.73, darkNet: -7.25, retailNet: 16.98,
  }), { id: 'DF124', stockCode: '600410', tradeDate: '2026-09-11', createdAt: 1789000000000 });
  assert.equal(result.validation.passed, true);
  assert.equal(result.validation.quoteFieldsPresent, false);
  assert.deepEqual(result.validation.optionalMissingFields, ['截图时间', '行情类型', '当前价/收盘价', '成交额', '换手率']);
  const report = buildDarkFundReport(result);
  assert.match(report, /华胜天成（600410）下跌9.98%/);
  assert.match(report, /主力资金净流出16.98亿元/);
  assert.match(report, /散户资金净流入16.98亿元/);
  assert.doesNotMatch(report, /价格为|现报|收盘报|成交额|换手率|undefined|null/);
});

test('does not accept arbitrary local paths', () => {
  assert.equal(uploadedImagePath('file:///etc/passwd'), null);
  assert.equal(uploadedImagePath('/uploads/../secret.txt'), null);
  assert.match(uploadedImagePath('/uploads/up_123.jpg'), /up_123\.jpg$/);
});
