const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
test('fund reading guide and gold update notice are visible in their intended sections',()=>{
  const read=name=>fs.readFileSync(path.join(__dirname,`../../miniprogram/pages/${name}/${name}.wxml`),'utf8');
  const dark=read('dark-funds'),gold=read('gold-finger');
  assert.match(dark,/bindtap="switchTab">资金流向/);
  assert.match(dark,/怎么读这份资金流向/);
  assert.match(dark,/G \/ S 信号每日收盘后更新/);
  assert(gold.indexOf('history-update-note')>gold.indexOf('点金历史'));
  assert(gold.indexOf('history-update-note')<gold.indexOf('手动刷新'));
  assert(gold.indexOf('history-reading-note')>gold.indexOf('history-head history-grid'));
  assert(gold.indexOf('history-reading-note')<gold.indexOf('class="gold-ad-slot"'));
  assert.match(gold, /history-reading-note">Tips：/);
  assert.doesNotMatch(gold, /以设定更新时间为准/);
  assert.match(gold, /history-update-note">非实时更新，每半小时更新一次。<\/view>/);
  assert.match(gold, /bindtap="refreshGoldFinger"[^>]*><view class="refresh-icon/);
});

test('monthly package precedes 300 uses and has the best-value badge',()=>{
  const base=path.join(__dirname,'../../miniprogram/pages/dark-funds/dark-funds');
  const source=fs.readFileSync(base+'.js','utf8');
  const markup=fs.readFileSync(base+'.wxml','utf8');
  assert(source.indexOf("sku: 'dark_fund_month'")<source.indexOf("sku: 'dark_fund_300'"));
  assert.match(source,/sku: 'dark_fund_month'[^\n]+price: '30元'[^\n]+badge: '最划算'/);
  assert.match(markup,/wx:if="\{\{item.badge\}\}" class="topup-best"/);
});
test('daily free button is member-only and shares a row equally with ordinary query',()=>{
  const base=path.join(__dirname,'../../miniprogram/pages/dark-funds/dark-funds');
  const wxml=fs.readFileSync(base+'.wxml','utf8'),css=fs.readFileSync(base+'.wxss','utf8');
  assert.match(wxml,/<button wx:if="\{\{goldActive\}\}"[^>]+bindtap="prepareGoldQuery"[^>]+><text class="query-button-title">会员查询/);
  assert.match(css, /width: 750rpx; margin-left: -56rpx/);
  assert.match(css, /flex: 1 1 0; width: 0/);
  assert.match(css, /gap: 20rpx; width: 750rpx/);
  assert.match(css, /padding: 0 24rpx; box-sizing: border-box/);
  assert.match(wxml, /class="query-pair"/);
  assert.match(wxml,/dateLoading \|\| querying \|\| !goldDarkFundAvailable/);
});
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
