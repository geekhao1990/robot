const test = require('node:test');
const assert = require('node:assert/strict');
const { dueSlot, normalizeSourceList, applySourceRecords } = require('../src/gold-finger-sync');

test('scheduler selects the latest due Beijing slot', () => {
  const at = (iso) => Date.parse(iso);
  assert.equal(dueSlot(at('2026-09-18T01:59:00Z')), undefined);
  assert.equal(dueSlot(at('2026-09-18T02:00:00Z')), 600);
  assert.equal(dueSlot(at('2026-09-18T06:03:00Z')), 840);
  assert.equal(dueSlot(at('2026-09-18T08:01:00Z')), 960);
});

test('source percentages round yang and derive yin while dashes inherit finger', () => {
  const data = { goldFingerRecords: [] };
  const result = applySourceRecords(data, [
    { date: '2026-09-17', finger: '金', position: 60, trend: '上涨', yang: 47.4, yin: 52.6 },
    { date: '2026-09-18', finger: '-', position: 80, trend: '下跌', yang: 67.5, yin: 32.5 },
  ], 123);
  assert.deepEqual(result, { created: 2, updated: 0, skipped: 0, latestDate: '2026-09-18', total: 2 });
  assert.equal(data.goldFingerRecords[1].finger, 'gold');
  assert.equal(data.goldFingerRecords[1].yang, 68);
  assert.equal(data.goldFingerRecords[1].yin, 32);
});

test('later sync only fills missing history and updates source last item', () => {
  const data = { goldFingerRecords: [
    { id: 'old', date: '2026-09-17', finger: 'silver', yang: 10, yin: 90, trend: 'down', position: 10 },
    { id: 'latest', date: '2026-09-18', finger: 'gold', yang: 20, yin: 80, trend: 'up', position: 20 },
  ] };
  const result = applySourceRecords(data, [
    { date: '2026-09-17', finger: '金', position: 99, trend: '上涨', yang: 99, yin: 1 },
    { date: '2026-09-18', finger: '-', position: 80, trend: '下跌', yang: 67.1, yin: 32.9 },
  ], 456);
  assert.equal(result.skipped, 1);
  assert.equal(data.goldFingerRecords[0].finger, 'silver');
  assert.equal(data.goldFingerRecords[1].finger, 'silver');
  assert.equal(data.goldFingerRecords[1].yang, 67);
  assert.equal(data.goldFingerRecords[1].position, 80);
});

test('normalization rejects inconsistent fund percentages', () => {
  assert.throws(() => normalizeSourceList([
    { date: '2026-09-18', finger: '金', position: 80, trend: '上涨', yang: 60, yin: 50 },
  ]), /不等于100/);
});
