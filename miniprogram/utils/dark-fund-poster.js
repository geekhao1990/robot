function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function exactAmount(value) {
  const amount = number(value);
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : '';
  const absolute = Math.abs(amount);
  if (absolute >= 100000000) return `${sign}${(absolute / 100000000).toFixed(2)}亿`;
  return `${sign}${(absolute / 10000).toFixed(1)}万`;
}

function maskedAmount(value) {
  const amount = number(value);
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : '';
  const absolute = Math.abs(amount);
  if (absolute >= 100000000) {
    const digits = Math.max(1, Math.floor(absolute / 100000000).toString().length);
    return `${sign}${'x'.repeat(digits)}.xx亿`;
  }
  const digits = Math.max(1, Math.round(absolute / 10000).toString().length);
  return `${sign}${'x'.repeat(digits)}万`;
}

function posterMetrics(result, display = {}) {
  const days = Array.isArray(result && result.days)
    ? result.days.slice().sort((a, b) => String(a.tradeDate).localeCompare(String(b.tradeDate)))
    : [];
  const latest = days[days.length - 1] || {};
  const sum = (size) => days.slice(-size).reduce((total, row) => total + number(row.grey), 0);
  const suffix = String(display.unitLabel || '').replace(/元$/, '');
  const bars = Array.isArray(display.dayBars) ? display.dayBars : [];
  const barTexts = bars.map((item) => String(item && item.text || ''));
  return {
    stockName: String(result && (result.stockName || result.displayName) || '股票'),
    stockCode: String(result && (result.displayCode || result.stockCode) || ''),
    tradeDate: String(result && result.tradeDate || latest.tradeDate || ''),
    latest,
    day1: number(latest.grey),
    day3: sum(3),
    day5: sum(5),
    day1Text: barTexts[1] ? `${barTexts[1]}${suffix}` : exactAmount(latest.grey),
    day3Text: maskedAmount(sum(3)),
    day5Text: maskedAmount(sum(5)),
    barTexts,
  };
}

module.exports = { exactAmount, maskedAmount, posterMetrics };
