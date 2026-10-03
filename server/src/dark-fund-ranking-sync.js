const db = require('./db');
const { fetchCloseDarkFund } = require('./dark-fund-close');
const { fetchThsHotList, generateRanking, publicRanking } = require('./dark-fund-ranking');
const { chinaToday, isTradingDay, latestTradingDate } = require('./trading-date');

const DEFAULT_SCHEDULE_MINUTES = 16 * 60 + 35;
const CHECK_INTERVAL_MS = 60 * 1000;
const RETRY_INTERVAL_MS = 5 * 60 * 1000;
let timer = null;
let running = false;

function chinaMinutes(timestamp = Date.now()) {
  const date = new Date(timestamp + 8 * 3600 * 1000);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function parseSchedule(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return DEFAULT_SCHEDULE_MINUTES;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
    ? hour * 60 + minute : DEFAULT_SCHEDULE_MINUTES;
}

function scheduleMinutes() {
  return parseSchedule(process.env.DARK_FUND_RANKING_SCHEDULE || '16:35');
}

function scheduleLabel() {
  const minutes = scheduleMinutes();
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function state(data) {
  data.darkFundRankingSyncState = data.darkFundRankingSyncState && typeof data.darkFundRankingSyncState === 'object'
    ? data.darkFundRankingSyncState : {};
  return data.darkFundRankingSyncState;
}

async function executeSync({ source = '自动更新', now = Date.now() } = {}) {
  const data = db.get();
  const syncState = state(data);
  syncState.status = 'running';
  syncState.lastAttemptAt = now;
  syncState.source = source;
  syncState.error = '';
  await db.save();
  try {
    const tradeDate = latestTradingDate(now);
    const payload = await fetchThsHotList();
    const ranking = await generateRanking({ data, payload, tradeDate, fetchClose: fetchCloseDarkFund });
    if (!ranking.successCount) throw Object.assign(new Error('热榜股票盘后查询全部失败'), { status: 502 });
    syncState.status = 'success';
    syncState.lastSuccessAt = Date.now();
    syncState.lastSuccessDate = tradeDate;
    syncState.result = {
      tradeDate,
      candidateCount: ranking.candidateCount,
      successCount: ranking.successCount,
      cacheHitCount: ranking.cacheHitCount,
      failureCount: ranking.failed.length,
    };
    await db.save();
    console.log(`[今日暗盘榜] ${source}成功：${tradeDate}，成功${ranking.successCount}/${ranking.candidateCount}，缓存${ranking.cacheHitCount}`);
    return publicRanking(ranking);
  } catch (error) {
    syncState.status = 'failed';
    syncState.lastFailureAt = Date.now();
    syncState.error = String(error && error.message || '更新失败').slice(0, 300);
    await db.save();
    console.error(`[今日暗盘榜] ${source}失败：${syncState.error}`);
    throw error;
  }
}

async function tick(now = Date.now()) {
  if (running) return;
  const today = chinaToday(now);
  if (!isTradingDay(today) || chinaMinutes(now) < scheduleMinutes()) return;
  const syncState = state(db.get());
  if (syncState.lastSuccessDate === today) return;
  if (syncState.status === 'failed' && now - Number(syncState.lastFailureAt || 0) < RETRY_INTERVAL_MS) return;
  running = true;
  try {
    await executeSync({ source: '交易日定时更新', now });
  } catch (_) {
    // 状态与错误已持久化，五分钟后自动重试。
  } finally {
    running = false;
  }
}

async function manualSync() {
  if (running) throw Object.assign(new Error('今日暗盘榜正在更新，请稍后再试'), { status: 409 });
  running = true;
  try {
    return await executeSync({ source: '后台人工更新' });
  } finally {
    running = false;
  }
}

function getStatus() {
  return {
    enabled: true,
    running,
    schedule: scheduleLabel(),
    timezone: 'Asia/Shanghai',
    state: db.get().darkFundRankingSyncState || null,
  };
}

function start() {
  console.log(`[今日暗盘榜] 已启用，北京时间交易日 ${scheduleLabel()} 自动读取同花顺热榜并更新`);
  setTimeout(() => tick().catch(console.error), 1500);
  timer = setInterval(() => tick().catch(console.error), CHECK_INTERVAL_MS);
  timer.unref?.();
  return stop;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  DEFAULT_SCHEDULE_MINUTES,
  chinaMinutes,
  executeSync,
  getStatus,
  manualSync,
  parseSchedule,
  scheduleMinutes,
  start,
  stop,
  tick,
};
