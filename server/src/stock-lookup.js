const stockMap = require('../data/stock-map.json');
const { pinyin } = require('pinyin-pro');

function stockInitials(name) {
  const value = String(name || '').trim();
  if (!value) return '';
  return pinyin(value, { pattern: 'first', toneType: 'none', type: 'array' })
    .map((item) => /^[a-z]$/i.test(item) ? item.toUpperCase() : item)
    .join('');
}

function stockDisplayName(name, initials = stockInitials(name)) {
  const chars = Array.from(String(name || '').trim());
  const letters = Array.from(String(initials || ''));
  let chineseCount = 0;
  return chars.map((char, index) => {
    if (!/[\u3400-\u9fff]/u.test(char)) return char;
    chineseCount += 1;
    if (chineseCount <= 2) return char;
    const initial = letters[index];
    return /^[a-z]$/i.test(initial || '') ? initial.toUpperCase() : char;
  }).join('');
}

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
  const entry = stockMap[value];
  const stockName = String(entry && typeof entry === 'object' ? entry.name : entry || '').trim();
  const initials = stockInitials(stockName);
  const displayName = String(entry && typeof entry === 'object' ? entry.displayName : '').trim()
    || stockDisplayName(stockName, initials);
  return {
    stockCode: value,
    stockName,
    stockInitials: initials,
    stockDisplayName: displayName,
    matched: Boolean(stockName),
  };
}

let searchIndex;
function searchStocks(query) {
  const value=String(query || '').trim().toUpperCase();
  if(!value || value.length>30)return {list:[]};
  if(/^\d{6}$/.test(value))return {list:[lookupStock(value)]};
  if(!searchIndex)searchIndex=Object.keys(stockMap).filter(code=>!isBeijingStockCode(code)).map(lookupStock);
  const score=row=>row.stockCode===value||row.stockName.toUpperCase()===value||row.stockInitials===value?0:
    row.stockCode.startsWith(value)||row.stockName.toUpperCase().startsWith(value)||row.stockInitials.startsWith(value)?1:2;
  return {list:searchIndex.filter(row=>row.stockCode.includes(value)||row.stockName.toUpperCase().includes(value)||row.stockInitials.includes(value))
    .sort((a,b)=>score(a)-score(b)||a.stockCode.localeCompare(b.stockCode)).slice(0,20)};
}
module.exports = { isBeijingStockCode, lookupStock, searchStocks, marketFor, stockDisplayName, stockInitials };
