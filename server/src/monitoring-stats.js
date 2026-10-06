const { isTradingDay, latestTradingDate } = require('./trading-date');

const DAY_MS = 24 * 3600 * 1000;
const READY = new Set(['READY', 'SUCCESS']);

function tradingDates(count = 5) {
  const dates = [];
  const cursor = new Date(`${latestTradingDate()}T00:00:00Z`);
  while (dates.length < count) {
    const value = cursor.toISOString().slice(0, 10);
    if (isTradingDay(value)) dates.push(value);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates;
}

function beijingDate(timestamp) {
  return new Date((Number(timestamp) || 0) + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function rate(numerator, denominator) {
  return denominator ? Math.round(numerator * 1000 / denominator) / 10 : null;
}

function average(values) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function percentile(values, percentileValue) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return Math.round(sorted[Math.max(0, Math.ceil(sorted.length * percentileValue) - 1)]);
}

function latestAt(items, fields) {
  return items.reduce((latest, item) => Math.max(latest, ...fields.map((field) => Number(item && item[field]) || 0)), 0) || null;
}

function failureRows(orders, apiEvents) {
  const counts = new Map();
  const add = (reason) => counts.set(reason, (counts.get(reason) || 0) + 1);
  orders.filter((item) => !READY.has(item.status)).forEach((item) => {
    const message = String(item.dispatchError || item.error || item.collectorError || '任务未完成');
    if (/采集机|采集器|ECONNREFUSED/i.test(message)) add('采集器异常');
    else if (/额度|次数.*用完/.test(message)) add('额度不足');
    else add('任务失败');
  });
  apiEvents.filter((item) => item.status !== 'success').forEach((item) => add(item.reason || '接口异常'));
  return Array.from(counts, ([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

function buildMonitoringStats(data, now = Date.now()) {
  const dates = tradingDates(5);
  const dateSet = new Set(dates);
  const naturalCutoff = now - 5 * DAY_MS;
  const orders = (data.darkFundOrders || []).filter((item) => dateSet.has(item.tradeDate || beijingDate(item.createdAt)));
  const closeOrders = orders.filter((item) => item.queryMode === 'close');
  const intradayOrders = orders.filter((item) => item.queryMode === 'intraday');
  const successfulOrders = orders.filter((item) => READY.has(item.status));
  const cacheHits = successfulOrders.filter((item) => item.closeCacheHit || item.intradayCacheHit).length;
  const orderDurations = successfulOrders
    .map((item) => Number(item.readyAt || item.updatedAt) - Number(item.createdAt))
    .filter((value) => Number.isFinite(value) && value >= 0);

  const events = (data.analyticsEvents || []).filter((item) => Number(item.createdAt) >= naturalCutoff);
  const apiEvents = events.filter((item) => item.type === 'dark_close_api');
  const interfaceGood = apiEvents.filter((item) => item.status !== 'interface_error').length;
  const validated = apiEvents.filter((item) => item.status === 'success' || item.status === 'data_invalid');
  const validData = validated.filter((item) => item.status === 'success').length;
  const apiDurations = apiEvents.map((item) => Number(item.durationMs)).filter((value) => Number.isFinite(value) && value >= 0);
  const goldEvents = events.filter((item) => item.type === 'gold_view');

  const newUsers = (data.users || []).filter((item) => Number(item.createdAt) >= naturalCutoff);
  const queriedUserIds = new Set((data.darkFundOrders || []).map((item) => item.userId));
  const firstQueryUsers = newUsers.filter((item) => queriedUserIds.has(item.id)).length;

  const payments = (data.paymentOrders || []).filter((item) => Number(item.createdAt) >= naturalCutoff);
  const paid = payments.filter((item) => item.status === 'SUCCESS');
  const creditAnomalies = paid.filter((item) => !item.creditedAt).length;
  const goldRecords = data.goldFingerRecords || [];
  const rankingValues = Object.values(data.darkFundRankings || data.darkFundRankingHistory || {});
  const ranking = rankingValues.sort((a, b) => Number(a.generatedAt) - Number(b.generatedAt)).slice(-1)[0]
    || data.darkFundRanking || null;
  const goldSync = data.goldFingerSyncState || {};
  const rankingSync = data.darkFundRankingSyncState || {};

  const alerts = [];
  if (apiEvents.length >= 3 && rate(interfaceGood, apiEvents.length) < 95) alerts.push({ level: 'danger', message: '盘后接口近5日可用率低于95%' });
  if (validated.length >= 3 && rate(validData, validated.length) < 95) alerts.push({ level: 'danger', message: '盘后数据近5日合格率低于95%' });
  if (percentile(apiDurations, 0.95) > 30000) alerts.push({ level: 'warning', message: '盘后接口P95响应时间超过30秒' });
  if (creditAnomalies) alerts.push({ level: 'danger', message: `${creditAnomalies}笔支付成功但权益未到账` });
  if (goldSync.lastError) alerts.push({ level: 'warning', message: `金手指同步异常：${goldSync.lastError}` });
  if (rankingSync.lastError) alerts.push({ level: 'warning', message: `今日暗盘榜异常：${rankingSync.lastError}` });
  if (!alerts.length) alerts.push({ level: 'ok', message: '当前未发现需要处理的系统告警' });

  return {
    window: { tradingDates: dates, naturalDays: 5 },
    dark: {
      closeQueries: closeOrders.length,
      intradayQueries: intradayOrders.length,
      totalQueries: orders.length,
      averageDailyQueries: Math.round(orders.length / 5 * 10) / 10,
      uniqueUsers: new Set(orders.map((item) => item.userId)).size,
      uniqueStocks: new Set(orders.map((item) => item.stockCode)).size,
      cacheHitRate: rate(cacheHits, successfulOrders.length),
      orderSuccessRate: rate(successfulOrders.length, orders.length),
      averageResponseMs: average(apiDurations.length ? apiDurations : orderDurations),
      p95ResponseMs: percentile(apiDurations.length ? apiDurations : orderDurations, 0.95),
      interfaceAvailability: rate(interfaceGood, apiEvents.length),
      dataQualityRate: rate(validData, validated.length),
      telemetrySamples: apiEvents.length,
      failures: failureRows(orders, apiEvents),
    },
    gold: {
      views: goldEvents.length,
      uniqueUsers: new Set(goldEvents.map((item) => item.userId).filter(Boolean)).size,
      averageDailyViews: Math.round(goldEvents.length / 5 * 10) / 10,
    },
    users: { newUsers: newUsers.length, firstQueryUsers, firstQueryRate: rate(firstQueryUsers, newUsers.length) },
    payments: {
      orders: payments.length,
      successfulOrders: paid.length,
      amountYuan: Math.round(paid.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)) / 100,
      successRate: rate(paid.length, payments.length),
      creditAnomalies,
    },
    freshness: {
      darkResultAt: latestAt(data.darkFundOrders || [], ['readyAt', 'updatedAt']),
      darkApiAt: latestAt((data.analyticsEvents || []).filter((item) => item.type === 'dark_close_api'), ['createdAt']),
      goldAt: Math.max(latestAt(goldRecords, ['updatedAt']) || 0, Number(goldSync.lastSuccessAt) || 0) || null,
      rankingAt: Math.max(Number(ranking && ranking.generatedAt) || 0, Number(rankingSync.lastSuccessAt) || 0) || null,
    },
    alerts,
  };
}

module.exports = { buildMonitoringStats };
