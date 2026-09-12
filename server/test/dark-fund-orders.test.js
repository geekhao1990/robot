const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AI_AUTO_COMPLETE_DELAY_MS,
  processDueAiWorkOrders,
} = require('../src/dark-fund-orders');

test('AI work order auto-completes after three minutes with essential fields only', () => {
  const reviewedAt = 1789000000000;
  const order = {
    id: 'DF-AUTO-1', userId: 'u1', stockCode: '600410', tradeDate: '2026-09-11',
    status: 'PENDING', createdAt: reviewedAt - 1000, aiReviewedAt: reviewedAt,
    aiAutoCompleteAt: reviewedAt + AI_AUTO_COMPLETE_DELAY_MS,
    aiImageUrl: '/uploads/result.png',
    aiAnalysis: {
      stockName: '华胜天成', pctChange: -9.98, unit: '亿元',
      mainNet: -16.98, visibleNet: -9.73, darkNet: -7.25, retailNet: 16.98,
    },
  };
  const data = { users: [{ id: 'u1', name: '用户' }], notes: [], darkFundOrders: [order] };
  const pending = processDueAiWorkOrders(data, reviewedAt + AI_AUTO_COMPLETE_DELAY_MS - 1);
  assert.equal(pending.prepared, 1);
  assert.equal(pending.completed, 0);
  assert.equal(order.status, 'PENDING');
  assert.match(order.aiDraftText, /华胜天成（600410）/);
  assert.doesNotMatch(order.aiDraftText, /价格为|现报|收盘报|成交额|换手率|undefined|null/);

  const completed = processDueAiWorkOrders(data, reviewedAt + AI_AUTO_COMPLETE_DELAY_MS);
  assert.equal(completed.completed, 1);
  assert.equal(order.status, 'READY');
  assert.equal(order.snapshotImages[0], '/uploads/result.png');
  assert.equal(data.notes[0].content, order.aiDraftText);
});

test('AI work order with missing essential fields or fund errors remains pending', () => {
  const order = {
    id: 'DF-AUTO-2', stockCode: '600410', tradeDate: '2026-09-11', status: 'PENDING',
    aiReviewedAt: 1, aiAutoCompleteAt: 1 + AI_AUTO_COMPLETE_DELAY_MS, aiImageUrl: '/uploads/result.png',
    aiAnalysis: { stockName: '华胜天成', pctChange: 1, unit: '亿元', mainNet: 10, visibleNet: 8, darkNet: 8, retailNet: -10 },
  };
  const data = { users: [], notes: [], darkFundOrders: [order] };
  const result = processDueAiWorkOrders(data, 1 + AI_AUTO_COMPLETE_DELAY_MS + 1);
  assert.equal(result.completed, 0);
  assert.equal(order.status, 'PENDING');
  assert.equal(order.aiReviewStatus, 'QUESTIONABLE');
  assert.equal(order.aiAutoCompleteAt, 0);
});
