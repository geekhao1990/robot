const stockMap = require('../data/stock-map.json');

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

function lookupStock(code) {
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
  const stockName = String(stockMap[value] || '').trim();
  return { stockCode: value, stockName, matched: Boolean(stockName) };
}

module.exports = { isBeijingStockCode, lookupStock, marketFor };
