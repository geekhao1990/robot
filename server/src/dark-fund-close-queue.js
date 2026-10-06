const { fetchCloseDarkFund } = require('./dark-fund-close');
const db = require('./db');
const analytics = require('./analytics');

const MAX_ACTIVE = Math.max(1, Number(process.env.DARK_FUND_CLOSE_CONCURRENCY) || 2);
const userQueue = [];
const batchQueue = [];
const pendingByStock = new Map();
let active = 0;

function removeJob(queue, job) {
  const index = queue.indexOf(job);
  if (index >= 0) queue.splice(index, 1);
}

function promote(job) {
  if (job.started || job.priority === 'user') return;
  removeJob(batchQueue, job);
  job.priority = 'user';
  userQueue.push(job);
}

function pump() {
  while (active < MAX_ACTIVE) {
    const job = userQueue.shift() || batchQueue.shift();
    if (!job) return;
    active += 1;
    job.started = true;
    const startedAt = Date.now();
    Promise.resolve()
      .then(() => fetchCloseDarkFund(job.stockCode))
      .then((result) => {
        analytics.record(db.get(), {
          type: 'dark_close_api', source: job.priority, stockCode: job.stockCode,
          status: 'success', durationMs: Date.now() - startedAt,
        });
        db.save();
        job.resolve(result);
      }, (error) => {
        const reason = analytics.classifyFailure(error);
        analytics.record(db.get(), {
          type: 'dark_close_api', source: job.priority, stockCode: job.stockCode,
          status: reason === '数据校验失败' ? 'data_invalid' : 'interface_error',
          reason, durationMs: Date.now() - startedAt,
        });
        db.save();
        job.reject(error);
      })
      .finally(() => {
        active -= 1;
        pendingByStock.delete(job.stockCode);
        pump();
      });
  }
}

function requestCloseDarkFund(stockCode, options = {}) {
  const key = String(stockCode || '').trim();
  const priority = options.priority === 'batch' ? 'batch' : 'user';
  const existing = pendingByStock.get(key);
  if (existing) {
    if (priority === 'user') promote(existing);
    return existing.promise;
  }
  const job = { stockCode: key, priority, started: false };
  job.promise = new Promise((resolve, reject) => {
    job.resolve = resolve;
    job.reject = reject;
  });
  pendingByStock.set(key, job);
  (priority === 'user' ? userQueue : batchQueue).push(job);
  queueMicrotask(pump);
  return job.promise;
}

function getQueueStatus() {
  return { active, userWaiting: userQueue.length, batchWaiting: batchQueue.length, pendingStocks: pendingByStock.size };
}

module.exports = { MAX_ACTIVE, getQueueStatus, requestCloseDarkFund };
