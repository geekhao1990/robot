const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAnalysis, uploadedImagePath } = require('../src/deepseek-vision');

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
  assert.equal(result.validation.fundSumPassed, true);
  assert.equal(result.validation.balancePassed, true);
  assert.equal(result.validation.passed, true);
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
