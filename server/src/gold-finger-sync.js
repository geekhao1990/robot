const db = require('./db');
const { chinaToday, isTradingDay } = require('./trading-date');

const SCHEDULE_MINUTES = [10 * 60, 14 * 60, 16 * 60];
const CHECK_INTERVAL_MS = 30 * 1000;
const RETRY_INTERVAL_MS = 5 * 60 * 1000;
let timer = null;
let running = false;

function config() {
  return {
    enabled: String(process.env.GOLD_FINGER_SYNC_ENABLED || '').toLowerCase() === 'true',
    baseUrl: String(process.env.GOLD_FINGER_SOURCE_URL || '').replace(/\/+$/, ''),
    username: String(process.env.GOLD_FINGER_SOURCE_USERNAME || ''),
    password: String(process.env.GOLD_FINGER_SOURCE_PASSWORD || ''),
  };
}

function chinaMinutes(timestamp = Date.now()) {
  const date = new Date(timestamp + 8 * 3600 * 1000);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function slotLabel(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function dueSlot(timestamp = Date.now()) {
  const minutes = chinaMinutes(timestamp);
  return SCHEDULE_MINUTES.filter((slot) => slot <= minutes).at(-1);
}

function assertDate(value, index) {
  const date = String(value || '').trim();
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`源数据第${index + 1}条日期无效`);
  }
  return date;
}

function percent(value, label, index) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) throw new Error(`源数据第${index + 1}条${label}无效`);
  return Math.round(number);
}

function normalizeFinger(value, index) {
  const finger = String(value || '').trim();
  if (finger === '-' || finger === '—') return '';
  if (finger === '金' || finger === '金手指' || finger === 'gold') return 'gold';
  if (finger === '银' || finger === '银手指' || finger === 'silver') return 'silver';
  throw new Error(`源数据第${index + 1}条金银手指无效`);
}

function normalizeTrend(value, index) {
  const trend = String(value || '').trim();
  if (trend === '上涨' || trend === 'up') return 'up';
  if (trend === '下跌' || trend === 'down') return 'down';
  throw new Error(`源数据第${index + 1}条趋势无效`);
}

function normalizeSourceList(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('源接口未返回金手指数据');
  if (items.length > 500) throw new Error('源接口一次返回的数据超过500条');
  const dates = new Set();
  return items.map((item, sourceIndex) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`源数据第${sourceIndex + 1}条不是对象`);
    const date = assertDate(item.date, sourceIndex);
    if (dates.has(date)) throw new Error(`源数据日期${date}重复`);
    dates.add(date);
    const rawYang = Number(item.yang);
    const rawYin = Number(item.yin);
    if (!Number.isFinite(rawYang) || !Number.isFinite(rawYin) || Math.abs(rawYang + rawYin - 100) > 0.2) {
      throw new Error(`源数据第${sourceIndex + 1}条阳谱和阴谱不等于100`);
    }
    const yang = percent(rawYang, '阳谱', sourceIndex);
    return {
      sourceIndex,
      date,
      yang,
      yin: 100 - yang,
      finger: normalizeFinger(item.finger, sourceIndex),
      trend: normalizeTrend(item.trend, sourceIndex),
      position: percent(item.position, '水位', sourceIndex),
    };
  });
}

