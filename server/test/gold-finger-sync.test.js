const test = require('node:test');
const assert = require('node:assert/strict');
const { dueSlot, parseSchedule, refreshPolicy, normalizeSourceList, applySourceRecords } = require('../src/gold-finger-sync');

test('scheduler uses all eight requested Beijing trading-day slots', () => {
  const saved=process.env.GOLD_FINGER_SYNC_SCHEDULE;
  delete process.env.GOLD_FINGER_SYNC_SCHEDULE;
  try {
    const slots=['10:00','10:30','11:00','12:00','13:30','14:00','14:30','15:10'];
    assert.equal(dueSlot(Date.parse('2026-10-15T09:59:00+08:00')),undefined);
    slots.forEach((time,i)=>{
      const [h,m]=time.split(':').map(Number),at=Date.parse('2026-10-15T'+time+':00+08:00');
      assert.equal(dueSlot(at),h*60+m);
      if(i)assert.equal(dueSlot(at-1),Number(slots[i-1].slice(0,2))*60+Number(slots[i-1].slice(3)));
    });
    assert.equal(refreshPolicy(Date.parse('2026-10-15T10:00:00+08:00')).scheduleVersion,slots.join(','));
  } finally { if(saved===undefined)delete process.env.GOLD_FINGER_SYNC_SCHEDULE;else process.env.GOLD_FINGER_SYNC_SCHEDULE=saved; }
});

test('client refresh policy follows the server supplied schedule instead of fixed mini-program times', () => {
  const schedule = parseSchedule('09:45, 12:05,16:10');
  assert.deepEqual(schedule, [585, 725, 970]);
  const policy = refreshPolicy(Date.parse('2026-09-30T04:10:00Z'), schedule); // 北京时间 12:10
  assert.equal(policy.slotKey, '2026-09-30:12:05');
  assert.equal(policy.scheduleVersion, '09:45,12:05,16:10');
  assert.equal(policy.nextRefreshAt, Date.parse('2026-09-30T08:12:00Z'));
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

test('later sync only fills missing history and updates newest date', () => {
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

const newRecord = { id: 'sys-2026-10-19', date: '2026-10-19', yang: 13, finger: 'silver', position: '30%', trend: '下跌' };

test('new source derives yin and parses percentage without changing internal schema', () => {
  const data = {};
  applySourceRecords(data, [newRecord], 123);
  assert.deepEqual(data.goldFingerRecords[0], {
    id: 'gf_20261019', date: '2026-10-19', yang: 13, yin: 87,
    finger: 'silver', position: 30, trend: 'down', updatedAt: 123,
  });
});

test('descending source updates newest date and preserves existing historical corrections', () => {
  const data = { goldFingerRecords: [
    { ...newRecord, yang: 9 },
    { ...newRecord, date: '2026-10-16', yang: 55 },
  ] };
  const result = applySourceRecords(data, [newRecord, { ...newRecord, date: '2026-10-16' }]);
  assert.equal(result.latestDate, '2026-10-19');
  assert.equal(result.updated, 1);
  assert.equal(result.skipped, 1);
  assert.equal(data.goldFingerRecords[0].yang, 13);
  assert.equal(data.goldFingerRecords[1].yang, 55);
});

test('missing or invalid percentages are not silently treated as zero', () => {
  for (const position of [null, '', 'abc%', '101%', true]) {
    assert.throws(() => normalizeSourceList([{ ...newRecord, position }]), /无效/);
  }
  assert.throws(() => normalizeSourceList([{ ...newRecord, yang: null }]), /无效/);
});

test('fetch uses new endpoint with existing login and accepts both response shapes', async () => {
  const { fetchSourceData } = require('../src/gold-finger-sync');
  const originalFetch = global.fetch;
  try {
    for (const baseUrl of ['http://example.test', 'http://example.test/api/yyp/yang-records']) {
      for (const payload of [[newRecord], { list: [newRecord] }]) {
        const calls = [];
        global.fetch = async (url, options) => {
          calls.push({ url, options });
          if (calls.length === 1) return new Response(null, { status: 302, headers: { 'set-cookie': 'session=test; HttpOnly' } });
          return new Response(JSON.stringify(payload));
        };
        assert.deepEqual(await fetchSourceData({ baseUrl, username: 'test', password: 'test' }), [newRecord]);
        assert.equal(calls[0].url, 'http://example.test/login');
        assert.equal(calls[1].url, 'http://example.test/api/yyp/yang-records');
        assert.equal(calls[1].options.headers.Cookie, 'session=test');
        assert.equal(calls[1].options.redirect, 'manual');
      }
    }
    global.fetch = async () => new Response('Forbidden', { status: 403 });
    await assert.rejects(fetchSourceData({ baseUrl: 'http://example.test', username: 'test', password: 'test' }), /登录失败（HTTP 403）/);
  } finally { global.fetch = originalFetch; }
});

test('normalization rejects inconsistent fund percentages', () => {
  assert.throws(() => normalizeSourceList([
    { date: '2026-09-18', finger: '金', position: 80, trend: '上涨', yang: 60, yin: 50 },
  ]), /不等于100/);
});
