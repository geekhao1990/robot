// Adapt the source dashboard's chart payload to the existing mini-program records.
const DAY = 86400000;
function chartRecords(payload) {
  const data = payload?.gold || payload?.data;
  if (!data || typeof data !== 'object') throw new Error('金手指源接口缺少图表数据');
  function series(name) {
    const points = data[name];
    if (!Array.isArray(points) || !points.length || points.length > 500) throw new Error(`金手指${name}数据为空或过多`);
    const map = new Map();
    for (const point of points) {
      if (!Array.isArray(point) || !Number.isSafeInteger(point[0]) || point[0] <= 0 || !Number.isFinite(new Date(point[0]).getTime()) || typeof point[1] !== 'number' || !Number.isFinite(point[1]) || map.has(point[0])) {
        throw new Error(`金手指${name}时间戳或数值无效/重复`);
      }
      map.set(point[0], point[1]);
    }
    return map;
  }
  const market = series('market'), gp = series('goldPoint'), positions = series('position');
  const bands = data.trendweek;
  if (!Array.isArray(bands) || !bands.length) throw new Error('金手指趋势区间为空');
  const ranges = bands.map((band, i) => {
    if (!Number.isSafeInteger(band.from) || !Number.isSafeInteger(band.to) || band.to < band.from) throw new Error('金手指趋势区间时间无效');
    const color = String(band.color || '').replace(/\s/g, '');
    const trend = /^rgba?\(221,70,60(?:,|\))/.test(color) ? 'up' : /^rgba?\(4,194,4(?:,|\))/.test(color) ? 'down' : null;
    if (!trend) throw new Error('金手指趋势颜色无法识别');
    return { from: band.from, to: band.to + (i === bands.length - 1 ? DAY : 0), trend };
  });
  const dates = new Set();
  const records = [...market.keys()].sort((a, b) => a - b).map(ts => {
    const date = new Date(ts + 8 * 3600000).toISOString().slice(0, 10);
    if (dates.has(date)) throw new Error(`金手指日期${date}重复`);
    dates.add(date);
    const value = gp.get(ts), position = positions.get(ts);
    if (!gp.has(ts) || value < -100 || value > 100) throw new Error(`金手指${date}阴阳谱缺失或超出范围`);
    if (!positions.has(ts) || position < 0 || position > 100) throw new Error(`金手指${date}仓位缺失或超出范围`);
    const matches = ranges.filter(r => ts >= r.from && ts < r.to);
    if (matches.length !== 1) throw new Error(`金手指${date}趋势区间缺失或重叠`);
    // Match the source page exactly, including zero and integer rounding.
    const yang = Math.round(value > 0 ? value : 100 + value);
    return { date, yang, yin: 100 - yang, finger: value > 0 ? 'gold' : 'silver', position, trend: matches[0].trend };
  });
  if (payload.date && payload.date !== records.at(-1).date) throw new Error('金手指快照日期与最新数据日期不一致');
  return records;
}
module.exports = { chartRecords };
