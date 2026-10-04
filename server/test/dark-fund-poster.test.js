const test = require('node:test');
const assert = require('node:assert/strict');
const { exactAmount, maskedAmount, posterMetrics } = require('../../miniprogram/utils/dark-fund-poster');

test('share poster exposes exact 1-day dark fund and masks rolling totals', () => {
  const result = {
    stockName: '永鼎股份', stockCode: '600105', tradeDate: '2026-09-30',
    days: [
      { tradeDate: '2026-09-26', grey: -605460166 },
      { tradeDate: '2026-09-27', grey: -159935303 },
      { tradeDate: '2026-09-28', grey: -42902723 },
      { tradeDate: '2026-09-29', grey: -123071051 },
      { tradeDate: '2026-09-30', grey: -70262426, listed: -209419079, main: -279681505 },
    ],
  };
  const metrics = posterMetrics(result);
  assert.equal(metrics.stockName, '永鼎股份');
  assert.equal(metrics.day1Text, '-7026.2万');
  assert.equal(metrics.day3Text, '-x.36亿元');
  assert.equal(metrics.day5Text, '-x0.02亿元');
});

test('share poster amount formatting preserves direction, scale and unit', () => {
  assert.equal(exactAmount(915000000), '+9.15亿');
  assert.equal(maskedAmount(168000000), 'x.68亿元');
  assert.equal(maskedAmount(1268000000), 'x2.68亿元');
  assert.equal(maskedAmount(-5670000), '-x67万');
  assert.equal(maskedAmount(-91500000), '-x150万');
  assert.equal(maskedAmount(0), 'x万');
});

test('share poster reuses the exact numbers already rendered by the page bars', () => {
  const result = {
    stockName: '永鼎股份', stockCode: '600105', tradeDate: '2026-09-30',
    days: [{ tradeDate: '2026-09-30', grey: -70262426, listed: -209419079, main: -279681505 }],
  };
  const metrics = posterMetrics(result, {
    unitLabel: '万元',
    dayBars: [
      { text: '-20941.9' },
      { text: '-7026.2' },
      { text: '27968.2' },
    ],
  });
  assert.equal(metrics.day1Text, '-7026.2万');
  assert.deepEqual(metrics.barTexts, ['-20941.9', '-7026.2', '27968.2']);
});
