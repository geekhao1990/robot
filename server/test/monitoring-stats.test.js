const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMonitoringStats } = require('../src/monitoring-stats');
const { latestTradingDate } = require('../src/trading-date');

test('monitoring overview calculates queries, telemetry, users and payments without mock data', () => {
  const now = Date.now();
  const tradeDate = latestTradingDate(now);
  const data = {
    users: [
      { id: 'new-query', createdAt: now - 1000 },
      { id: 'new-idle', createdAt: now - 2000 },
    ],
    darkFundOrders: [
      { id: 'c1', userId: 'new-query', queryMode: 'close', stockCode: '600105', tradeDate, status: 'READY', closeCacheHit: true, createdAt: now - 800, readyAt: now - 300 },
      { id: 'i1', userId: 'old', queryMode: 'intraday', stockCode: '600159', tradeDate, status: 'DISPATCH_FAILED', dispatchError: '无法连接采集器', createdAt: now - 700, failedAt: now - 500 },
    ],
    analyticsEvents: [
      { type: 'dark_close_api', status: 'success', durationMs: 1200, createdAt: now - 600 },
      { type: 'dark_close_api', status: 'data_invalid', reason: '数据校验失败', durationMs: 1800, createdAt: now - 500 },
      { type: 'gold_view', userId: 'new-query', createdAt: now - 400 },
      { type: 'gold_view', userId: 'new-query', createdAt: now - 300 },
    ],
    paymentOrders: [
      { id: 'p1', amount: 990, status: 'SUCCESS', createdAt: now - 500, creditedAt: now - 400 },
      { id: 'p2', amount: 600, status: 'FAILED', createdAt: now - 300 },
    ],
    goldFingerRecords: [],
  };
  const result = buildMonitoringStats(data, now);
  assert.equal(result.dark.closeQueries, 1);
  assert.equal(result.dark.intradayQueries, 1);
  assert.equal(result.dark.uniqueUsers, 2);
  assert.equal(result.dark.cacheHitRate, 100);
  assert.equal(result.dark.interfaceAvailability, 100);
  assert.equal(result.dark.dataQualityRate, 50);
  assert.equal(result.dark.averageResponseMs, 1500);
  assert.equal(result.gold.views, 2);
  assert.equal(result.gold.uniqueUsers, 1);
  assert.equal(result.users.firstQueryRate, 50);
  assert.equal(result.payments.amountYuan, 9.9);
  assert.equal(result.payments.successRate, 50);
  assert.equal(result.payments.creditAnomalies, 0);
  assert.equal(result.dark.failures.some((item) => item.reason === '采集器异常'), true);
});

test('monitoring overview leaves new telemetry rates empty until real samples exist', () => {
  const result = buildMonitoringStats({ users: [], darkFundOrders: [], paymentOrders: [], analyticsEvents: [] });
  assert.equal(result.dark.interfaceAvailability, null);
  assert.equal(result.dark.dataQualityRate, null);
  assert.equal(result.dark.averageResponseMs, null);
  assert.equal(result.gold.views, 0);
  assert.deepEqual(result.alerts, [{ level: 'ok', message: '当前未发现需要处理的系统告警' }]);
});
