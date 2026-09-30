const test = require('node:test');
const assert = require('node:assert/strict');
const { isBeijingStockCode, lookupStock, marketFor } = require('../src/stock-lookup');

test('stock market routing rejects Beijing exchange codes', async () => {
  assert.equal(isBeijingStockCode('920001'), true);
  assert.equal(isBeijingStockCode('430001'), true);
  assert.equal(isBeijingStockCode('830001'), true);
  assert.equal(marketFor('600000'), '1');
  assert.equal(marketFor('000001'), '0');
  await assert.rejects(lookupStock('920001', async () => null), { status: 503, message: '系统繁忙' });
});

test('stock lookup returns code and name from the quote response', async () => {
  let requestedUrl = '';
  const result = await lookupStock('600000', async (url) => {
    requestedUrl = url;
    return { ok: true, json: async () => ({ data: { f57: '600000', f58: '浦发银行' } }) };
  });
  assert.match(requestedUrl, /secid=1\.600000/);
  assert.deepEqual(result, { stockCode: '600000', stockName: '浦发银行' });
});
