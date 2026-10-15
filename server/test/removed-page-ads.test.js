const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=(page,ext)=>fs.readFileSync(path.join(__dirname,`../../miniprogram/pages/${page}/${page}.${ext}`),'utf8');

test('only the existing official no-QR share entry remains',()=>{
  const view=read('dark-funds-result','wxml');
  assert.equal((view.match(/bindtap="generateSharePoster"/g)||[]).length,1);
  assert.match(view,/data-no-qr="true" bindtap="generateSharePoster"/);
  assert.doesNotMatch(view,/无二维码分享图/);
  assert.match(view,/生成分享图/);
});

test('ranking and detail consume separate public ad settings',()=>{
  const source=read('dark-funds','js');
  const ranking=source.slice(source.indexOf('  loadRanking()'),source.indexOf('    if (this._rankingRequesting)'));
  assert.match(ranking,/darkFundsRankingInterstitialAdUnitId/);
  assert.doesNotMatch(ranking,/darkFundsCloseInterstitialAdUnitId/);
  assert.match(read('dark-funds-result','js'),/settings.darkFundsCloseInterstitialAdUnitId/);
  const {pubSettings}=require('../src/util');
  const result=pubSettings({settings:{darkFundsRankingInterstitialAdUnitId:'adunit-rank',darkFundsCloseInterstitialAdUnitId:'adunit-detail'}});
  assert.equal(result.darkFundsRankingInterstitialAdUnitId,'adunit-rank');
  assert.equal(result.darkFundsCloseInterstitialAdUnitId,'adunit-detail');
});
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
