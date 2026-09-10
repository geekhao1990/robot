// 中国法定节假日与周末均按非交易日处理。
// 2026 年日期依据国务院办公厅放假安排；证券市场周末不随调休开市。
const HOLIDAYS = new Set([
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
  '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
  '2026-10-05', '2026-10-06', '2026-10-07',
]);

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function chinaToday(timestamp = Date.now()) {
  return dateKey(new Date(timestamp + 8 * 3600 * 1000));
}

function isTradingDay(value) {
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return false;
  const day = date.getUTCDay();
  return day !== 0 && day !== 6 && !HOLIDAYS.has(value);
}

function previousDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return dateKey(date);
}

function latestTradingDate(timestamp = Date.now()) {
  let value = chinaToday(timestamp);
  while (!isTradingDay(value)) value = previousDate(value);
  return value;
}

function compactDate(value) {
  return String(value || '').replaceAll('-', '').slice(2);
}

module.exports = { HOLIDAYS, chinaToday, isTradingDay, latestTradingDate, compactDate };
