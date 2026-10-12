function historyFor(result) {
  const rows = new Map();
  for (const row of [...(result.historyDays || []), ...(result.days || [])]) {
    if (row && row.tradeDate) rows.set(row.tradeDate, row);
  }
  return [...rows.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
}
function rollingHistory(result, size) {
  const days = historyFor(result);
  const visible = new Set((result.days || []).map(row => row.tradeDate));
  return days.map((row, index) => {
    const window = days.slice(Math.max(0, index - size + 1), index + 1);
    const valid = window.length === size && window.every(item => item.grey != null && Number.isFinite(Number(item.grey)));
    return { tradeDate: row.tradeDate, date: row.tradeDate.slice(5), value: valid ? window.reduce((sum, item) => sum + Number(item.grey), 0) : null };
  }).filter(row => visible.has(row.tradeDate)).slice(-7);
}
function snapshotLabel(result) {
  const label = result.versionLabel || (result.kind === 'intraday' ? '盘中' : '收盘');
  if (result.kind !== 'intraday' && label !== '盘中') return label;
  const version = String(result.versionKey || '').match(/T(\d{2}):?(\d{2})/);
  return version ? `盘中 ${version[1]}:${version[2]}` : '盘中（快照时间未知）';
}
function historyChart(result) {
  const days = historyFor(result).slice(-30);
  const signal = row => {
    const raw = String(row && row.gs || '').trim();
    if (/^[1-4]$/.test(raw)) return Number(raw) >= 3 ? 'G' : 'S';
    return /^[GS]$/i.test(raw) ? raw.toUpperCase() : '';
  };
  const maximum = Math.max(1, ...days.map(row => Math.abs(Number(row.main) || 0)));
  const amount = value => {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    const n = Number(value), absolute = Math.abs(n);
    return `${n > 0 ? '+' : n < 0 ? '-' : ''}${(absolute / (absolute >= 1e8 ? 1e8 : 1e4)).toFixed(absolute >= 1e8 ? 2 : 1)}${absolute >= 1e8 ? '亿' : '万'}`;
  };
  return days.map((row,index) => {
    const current = signal(row);
    const encoded = /^[1-4]$/.test(String(row.gs));
    const changed = encoded ? [2,3].includes(Number(row.gs)) : !!(index && current && signal(days[index - 1]) && current !== signal(days[index - 1]));
    return {
    ...row, index, date: row.tradeDate.slice(5),
    weekday: '日一二三四五六'[new Date(`${row.tradeDate}T00:00:00Z`).getUTCDay()],
    height: Math.abs(Number(row.main) || 0) / maximum * 100,
    gsText: current || '—',
    gsChanged: changed,
    gsBadge: current ? (changed ? current : current.toLowerCase()) : '',
    gsLabel: current ? `${current}${changed ? '信号' : '区间'}` : '暂无',
    gsClass: current ? `${current === 'S' ? 'signal-s' : 'signal-g'}${changed ? ' signal-change' : ''}` : 'signal-none',
    metrics: [['main','主力合计'],['grey','暗盘'],['listed','明盘'],['super_large','特大单'],['large','大单'],['middle','中单'],['small','小单']].map(([key,label])=>({key,label,text:amount(row[key]),positive:Number(row[key])>=0})),
    mainText: amount(row.main),
  }; });
}
function historySummary(result) {
  const rows = historyChart(result);
  if (!rows.length) return '暂无资金数据。';
  const inflows = rows.filter(row => Number(row.main) > 0);
  const best = inflows.reduce((max,row)=>!max || Number(row.main)>Number(max.main) ? row : max,null);
  let text = `${rows.length}日中${inflows.length}日净流入` + (best ? `，${best.date}净流入最高（${best.mainText}）。` : '。');
  let index = rows.length - 1;
  while(index >= 0 && rows[index].gsText === '—') index--;
  if(index < 0) text += '暂无GS信号。';
  else {
    let start = index;
    while(start > 0 && rows[start-1].gsText === rows[index].gsText && !rows[start].gsChanged) start--;
    text += `GS信号：${rows[index].date}为${rows[index].gsLabel}，${start===0?'窗口内':''}已持续${index-start+1}个交易日。`;
  }
  if(result.kind === 'intraday' && rows[rows.length-1].gsText === '—') text += '当日信号收盘后更新。';
  return text;
}
function updatedMinute(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time + 8*3600000).toISOString().slice(0,16).replace('T',' ') : '—';
}
module.exports = { historyFor, rollingHistory, snapshotLabel, historyChart, historySummary, updatedMinute };
