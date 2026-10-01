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

function normalizeCloseDarkFund(payload, expectedCode = '') {
  if (!payload || typeof payload !== 'object') throw new Error('盘后数据为空');
  const stockCode = stockCodeFrom(payload.stock || payload.stock_code);
  const name = String(payload.name || payload.stock_name || '').trim();
  const tradeDate = String(payload.trade_date || '').trim();
  const versionLabel = String(payload.version_label || '收盘').trim() || '收盘';
  if (!/^\d{6}$/.test(stockCode)) throw new Error('股票代码缺失');
  if (expectedCode && stockCode !== expectedCode) throw new Error('盘后数据股票代码不匹配');
  if (!name) throw new Error('股票名称缺失');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) throw new Error('交易日期格式不正确');
  if (!Array.isArray(payload.days) || !payload.days.length) throw new Error('盘后资金明细为空');
  const days = payload.days.map((item, index) => {
    const rowDate = String(item && item.trade_date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rowDate)) throw new Error(`第${index + 1}条交易日期格式不正确`);
    const row = { tradeDate: rowDate };
    MONEY_FIELDS.forEach((field) => { row[field] = finiteNumber(item[field], `${rowDate} ${field}`); });
    return row;
  }).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const latest = days[days.length - 1];
  if (latest.tradeDate !== tradeDate) throw new Error('交易日期与最新资金明细不一致');
  const tolerance = Math.max(1, Math.abs(latest.main) * 0.001);
  if (Math.abs(latest.grey + latest.listed - latest.main) > tolerance) {
    throw new Error('主力明盘与暗盘加总存在误差');
  }
  return {
    type: 'close_snapshot',
    stockCode,
    stockName: name,
    tradeDate,
    versionLabel,
    days,
  };
}

function closeApiUrl(stockCode) {
  const template = String(process.env.DARK_FUND_CLOSE_API_URL || '').trim();
  if (!template) return '';
  if (template.includes('{stockCode}') || template.includes('{stock}')) {
    return template
      .replaceAll('{stockCode}', encodeURIComponent(stockCode))
      .replaceAll('{stock}', encodeURIComponent(`${/^[569]/.test(stockCode) ? 'sh' : 'sz'}${stockCode}`));
  }
  const url = new URL(template);
  url.searchParams.set('stock', `${/^[569]/.test(stockCode) ? 'sh' : 'sz'}${stockCode}`);
  return url.toString();
}

async function fetchCloseDarkFund(stockCode) {
  if (process.env.DARK_FUND_CLOSE_SAMPLE === '1') {
    if (stockCode !== '600105') throw Object.assign(new Error('示例数据仅支持600105'), { status: 503 });
    return normalizeCloseDarkFund(SAMPLE_CLOSE_PAYLOAD, stockCode);
  }
  const url = closeApiUrl(stockCode);
  if (!url) throw Object.assign(new Error('盘后数据接口尚未配置，可改用采集器查询'), { status: 503 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.DARK_FUND_CLOSE_API_TIMEOUT_MS) || 10000);
  try {
    const headers = { Accept: 'application/json' };
    const token = String(process.env.DARK_FUND_CLOSE_API_TOKEN || '').trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw Object.assign(new Error(`盘后数据接口返回${response.status}`), { status: 502 });
    return normalizeCloseDarkFund(await response.json(), stockCode);
  } catch (error) {
    if (error && error.name === 'AbortError') throw Object.assign(new Error('盘后数据接口响应超时'), { status: 504 });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  SAMPLE_CLOSE_PAYLOAD,
  fetchCloseDarkFund,
  normalizeCloseDarkFund,
};
