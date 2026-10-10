const test=require('node:test');
const assert=require('node:assert/strict');
const a=require('../src/fund-article');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
test('admin job uses shared queue, rejects anonymous access and generation reuses funds',async()=>{
  const {createRouter,HttpError}=require('../src/router');const router=createRouter();
  const state={};let queries=0,generations=0;
  const mod={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/routes/fund-article.js'),'utf8'),{module:mod,console,process:{env:{DEEPSEEK_API_KEY:'test'}},require:id=>({
    '../auth':{isAdmin:v=>v==='admin'},'../db':{get:()=>state,save:async()=>{}},
    '../dark-fund-close':{isReusableCloseResult:()=>false},
    '../dark-fund-close-queue':{getQueueStatus:()=>({}),requestCloseDarkFund:async(code,options)=>{queries++;assert.equal(options.priority,'user');return {tradeDate:'2026-10-09'};}},
    '../fund-article':{prepareFunds:()=>({days:[1,2,3,4,5,6,7]}),supplement:async()=>({quote:{},notices:[],warnings:[]}),manualFields:()=>({}),generate:async()=>{generations++;return {title:'test'};}}
  }[id]||require(id))});mod.exports(router,HttpError);
  const call=(method,url,body={},authorization='admin')=>{const match=router.match(method,url);return match.handler({body,headers:{authorization},params:match.params});};
  assert.throws(()=>call('POST','/api/admin/fund-article/jobs',{stockCode:'000001'},''),e=>e.status===401);
  const j=call('POST','/api/admin/fund-article/jobs',{stockCode:'000001'});
  await new Promise(r=>setImmediate(r));
  assert.equal(call('GET','/api/admin/fund-article/jobs/'+j.id).status,'ready');
  call('POST','/api/admin/fund-article/jobs/'+j.id+'/generate');await new Promise(r=>setImmediate(r));
  call('POST','/api/admin/fund-article/jobs/'+j.id+'/generate');await new Promise(r=>setImmediate(r));
  assert.equal(queries,1);assert.equal(generations,2);assert.equal(call('GET','/api/admin/fund-article/jobs/'+j.id).status,'done');
});
test('fund summaries use real available rows and do not mutate source',()=>{
  const r={kind:'close',stockCode:'000001',tradeDate:'2026-10-09',days:[{tradeDate:'2026-10-09',main:50000,listed:20000,grey:30000},{tradeDate:'2026-10-08',main:10000,listed:30000,grey:-20000},{tradeDate:'2026-09-30',main:30000,listed:20000,grey:10000}]};
  const before=JSON.stringify(r),f=a.prepareFunds(r);assert.equal(f.dark3,'2万元');assert.equal(f.dark5,null);assert.equal(f.days[0].dark,'1万元');assert.equal(JSON.stringify(r),before);
  assert.throws(()=>a.prepareFunds({...r,kind:'intraday'}));assert.throws(()=>a.prepareFunds({...r,days:[{main:null}]}));
});
test('historical quote must match stock and exact date',()=>{
  const p={data:{code:'000001',klines:['2026-10-09,10,11,12,9,100,1000,2,-1.61,-0.1,0.56']}};
  assert.equal(a.parseQuote(p,'000001','2026-10-09').changePercent,-1.61);
  assert.equal(a.parseQuote(p,'000001','2026-10-09').turnover,0.56);
  assert.throws(()=>a.parseQuote(p,'600000','2026-10-09'));assert.throws(()=>a.parseQuote(p,'000001','2026-10-08'));
});
test('announcements exclude future dates and other stocks',()=>{
  const n=(code,date)=>({codes:[{stock_code:code}],notice_date:date,title:'公告',art_code:'AN1'});
  const out=a.parseNotices({data:{list:[n('000001','2026-10-09'),n('000001','2026-10-10'),n('600000','2026-10-09'),n('000001','2026-01-01')]}},'000001','2026-10-09');
  assert.equal(out.length,1);assert.match(out[0].scope,/未解析正文/);
});
test('supplement failures become warnings and no fake zeros',async()=>{
  const r=await a.supplement('000001','2026-10-09',async()=>{throw Error('offline');});assert.equal(r.warnings.length,2);assert.equal(r.quote.changePercent,undefined);
});
test('manual blanks remain absent, explicit zero retained, bounds checked',()=>{
  assert.deepEqual(a.manualFields({close:'',changePercent:0}),{changePercent:0,notice:''});assert.throws(()=>a.manualFields({turnover:-2}));assert.throws(()=>a.manualFields(null));
});
test('three paragraph output and fixed CTA',()=>{
  const text='观察资金变化需要结合多个交易日的数据，不能只看单日流向就下结论，也不能推断后续涨跌。';
  const result=a.validateOutput({title:'这只股票的资金方向是否出现新的分歧',hook:'明盘和暗盘是否一致，先看看今天的数据变化',body:[text,text,text].join('\n\n'),cta:'wrong'});
  assert.equal(result.cta,'想查其他股票，评论区留下代码。');assert.throws(()=>a.validateOutput({...result,body:'太短'}));
});
