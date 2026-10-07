const SAMPLE_CLOSE_PAYLOAD = {
  stock: 'sh600105',
  name: '永鼎股份',
  trade_date: '2026-09-30',
  version_label: '收盘',
  days: [
    {
      trade_date: '2026-09-30',
      main: -279681505.83274597,
      grey: -70262426.83274597,
      listed: -209419079,
      super_large: -146578422.84490156,
      large: -133103082.9878444,
      middle: -18850426.15509844,
      small: 298531931.9878445,
    },
    {
      trade_date: '2026-09-29',
      main: -234428686.71112993,
      grey: -123071051.71112993,
      listed: -111357635,
      super_large: -9165579.480624594,
      large: -225263107.23050535,
      middle: -18165255.519375376,
      small: 252593942.2305054,
    },
    {
      trade_date: '2026-09-28',
      main: -1342328107.9458745,
      grey: -605460166.9458745,
      listed: -736867941,
      super_large: -734231920.2085357,
      large: -608096187.7373387,
      middle: 365773509.208536,
      small: 976554598.7373394,
    },
    {
      trade_date: '2026-09-24',
      main: -502823098.275403,
      grey: -159935303.275403,
      listed: -342887795,
      super_large: -292457773.44773275,
      large: -210365324.82767022,
      middle: -58856301.552267365,
      small: 561679399.8276703,
    },
    {
      trade_date: '2026-09-23',
      main: -490129791.2829146,
      grey: -42902723.28291457,
      listed: -447227068,
      super_large: -215148291.9512939,
      large: -274981499.3316207,
      middle: 43362163.95129384,
      small: 446767627.3316206,
    },
    {
      trade_date: '2026-09-22',
      main: -861658891.3149973,
      grey: -242033011.31499732,
      listed: -619625880,
      super_large: -617310498.8877808,
      large: -244348392.4272165,
      middle: -63311021.112219155,
      small: 924969912.4272175,
    },
    {
      trade_date: '2026-09-21',
      main: 22542169.263435997,
      grey: 17156209.263435997,
      listed: 5385960,
      super_large: 12113368.197681013,
      large: 10428801.065754985,
      middle: -100601528.197681,
      small: 78059358.93424496,
    },
  ],
};

const { isTradingDay } = require('./trading-date');
const { stockInitials } = require('./stock-lookup');
const db = require('./db');

const MONEY_FIELDS = ['main', 'grey', 'listed', 'super_large', 'large', 'middle', 'small'];

function finiteNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${field}格式不正确`);
  return number;
}

function stockCodeFrom(value) {
  const matched = String(value || '').trim().match(/(\d{6})$/);
  return matched ? matched[1] : '';
}

function validTradeDate(value) {
  const date = String(value || '').trim();
  const parsed = new Date(`${date}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === date
    && isTradingDay(date);
}

function relativeFundError(main, listed, grey) {
  const difference = Math.abs(listed + grey - main);
  const scale = Math.max(Math.abs(main), Math.abs(listed) + Math.abs(grey), 1);
  return difference / scale;
}

function normalizeCloseDarkFund(payload, expectedCode = '') {
  if (!payload || typeof payload !== 'object') throw new Error('盘后数据为空');
  const stockCode = stockCodeFrom(payload.stock || payload.stock_code);
  const name = String(payload.name || payload.stock_name || '').trim();
  const tradeDate = String(payload.trade_date || '').trim();
  const versionLabel = String(payload.version_label || '收盘').trim() || '收盘';
  const kind = String(payload.kind || '').trim().toLowerCase() || 'close';
  if (!/^\d{6}$/.test(stockCode)) throw new Error('股票代码缺失');
  if (expectedCode && stockCode !== expectedCode) throw new Error('盘后数据股票代码不匹配');
  if (!name) throw new Error('股票名称缺失');
  if (!validTradeDate(tradeDate)) throw new Error('交易日期格式不正确或不是交易日');
  if (!Array.isArray(payload.days) || !payload.days.length) throw new Error('盘后资金明细为空');
  if (payload.days.length > 7) throw new Error('盘后资金明细超过7个交易日');
  const seenDates = new Set();
  const days = payload.days.map((item, index) => {
    const rowDate = String(item && item.trade_date || '').trim();
    if (!validTradeDate(rowDate)) throw new Error(`第${index + 1}条交易日期格式不正确或不是交易日`);
    if (seenDates.has(rowDate)) throw new Error(`盘后资金明细日期${rowDate}重复`);
    seenDates.add(rowDate);
    const row = { tradeDate: rowDate };
    MONEY_FIELDS.forEach((field) => { row[field] = finiteNumber(item[field], `${rowDate} ${field}`); });
    if (relativeFundError(row.main, row.listed, row.grey) > 0.02) {
      throw new Error(`${rowDate}主力明盘与暗盘加总误差超过2%`);
    }
    return row;
  }).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const latest = days[days.length - 1];
  if (latest.tradeDate !== tradeDate) throw new Error('交易日期与最新资金明细不一致');
  return {
    type: 'close_snapshot',
    validationVersion: 2,
    stockCode,
    stockName: name,
    stockInitials: stockInitials(name),
    tradeDate,
    versionLabel,
    versionKey: String(payload.version_key || '').trim(),
    kind,
    updatedAt: String(payload.updated_at || '').trim(),
    days,
  };
}

