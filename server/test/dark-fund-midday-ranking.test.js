const test=require('node:test');
const assert=require('node:assert/strict');
const {validResult,itemOf,buildRanking,inWindow}=require('../src/dark-fund-midday-ranking');
const date='2026-11-03',candidate={stockCode:'600105',stockName:'永鼎股份'};
const result=()=>({type:'close_snapshot',validationVersion:2,stockCode:'600105',tradeDate:date,kind:'intraday',versionLabel:'盘中 11:30',updatedAt:date+' 11:40:00',days:[{tradeDate:date,main:100,grey:90,listed:10}]});
test('midday scheduler only runs trading days from 11:40 until afternoon open',()=>{
  const t=s=>Date.parse(date+'T'+s+':00+08:00');
  assert.equal(inWindow(t('11:39')),false);assert.equal(inWindow(t('11:40')),true);
  assert.equal(inWindow(t('12:59')),true);assert.equal(inWindow(t('13:00')),false);
  assert.equal(inWindow(Date.parse('2026-11-07T11:40:00+08:00')),false);
});
test('accepts current midday snapshots but refuses stale, afternoon, close and unknown times',()=>{
  assert.equal(validResult(result(),'600105',date),true);
  for(const patch of [{stockCode:'600159'},{tradeDate:'2026-11-02'},{kind:'close'},{versionLabel:'盘中11:00'},{versionLabel:'盘中13:30'}, {versionLabel:'盘中',updatedAt:''},{versionLabel:'盘中',updatedAt:date+' 13:00:00'}])assert.equal(validResult({...result(),...patch},'600105',date),false);
  assert.equal(validResult({...result(),versionLabel:'盘中'},'600105',date),true);
  assert.equal(validResult({...result(),versionLabel:'盘中11:40'},'600105',date),true);
});
test('media ranking sorts by grey fund direction and keeps close snapshots isolated',()=>{
  const item=itemOf(candidate,result(),date);
  const rows=[item,{...item,stockCode:'600159',grey:-200},{...item,stockCode:'600519',grey:300}];
  const rank=buildRanking(date,rows,[],3);
  assert.equal(rank.session,'midday');assert.equal(rank.inflow[0].grey,300);assert.equal(rank.outflow[0].grey,-200);
  assert.equal(rank.snapshotLabel,'截至11:30午间收盘');
  assert.throws(()=>itemOf(candidate,{...result(),days:[]},date));
});
