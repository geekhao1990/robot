// This preview is unlocked only by the SDK's explicit completion callback.
// Unlike ordinary query ads, unavailable/failed ads must not unlock it.
function showRewardedPreview(wxApi, adUnitId) {
  let ad, timer, done = false, resolveResult;
  const promise = new Promise(resolve => { resolveResult = resolve; });
  const cleanup = () => {
    clearTimeout(timer);
    if (!ad) return;
    for (const [method, callback] of [['offClose', onClose], ['offError', onError], ['destroy']]) {
      try { if (typeof ad[method] === 'function') ad[method](callback); } catch (_) {}
    }
  };
  const finish = status => {
    if (done) return;
    done = true;
    cleanup();
    resolveResult(status);
  };
  const onClose = result => finish(result && result.isEnded === true ? 'completed' : 'skipped');
  const onError = () => finish('unavailable');
  if (typeof wxApi.createRewardedVideoAd !== 'function' || !/^adunit-(?!x+$)[\w-]+$/i.test(adUnitId || '')) {
    finish('unavailable');
  } else {
    try {
      ad = wxApi.createRewardedVideoAd({ adUnitId });
      ad.onClose(onClose);
      ad.onError(onError);
      timer = setTimeout(onError, 8000);
      Promise.resolve(ad.load ? ad.load() : undefined)
        .then(() => { if (!done) return ad.show(); })
        .then(() => { clearTimeout(timer); })
        .catch(onError);
    } catch (_) { onError(); }
  }
  return { promise, cancel: () => finish('cancelled') };
}

module.exports = { showRewardedPreview };
