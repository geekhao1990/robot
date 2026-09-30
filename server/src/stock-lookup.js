const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();

function isBeijingStockCode(code) {
  const value = String(code || '').trim();
  return /^4|^8|^92/.test(value);
}

function marketFor(code) {
  const value = String(code || '').trim();
  if (!/^\d{6}$/.test(value)) return '';
  if (isBeijingStockCode(value)) return 'beijing';
  return /^[569]/.test(value) ? '1' : '0';
}

async function lookupStock(code, fetchImpl = global.fetch) {
  const value = String(code || '').trim();
  const market = marketFor(value);
  if (!market) {
    const error = new Error('请输入6位股票代码');
    error.status = 400;
    throw error;
  }
  if (market === 'beijing') {
    const error = new Error('系统繁忙');
    error.status = 503;
    throw error;
  }
  const cached = cache.get(value);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  if (typeof fetchImpl !== 'function') throw new Error('行情查询服务不可用');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${market}.${value}&fields=f57,f58`;
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'NiuLai/1.0' },
    });
    if (!response || !response.ok) throw new Error('股票信息查询失败');
    const payload = await response.json();
    const stockCode = String(payload && payload.data && payload.data.f57 || value).trim();
    const stockName = String(payload && payload.data && payload.data.f58 || '').trim();
    if (!/^\d{6}$/.test(stockCode) || !stockName || stockName === '-') {
      const error = new Error('未找到该股票代码');
      error.status = 404;
      throw error;
    }
    const result = { stockCode, stockName };
    cache.set(value, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isBeijingStockCode, lookupStock, marketFor };
