// One ad per confirmed query. A closed/left page must never submit an order.
function showQueryAd(wxApi, adUnitId) {
  let cancel = () => {};
  const promise = new Promise(resolve => {
    let ad, timer, done = false;
    const finish = allowed => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (ad) {
        if (ad.offClose) ad.offClose(onClose);
        if (ad.offError) ad.offError(onError);
        if (ad.destroy) ad.destroy();
      }
      resolve(allowed);
    };
    const onClose = result => finish(!result || result.isEnded === true);
    const onError = () => finish(true); // Match existing gold-page unavailable-ad fallback.
    cancel = () => finish(false);
    if (!wxApi.createRewardedVideoAd || !/^adunit-(?!x+$)[\w-]+$/i.test(adUnitId || '')) return finish(true);
    try {
      ad = wxApi.createRewardedVideoAd({adUnitId});
      ad.onClose(onClose);ad.onError(onError);
      timer = setTimeout(onError, 8000);
      Promise.resolve(ad.load ? ad.load() : undefined)
        .then(() => { if (!done) return ad.show(); })
        .then(() => { clearTimeout(timer); }).catch(onError);
    } catch (_) { onError(); }
  });
  return {promise, cancel: () => cancel()};
}
function tradingTimeForAd(trade, timestamp = Date.now()) {
  if (trade && typeof trade.isTradingTime === 'boolean') return trade.isTradingTime;
  const now = new Date(timestamp + 8 * 3600 * 1000);
  const today = now.toISOString().slice(0, 10);
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (now.getUTCDay() === 0 || now.getUTCDay() === 6) return false;
  if (!trade || !/^\d{4}-\d{2}-\d{2}$/.test(trade.tradeDate || '')) return null;
  if (trade.tradeDate !== today) return false;
  return (minutes >= 570 && minutes < 690) || (minutes >= 780 && minutes < 900);
}
module.exports = {showQueryAd, tradingTimeForAd};
