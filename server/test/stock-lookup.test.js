const test = require('node:test');
const assert = require('node:assert/strict');
const { isBeijingStockCode, lookupStock, marketFor } = require('../src/stock-lookup');

test('stock market routing rejects Beijing exchange codes', async () => {
  assert.equal(isBeijingStockCode('920001'), true);
  assert.equal(isBeijingStockCode('430001'), true);
  assert.equal(isBeijingStockCode('830001'), true);
  assert.equal(marketFor('600000'), '1');
  assert.equal(marketFor('000001'), '0');
  assert.throws(() => lookupStock('920001'), { status: 503, message: '系统繁忙' });
});

test('stock lookup uses the local map and allows unknown new stocks', async () => {
  assert.deepEqual(lookupStock('600000'), {
    stockCode: '600000', stockName: '浦发银行', stockInitials: 'PFYH', stockDisplayName: '浦发YH', matched: true,
  });
  assert.deepEqual(lookupStock('600159'), {
    stockCode: '600159', stockName: '大龙地产', stockInitials: 'DLDC', stockDisplayName: '大龙DC', matched: true,
  });
  assert.deepEqual(lookupStock('399999'), {
    stockCode: '399999', stockName: '', stockInitials: '', stockDisplayName: '', matched: false,
  });
});
