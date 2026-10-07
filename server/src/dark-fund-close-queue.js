const { fetchCloseDarkFund } = require('./dark-fund-close');
const db = require('./db');
const analytics = require('./analytics');

// The upstream account only supports one active task reliably. Keep one shared
// lane for user and ranking requests; user jobs still jump ahead of waiting batch jobs.
const MAX_ACTIVE = 1;
const userQueue = [];
const batchQueue = [];
const pendingByStock = new Map();
let active = 0;
let lastStartedAt = 0;
let lastFinishedAt = 0;
let pumpTimer = null;

function requestGapMs() {
  return Math.max(0, Number(process.env.DARK_FUND_CLOSE_REQUEST_GAP_MS) || 3000);
}

function nextStartAt() {
  const gap = requestGapMs();
  return Math.max(lastStartedAt + gap, lastFinishedAt + gap);
}

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
    if (!userQueue.length && !batchQueue.length) return;
    // 上游限频按“上一任务完成时间”计算。长任务结束后也必须冷却，
    // 不能因为开始时间已经过去很久就让下一单立即撞向接口。
    const remaining = nextStartAt() - Date.now();
    if (remaining > 0) {
      if (!pumpTimer) {
        pumpTimer = setTimeout(() => {
          pumpTimer = null;
          pump();
        }, remaining);
      }
      return;
    }
    const job = userQueue.shift() || batchQueue.shift();
    if (!job) return;
    active += 1;
    lastStartedAt = Date.now();
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
        lastFinishedAt = Date.now();
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
  return {
    active,
    userWaiting: userQueue.length,
    batchWaiting: batchQueue.length,
    pendingStocks: pendingByStock.size,
    cooldownRemainingMs: Math.max(0, nextStartAt() - Date.now()),
    // New user requests run ahead of waiting batch jobs, so only active work and
    // already-waiting user requests are actually in front of the next user.
    userAhead: active + userQueue.length,
  };
}

module.exports = { MAX_ACTIVE, getQueueStatus, requestCloseDarkFund, requestGapMs };
