const crypto = require('crypto');

function configuredUrl() {
  const value = String(process.env.COLLECTOR_ORDERS_URL || '').trim();
  if (!/^https?:\/\//i.test(value)) {
    const error = new Error('采集机地址未配置：请设置 COLLECTOR_ORDERS_URL');
    error.status = 503;
    throw error;
  }
  return value.replace(/\/$/, '') + (value.endsWith('/orders') ? '' : '/orders');
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function callbackAuthorized(headers = {}) {
  const expected = String(process.env.STOCK_ANALYSIS_CALLBACK_TOKEN || '').trim();
  const provided = String(headers['x-stock-callback-token'] || '').trim();
  return Boolean(expected && secureEqual(expected, provided));
}

async function dispatchStockAnalysis(order) {
  const token = String(process.env.COLLECTOR_API_TOKEN || '').trim();
  if (!token) {
    const error = new Error('采集机鉴权未配置：请设置 COLLECTOR_API_TOKEN');
    error.status = 503;
    throw error;
  }
  const url = configuredUrl();
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          order_id: order.id,
          stock_code: order.stockCode,
          trading_date: order.tradeDate,
          requested_at: new Date(order.createdAt).toISOString(),
        }),
        signal: AbortSignal.timeout(8000),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.ok === true && payload.status === 'queued' && payload.order_id === order.id) {
        return payload;
      }
      const error = new Error(payload.error || `采集机拒绝任务（HTTP ${response.status}）`);
      error.status = 502;
      if (response.status < 500) {
        error.retryable = false;
        throw error;
      }
      lastError = error;
    } catch (cause) {
      if (cause && cause.retryable === false) throw cause;
      lastError = cause;
    }
  }
  const error = new Error(lastError && lastError.name === 'TimeoutError' ? '采集机接单超时' : '无法连接 Windows 采集机');
  error.status = 502;
  throw error;
}

module.exports = { callbackAuthorized, dispatchStockAnalysis };
