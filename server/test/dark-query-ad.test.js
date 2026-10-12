const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {isTradingTime}=require('../src/trading-date');
const {showQueryAd}=require('../../miniprogram/utils/dark-query-ad');
test('Beijing trading sessions, lunch, weekends and holidays',()=>{
  for(const [time,expected] of [['09:29',false],['09:30',true],['11:29',true],['11:30',false],['12:30',false],['13:00',true],['14:59',true],['15:00',false]])assert.equal(isTradingTime(Date.parse(`2026-10-12T${time}:00+08:00`)),expected,time);
  assert.equal(isTradingTime(Date.parse('2026-10-11T10:00:00+08:00')),false);
  assert.equal(isTradingTime(Date.parse('2026-10-01T10:00:00+08:00')),false);
});
function sdk(){const handlers={};let destroyed=0;return {handlers,get destroyed(){return destroyed;},api:{createRewardedVideoAd:()=>({onClose:f=>handlers.close=f,onError:f=>handlers.error=f,show:()=>Promise.resolve(),destroy:()=>destroyed++})}};}
test('ad completion permits query; early close and navigation cancel it; errors degrade',async()=>{
  for(const [action,expected] of [['complete',true],['close',false],['cancel',false],['error',true]]){
    const mock=sdk(),ad=showQueryAd(mock.api,'adunit-test');
    if(action==='cancel')ad.cancel();else if(action==='error')mock.handlers.error();else mock.handlers.close({isEnded:action==='complete'});
    assert.equal(await ad.promise,expected);assert.equal(mock.destroyed,1);
  }
  assert.equal(await showQueryAd({},'').promise,true);
});
test('only off-session close/gold queries show ads and submit only after completion',async()=>{
  for(const mode of ['close','gold','intraday'])for(const trading of [true,false]){
    let page,orders=0,ads=0;let complete;
    const api={getDarkFundTradeDate:async()=>({isTradingTime:trading}),getAppSettings:async()=>({rewardedAdEnabled:true,rewardedVideoAdUnitId:'adunit-normal',goldRewardedVideoAdUnitId:'adunit-gold'})};
    vm.runInNewContext(fs.readFileSync(require.resolve('../../miniprogram/pages/dark-funds/dark-funds.js'),'utf8'),{Page:p=>page=p,require:id=>id.endsWith('/api')?api:id.endsWith('/dark-query-ad')?{showQueryAd:(wx,id)=>{ads++;assert.equal(id,mode==='gold'?'adunit-gold':'adunit-normal');return {promise:new Promise(r=>complete=r)};}}:{},wx:{showToast:()=>{},showModal:()=>{}},console,setTimeout,clearTimeout,setInterval,clearInterval});
    page.data={querying:false};page.query=()=>{orders++;};
    const pending=page.queryWithRewardedAd('600105',mode,'web');
    await new Promise(r=>setImmediate(r));
    if(!trading&&mode!=='intraday'){assert.equal(orders,0);await page.queryWithRewardedAd('600105',mode,'web');assert.equal(ads,1);complete(true);}
    await pending;assert.equal(orders,1);assert.equal(ads,!trading&&mode!=='intraday'?1:0);
  }
});
