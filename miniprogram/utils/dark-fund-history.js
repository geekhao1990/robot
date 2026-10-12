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
module.exports = { historyFor, rollingHistory, snapshotLabel };