function nextTradingOpenAt(tradeDate) {
  const cursor = new Date(`${tradeDate}T00:00:00Z`);
  if (!Number.isFinite(cursor.getTime())) return 0;
  let next = '';
  do {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    next = cursor.toISOString().slice(0, 10);
  } while (!isTradingDay(next));
  // 北京时间09:30等于UTC 01:30。
  return Date.parse(`${next}T01:30:00Z`);
}

function isReusableCloseResult(result, stockCode, now = Date.now()) {
  if (!result || result.type !== 'close_snapshot') return false;
  if (Number(result.validationVersion) < 2) return false;
  if (stockCodeFrom(result.stockCode) !== stockCodeFrom(stockCode)) return false;
  if (String(result.kind || 'close').toLowerCase() !== 'close') return false;
  const expiresAt = nextTradingOpenAt(result.tradeDate);
  return expiresAt > 0 && now < expiresAt;
}

const CLOSE_TASK_PENDING_STATES = new Set(['queued', 'checking_cache', 'fetching_data', 'preparing_result']);
let closeSession = null;
let closeLoginPromise = null;

function closeConfig() {
  const settings = (db.get() && db.get().settings) || {};
  const base = String(settings.darkFundCloseApiUrl || process.env.DARK_FUND_CLOSE_API_URL || 'https://fundflow.shiluan.space')
    .trim().replace(/\/+$/, '');
  const username = String(settings.darkFundCloseUsername || process.env.DARK_FUND_CLOSE_USERNAME || '').trim();
  const password = String(settings.darkFundClosePassword || process.env.DARK_FUND_CLOSE_PASSWORD || '');
  return { base, username, password, key: `${base}\n${username}\n${password}` };
}

function timeoutMs() {
  return Math.max(1000, Number(process.env.DARK_FUND_CLOSE_API_TIMEOUT_MS) || 10000);
}

function requestWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function readSetCookies(headers) {
  if (headers && typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const combined = headers && headers.get && headers.get('set-cookie');
  return combined ? combined.split(/,(?=\s*[^;,\s]+=)/) : [];
}

function mergeCookies(jar, headers) {
  readSetCookies(headers).forEach((line) => {
    const pair = String(line).split(';', 1)[0];
    const splitAt = pair.indexOf('=');
    if (splitAt > 0) jar.set(pair.slice(0, splitAt).trim(), pair.slice(splitAt + 1).trim());
  });
}

function cookieHeader(jar) {
  return Array.from(jar.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
}

function csrfFromHtml(html) {
  const matched = String(html || '').match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i)
    || String(html || '').match(/<meta\s+content=["']([^"']+)["']\s+name=["']csrf-token["']/i);
  return matched ? matched[1] : '';
}

async function loginCloseService(config = closeConfig()) {
  const { base, username, password } = config;
  if (!username || !password) {
    throw Object.assign(new Error('盘后数据账号尚未配置'), { status: 503 });
  }
  const cookies = new Map();
  const loginPage = await requestWithTimeout(`${base}/`, { headers: { Accept: 'text/html' } });
  mergeCookies(cookies, loginPage.headers);
  const loginHtml = await loginPage.text();
  const loginCsrf = csrfFromHtml(loginHtml);
  if (!loginPage.ok || !loginCsrf) throw Object.assign(new Error('盘后数据登录页不可用'), { status: 502 });
  const body = new URLSearchParams({ username, password, csrf_token: loginCsrf });
  const loginResponse = await requestWithTimeout(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      'X-CSRF-Token': loginCsrf,
      Cookie: cookieHeader(cookies),
    },
    body: body.toString(),
  });
  mergeCookies(cookies, loginResponse.headers);
  if (![200, 302, 303].includes(loginResponse.status)) {
    throw Object.assign(new Error(`盘后数据登录失败（${loginResponse.status}）`), { status: 502 });
  }
  const appPage = await requestWithTimeout(`${base}/`, {
    headers: { Accept: 'text/html', Cookie: cookieHeader(cookies) },
  });
  mergeCookies(cookies, appPage.headers);
  const appHtml = await appPage.text();
  const csrf = csrfFromHtml(appHtml);
  if (!appPage.ok || !csrf || /<title>\s*登录\s*-/i.test(appHtml)) {
    throw Object.assign(new Error('盘后数据账号或密码不正确'), { status: 502 });
  }
  return { base, cookies, csrf, createdAt: Date.now(), configKey: config.key };
}

async function getCloseSession(force = false) {
  const config = closeConfig();
  if (!force && closeSession && closeSession.configKey === config.key && Date.now() - closeSession.createdAt < 20 * 60 * 1000) return closeSession;
  if (closeSession && closeSession.configKey !== config.key) closeSession = null;
  if (!closeLoginPromise) {
    closeLoginPromise = loginCloseService(config)
      .then((session) => { closeSession = session; return session; })
      .finally(() => { closeLoginPromise = null; });
  }
  return closeLoginPromise;
}

async function closeApiRequest(path, options = {}, retryLogin = true) {
  const session = await getCloseSession();
  const headers = {
    Accept: 'application/json',
    Cookie: cookieHeader(session.cookies),
    ...(options.headers || {}),
  };
  if (options.method && options.method !== 'GET') headers['X-CSRF-Token'] = session.csrf;
  const response = await requestWithTimeout(`${session.base}${path}`, { ...options, headers });
  mergeCookies(session.cookies, response.headers);
  if (response.status === 401 && retryLogin) {
    closeSession = null;
    await getCloseSession(true);
    return closeApiRequest(path, options, false);
  }
  let payload = null;
  try { payload = await response.json(); } catch (error) { payload = {}; }
  if (!response.ok) {
    const message = payload && payload.error ? payload.error : `盘后数据接口返回${response.status}`;
    throw Object.assign(new Error(message), { status: response.status === 429 ? 429 : 502 });
  }
  return payload;
}

function exactSearchStock(items, stockCode) {
  if (!Array.isArray(items)) return null;
  return items.find((item) => stockCodeFrom(item && (item.code || item.stock)) === stockCode) || null;
}

async function searchCloseStock(stockCode, request = closeApiRequest) {
  const items = await request(`/api/search?q=${encodeURIComponent(stockCode)}`);
  const found = exactSearchStock(items, stockCode);
  if (found) return found;
  const count = Array.isArray(items) ? items.length : 0;
  throw Object.assign(new Error(`盘后数据源搜索不到${stockCode}（返回${count}项）`), { status: 404 });
}

async function waitCloseTask(taskId) {
  const pollMs = Math.max(300, Number(process.env.DARK_FUND_CLOSE_POLL_MS) || 800);
  const deadline = Date.now() + Math.max(5000, Number(process.env.DARK_FUND_CLOSE_TASK_TIMEOUT_MS) || 90000);
  while (Date.now() < deadline) {
    const task = await closeApiRequest(`/api/task/${encodeURIComponent(taskId)}`);
    if (task.state === 'ready') return task.result;
    if (task.state === 'failed') throw Object.assign(new Error(task.error || '盘后查询任务失败'), { status: 502 });
    if (!CLOSE_TASK_PENDING_STATES.has(task.state)) {
      throw Object.assign(new Error(`盘后查询返回未知状态：${task.state || '空'}`), { status: 502 });
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw Object.assign(new Error('盘后查询任务等待超时'), { status: 504 });
}

async function fetchCloseDarkFund(stockCode) {
  if (process.env.DARK_FUND_CLOSE_SAMPLE === '1') {
    if (stockCode !== '600105') throw Object.assign(new Error('示例数据仅支持600105'), { status: 503 });
    return normalizeCloseDarkFund(SAMPLE_CLOSE_PAYLOAD, stockCode);
  }
  try {
    const found = await searchCloseStock(stockCode);
    const stock = String(found.code || found.stock || '').trim();
    if (!/^(sh|sz|bj)\d{6}$/i.test(stock)) throw Object.assign(new Error('盘后数据源返回的股票代码无效'), { status: 502 });
    const created = await closeApiRequest('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock }),
    });
    if (!created || !created.task_id) throw Object.assign(new Error('盘后查询未返回任务编号'), { status: 502 });
    return normalizeCloseDarkFund(await waitCloseTask(created.task_id), stockCode);
  } catch (error) {
    if (error && error.name === 'AbortError') throw Object.assign(new Error('盘后数据接口响应超时'), { status: 504 });
    throw error;
  }
}

module.exports = {
  SAMPLE_CLOSE_PAYLOAD,
  exactSearchStock,
  fetchCloseDarkFund,
  isReusableCloseResult,
  nextTradingOpenAt,
  normalizeCloseDarkFund,
  relativeFundError,
  searchCloseStock,
};
