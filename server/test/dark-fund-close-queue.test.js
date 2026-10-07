const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('user close query jumps ahead of waiting ranking jobs', async () => {
  const started = [];
  const releases = new Map();
  const fetchCloseDarkFund = (stockCode) => new Promise((resolve) => {
    started.push(stockCode);
    releases.set(stockCode, () => resolve({ stockCode }));
  });
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/dark-fund-close-queue.js'), 'utf8'), {
    module: mod,
    require: (id) => id === './dark-fund-close' ? { fetchCloseDarkFund }
      : id === './db' ? { get: () => ({}), save: () => {} }
      : id === './analytics' ? { record: () => {}, classifyFailure: () => '接口异常' }
      : require(id),
    process: { env: { DARK_FUND_CLOSE_CONCURRENCY: '1' } },
    Promise, Map, Number, String, queueMicrotask,
  });
  const first = mod.exports.requestCloseDarkFund('600001', { priority: 'batch' });
  const second = mod.exports.requestCloseDarkFund('600002', { priority: 'batch' });
  await new Promise((resolve) => setImmediate(resolve));
  const user = mod.exports.requestCloseDarkFund('600003', { priority: 'user' });
  assert.equal(mod.exports.getQueueStatus().userAhead, 2);
  releases.get('600001')();
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ['600001', '600003']);
  releases.get('600003')();
  await user;
  await new Promise((resolve) => setImmediate(resolve));
  releases.get('600002')();
  await second;
});

test('same-stock user request reuses and promotes a queued ranking job', async () => {
  const started = [];
  const releases = new Map();
  const fetchCloseDarkFund = (stockCode) => new Promise((resolve) => {
    started.push(stockCode);
    releases.set(stockCode, () => resolve({ stockCode }));
  });
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/dark-fund-close-queue.js'), 'utf8'), {
    module: mod,
    require: (id) => id === './dark-fund-close' ? { fetchCloseDarkFund }
      : id === './db' ? { get: () => ({}), save: () => {} }
      : id === './analytics' ? { record: () => {}, classifyFailure: () => '接口异常' }
      : require(id),
    process: { env: { DARK_FUND_CLOSE_CONCURRENCY: '1' } },
    Promise, Map, Number, String, queueMicrotask,
  });
  const blocker = mod.exports.requestCloseDarkFund('600001', { priority: 'batch' });
  const batch = mod.exports.requestCloseDarkFund('600105', { priority: 'batch' });
  await new Promise((resolve) => setImmediate(resolve));
  const user = mod.exports.requestCloseDarkFund('600105', { priority: 'user' });
  assert.equal(user, batch);
  assert.equal(mod.exports.getQueueStatus().userAhead, 2);
  releases.get('600001')();
  await blocker;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ['600001', '600105']);
  releases.get('600105')();
  await Promise.all([batch, user]);
});
