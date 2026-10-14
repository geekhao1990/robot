const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function page(api){
  let page,scheduled;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/pages/dark-funds/dark-funds.js'),'utf8'),{
    require:()=>api,Page:p=>page=p,wx:{},setTimeout:fn=>{scheduled=fn;return 1;},clearTimeout(){},
  });
  page.setData=patch=>Object.assign(page.data,patch);
  return {page,run:()=>scheduled()};
}
test('Chinese candidates require selection and stale responses cannot overwrite new input',async()=>{
  const pending=[];const {page:p,run}=page({searchStocks:q=>new Promise(resolve=>pending.push({q,resolve}))});
  p.onCodeInput({detail:{value:'贵州'}});run();
  p.onCodeInput({detail:{value:'ztkj'}});run();
  pending[0].resolve({list:[{stockCode:'600519',stockName:'贵州茅台'}]});
  await new Promise(setImmediate);assert.equal(p.data.stockSuggestions.length,0);
  pending[1].resolve({list:[{stockCode:'600522',stockName:'中天科技'}]});
  await new Promise(setImmediate);assert.equal(p.data.stockCode,'');
  p.selectStock({currentTarget:{dataset:{code:'600522'}}});
  assert.equal(p.data.stockCode,'600522');assert.equal(p.data.stockSuggestion.stockName,'中天科技');
  p.onCodeInput({detail:{value:''}});assert.equal(p.data.stockSuggestion,null);assert.equal(p.data.stockCode,'');
});
test('ranking refresh loads data without repeatedly opening interstitial',async()=>{
  let ads=0;
  const {page:p}=page({getAppSettings:async()=>({darkFundsCloseInterstitialAdUnitId:'adunit-test'}),
    getDarkFundRanking:async()=>({empty:true}),showQueryAd:()=>{ads++;return {promise:Promise.resolve(true),cancel(){}};}});
  p.data.tab='ranking';
  await p.loadRanking();await p.loadRanking();assert.equal(ads,1);
});
