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
module.exports = {showQueryAd};
