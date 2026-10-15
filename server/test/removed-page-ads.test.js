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
test('fund flow snapshot removes native ad and retains interstitial deduplication',()=>{
  const view=read('dark-funds-result','wxml');
  assert.doesNotMatch(view, /<ad\b|close-banner-ad|版本：/);
  assert.doesNotMatch(read('dark-funds-result','js'), /closeBannerAd|盘后数据不存在|snapshotLabel\(/);
  assert.equal(JSON.parse(read('dark-funds-result','json')).navigationBarTitleText, '资金流向');
  assert.match(view, /快照时间/);
  assert.match(read('dark-funds-result','js'),/if \(!this.skipResultAd\) this.showCloseInterstitial/);
});
