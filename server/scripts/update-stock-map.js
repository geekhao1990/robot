const fs = require('fs');
const path = require('path');
const { pinyin } = require('pinyin-pro');

const PAGE_SIZE = 100;
const CONCURRENCY = 5;
const output = path.join(__dirname, '../data/stock-map.json');

function displayStockName(name) {
  const value = String(name || '').trim();
  const initials = pinyin(value, { pattern: 'first', toneType: 'none', type: 'array' });
  let chineseCount = 0;
  return Array.from(value).map((char, index) => {
    if (!/[\u3400-\u9fff]/u.test(char)) return char;
    chineseCount += 1;
    if (chineseCount <= 2) return char;
    const initial = initials[index];
    return /^[a-z]$/i.test(initial) ? initial.toUpperCase() : char;
  }).join('');
}

function requestUrl(page) {
  const params = new URLSearchParams({
    pn: String(page),
    pz: String(PAGE_SIZE),
    po: '1',
    np: '1',
    fltt: '2',
    invt: '2',
    fid: 'f3',
    // 沪深主板、创业板、科创板；北交所不进入本地 Map。
    fs: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23',
    fields: 'f12,f14',
  });
  return `https://push2.eastmoney.com/api/qt/clist/get?${params}`;
}

async function fetchPage(page) {
  const response = await fetch(requestUrl(page), { headers: { 'User-Agent': 'NiuLai-Stock-Map-Updater/1.0' } });
  if (!response.ok) throw new Error(`股票列表第${page}页请求失败：HTTP ${response.status}`);
  const payload = await response.json();
  return {
    total: Number(payload && payload.data && payload.data.total) || 0,
    rows: Array.isArray(payload && payload.data && payload.data.diff) ? payload.data.diff : [],
  };
}

async function main() {
  const first = await fetchPage(1);
  const pages = Math.max(1, Math.ceil(first.total / PAGE_SIZE));
  const all = first.rows.slice();
  let nextPage = 2;
  async function worker() {
    while (nextPage <= pages) {
      const page = nextPage;
      nextPage += 1;
      const result = await fetchPage(page);
      all.push(...result.rows);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const map = {};
  all.forEach((row) => {
    const code = String(row && row.f12 || '').trim();
    const name = String(row && row.f14 || '').trim();
    if (/^\d{6}$/.test(code) && name && name !== '-') map[code] = displayStockName(name);
  });
  const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(output, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
  console.log(`股票 Map 已更新：${Object.keys(sorted).length} 条 -> ${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
