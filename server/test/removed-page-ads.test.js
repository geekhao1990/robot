const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=(page,ext)=>fs.readFileSync(path.join(__dirname,`../../miniprogram/pages/${page}/${page}.${ext}`),'utf8');
test('message center and dark history no longer render or load removed ad slots',()=>{
  assert.doesNotMatch(read('message-center','wxml'),/<ad\b/);
  assert.doesNotMatch(read('message-center','js'),/messageCenter(?:Bottom)?Ad/);
  assert.doesNotMatch(read('dark-funds','wxml'),/historyAd|onHistoryAd/);
  assert.doesNotMatch(read('dark-funds','js'),/historyAd|HistoryAd/);
  assert.match(read('dark-funds','wxml'),/<ad unit-id="\{\{queryAdUnitId\}\}"/);
});
test('result banner stays above disclaimer and result interstitial keeps skip guard',()=>{
  const view=read('dark-funds-result','wxml');
  assert(view.indexOf('<ad unit-id="{{closeBannerAdUnitId}}"')<view.indexOf('<view class="disclaimer">'));
  assert.match(read('dark-funds-result','js'),/if \(!this.skipResultAd\) this.showCloseInterstitial/);
});