function applySourceRecords(data, sourceItems, timestamp = Date.now()) {
  const imported = normalizeSourceList(sourceItems);
  data.goldFingerRecords = Array.isArray(data.goldFingerRecords) ? data.goldFingerRecords : [];
  const recordsByDate = new Map(data.goldFingerRecords.map((item) => [item.date, item]));
  const ordered = imported.slice().sort((a, b) => a.date.localeCompare(b.date));
  const latestSourceIndex = imported.length - 1;
  let created = 0;
  let updated = 0;
  let skipped = 0;

  const previousFinger = (date) => Array.from(recordsByDate.values())
    .filter((item) => item.date < date && ['gold', 'silver'].includes(item.finger))
    .sort((a, b) => b.date.localeCompare(a.date))[0]?.finger;
  const nextFinger = (date) => ordered.find((item) => item.date > date && item.finger)?.finger;

  ordered.forEach((item) => {
    const existing = recordsByDate.get(item.date);
    // 自动同步只补缺失历史；源数组最后一项允许在盘中反复更新。
    if (existing && item.sourceIndex !== latestSourceIndex) {
      skipped += 1;
      return;
    }
    const finger = item.finger || previousFinger(item.date) || nextFinger(item.date);
    if (!finger) throw new Error(`${item.date}无法继承金银手指状态`);
    const record = {
      id: `gf_${item.date.replace(/-/g, '')}`,
      date: item.date,
      yang: item.yang,
      yin: item.yin,
      finger,
      trend: item.trend,
      position: item.position,
      updatedAt: timestamp,
    };
    if (existing) {
      data.goldFingerRecords[data.goldFingerRecords.findIndex((entry) => entry.date === item.date)] = record;
      updated += 1;
    } else {
      data.goldFingerRecords.push(record);
      created += 1;
    }
    recordsByDate.set(item.date, record);
  });
  data.goldFingerImportInitialized = true;
  return { created, updated, skipped, latestDate: imported[latestSourceIndex].date, total: data.goldFingerRecords.length };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSourceData(settings = config()) {
  if (!settings.baseUrl || !settings.username || !settings.password) throw new Error('金手指自动同步配置不完整');
  const login = await fetchWithTimeout(`${settings.baseUrl}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: settings.username, password: settings.password }).toString(),
  });
  if (![302, 303].includes(login.status)) throw new Error(`金手指源站登录失败（HTTP ${login.status}）`);
  const cookieHeader = login.headers.get('set-cookie') || '';
  const cookie = cookieHeader.split(';')[0];
  if (!cookie) throw new Error('金手指源站未返回登录会话');
  const response = await fetchWithTimeout(`${settings.baseUrl}/api/getAllData`, { headers: { Cookie: cookie, Accept: 'application/json' } });
  if (!response.ok) throw new Error(`金手指源接口请求失败（HTTP ${response.status}）`);
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.list)) throw new Error('金手指源接口返回格式不正确');
  return payload.list;
}

function syncState(data, today) {
  if (!data.goldFingerSyncState || data.goldFingerSyncState.date !== today) {
    data.goldFingerSyncState = { date: today, completedSlots: [] };
  }
  data.goldFingerSyncState.completedSlots = Array.isArray(data.goldFingerSyncState.completedSlots)
    ? data.goldFingerSyncState.completedSlots : [];
  return data.goldFingerSyncState;
}

async function executeSync({ slot = 'manual', requireToday = true, now = Date.now() } = {}) {
  const data = db.get();
  const today = chinaToday(now);
  const state = syncState(data, today);
  state.lastAttemptAt = now;
  state.lastSlot = slot;
  state.status = 'running';
  state.error = '';
  await db.save();
  try {
    const items = await fetchSourceData();
    const latestDate = String(items.at(-1)?.date || '');
    if (requireToday && latestDate !== today) throw new Error(`源接口最新日期为${latestDate || '空'}，尚未产生${today}数据`);
    const result = applySourceRecords(data, items, Date.now());
    state.status = 'success';
    state.lastSuccessAt = Date.now();
    state.result = result;
    state.error = '';
    await db.save();
    console.log(`[金手指同步] ${slot} 成功：${result.latestDate}，新增${result.created}，更新${result.updated}`);
    return result;
  } catch (error) {
    state.status = 'failed';
    state.lastFailureAt = Date.now();
    state.error = error.message;
    await db.save();
    console.error(`[金手指同步] ${slot} 失败：${error.message}`);
    throw error;
  }
}

async function tick(now = Date.now()) {
  const settings = config();
  if (!settings.enabled || running) return;
  const today = chinaToday(now);
  if (!isTradingDay(today)) return;
  const due = dueSlot(now);
  if (due === undefined) return;
  const data = db.get();
  const state = syncState(data, today);
  const slot = slotLabel(due);
  if (state.completedSlots.includes(slot)) return;
  if (state.lastSlot === slot && state.status === 'failed' && now - Number(state.lastFailureAt || 0) < RETRY_INTERVAL_MS) return;
  running = true;
  try {
    await executeSync({ slot, requireToday: true, now });
    state.completedSlots.push(slot);
    await db.save();
  } catch (_) {
    // 错误已写入状态；五分钟后重试该时点。
  } finally {
    running = false;
  }
}

async function manualSync() {
  if (running) {
    const error = new Error('金手指同步正在执行，请稍后再试');
    error.status = 409;
    throw error;
  }
  running = true;
  try {
    return await executeSync({ slot: '人工强制更新', requireToday: false, now: Date.now() });
  } finally {
    running = false;
  }
}

function getStatus() {
  const settings = config();
  const data = db.get();
  return {
    enabled: settings.enabled,
    configured: Boolean(settings.baseUrl && settings.username && settings.password),
    running,
    schedule: SCHEDULE_MINUTES.map(slotLabel),
    timezone: 'Asia/Shanghai',
    state: data.goldFingerSyncState || null,
  };
}

function start() {
  if (!config().enabled) {
    console.log('[金手指同步] 未启用');
    return () => {};
  }
  console.log('[金手指同步] 已启用，北京时间交易日 10:00、14:00、16:00 自动更新');
  setTimeout(() => tick().catch(console.error), 1000);
  timer = setInterval(() => tick().catch(console.error), CHECK_INTERVAL_MS);
  timer.unref?.();
  return stop;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  SCHEDULE_MINUTES,
  chinaMinutes,
  dueSlot,
  normalizeSourceList,
  applySourceRecords,
  fetchSourceData,
  executeSync,
  manualSync,
  getStatus,
  tick,
  start,
  stop,
};
