const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRouter, HttpError } = require('../src/router');

function setup() {
  const records = [];
  for (let day = 1; records.length < 23; day += 1) {
    const date = new Date(Date.UTC(2026, 8, day));
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
    records.push({
      date: date.toISOString().slice(0, 10),
      finger: 'gold',
      position: 50,
      trend: 'up',
      yang: 50,
    });
  }
  const data = { users: [{ id: 'u1' }], goldFingerRecords: records, goldFingerBanners: [], notes: [] };
  const mod = { exports: {} };
  const dependencyMap = {
    '../db': { get: () => data },
    '../auth': { userIdFor: (token) => token === 'Bearer u1' ? 'u1' : '' },
    '../util': { vipActive: () => false, pubUser: (x) => x, pubNote: (x) => x, pubSettings: () => ({}) },
    '../content-types': { typeLabel: () => '' },
    '../resource-links': { resourceList: () => [] },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/routes/public.js'), 'utf8'), {
    module: mod,
    require: (id) => dependencyMap[id] || require(id),
  });
  const router = createRouter();
  mod.exports(router, HttpError);
  const route = router.match('GET', '/api/gold-finger/history');
  const call = (query, token = 'Bearer u1') => Promise.resolve().then(() => route.handler({
    query,
    headers: { authorization: token },
  }));
  return { records, call };
}

test('gold finger history returns fixed pages of 10 records', async () => {
  const { records, call } = setup();
  const first = await call({ page: '1', size: '99' });
  assert.equal(first.records.length, 10);
  assert.equal(first.pageSize, 10);
  assert.equal(first.total, 23);
  assert.equal(first.totalPages, 3);
  assert.equal(first.hasPrev, false);
  assert.equal(first.hasNext, true);
  assert.equal(first.records[0].date, records[22].date);

  const last = await call({ page: '3' });
  assert.equal(last.records.length, 3);
  assert.equal(last.hasPrev, true);
  assert.equal(last.hasNext, false);
  await assert.rejects(call({ page: '1' }, ''), { status: 401 });
});
