// Media-only midday snapshot. Never writes the mini-program closing ranking or cache.
const db = require('./db');
const {fetchThsHotList, normalizeCandidates} = require('./dark-fund-ranking');
const {requestCloseDarkFund} = require('./dark-fund-close-queue');
const {chinaToday,isTradingDay} = require('./trading-date');
let timer, running=false;
function minutes(now=Date.now()){const d=new Date(now+28800000);return d.getUTCHours()*60+d.getUTCMinutes();}
function inWindow(now=Date.now()){return isTradingDay(chinaToday(now)) && minutes(now)>=700 && minutes(now)<780;}
function validResult(r,code,date){
  if(!r || r.type!=='close_snapshot' || Number(r.validationVersion)<2 || String(r.stockCode).replace(/^(sh|sz)/i,'')!==code || r.tradeDate!==date)return false;
  if(!['intraday','snapshot','realtime','live','盘中'].includes(String(r.kind).toLowerCase()))return false;
  // Explicit market snapshot labels take precedence over request/update timestamps.
  const label=String(r.versionLabel||'');
  const time=label.match(/(\d{1,2})[:：](\d{2})/);
  // A query snapshot captured during lunch contains the 11:30 morning close.
  if(time){const m=Number(time[1])*60+Number(time[2]);return Number(time[2])<60 && m>=690 && m<780;}
  const updated=String(r.updatedAt||'');
  const ts=Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(updated)?updated:updated.replace(' ','T')+'+08:00');
  return Number.isFinite(ts) && chinaToday(ts)===date && minutes(ts)>=690 && minutes(ts)<780;
}
function itemOf(candidate,r,date){
  if(!validResult(r,candidate.stockCode,date))throw new Error('不是当日11:30午间快照（盘前、下午、收盘或时间缺失的数据不接受）');
  const day=(r.days||[]).find(d=>d.tradeDate===date);
  if(!day || !['main','grey','listed'].every(k=>typeof day[k]==='number' && Number.isFinite(day[k])))throw new Error('午间资金字段不完整');
  return {...candidate,main:day.main,grey:day.grey,listed:day.listed,retail:-day.main};
}
function buildRanking(date,items,failed,candidateCount){
  return {tradeDate:date,session:'midday',snapshotLabel:'截至11:30午间收盘',generatedAt:Date.now(),candidateCount,successCount:items.length,failed,
    inflow:items.filter(i=>i.grey>0).sort((a,b)=>b.grey-a.grey).slice(0,10),outflow:items.filter(i=>i.grey<0).sort((a,b)=>a.grey-b.grey).slice(0,10)};
}
async function execute(){
  if(!inWindow())throw new Error('午间榜仅在交易日11:40—13:00前取数，避免混入下午资金');
  const d=db.get(),date=chinaToday();
  const state=d.darkFundMiddaySyncState={...d.darkFundMiddaySyncState,status:'running',date,lastAttemptAt:Date.now(),error:''};
  await db.save();
  try{
    d.darkFundMiddayBatches ||= {};
    const batch=d.darkFundMiddayBatches[date] ||= {payload:await fetchThsHotList(),results:{}};
    const candidates=normalizeCandidates(batch.payload),items=[],failed=[];
    for(const c of candidates){
      try{
        let r=batch.results[c.stockCode];
        if(!validResult(r,c.stockCode,date)){
          if(!inWindow())throw new Error('午休取数窗口已结束');
          r=await requestCloseDarkFund(c.stockCode,{priority:'batch'});
          if(!inWindow())throw new Error('响应已超过午休取数窗口');
        }
        items.push(itemOf(c,r,date));batch.results[c.stockCode]=r;
      }catch(e){failed.push({stockCode:c.stockCode,stockName:c.stockName,error:e.message});}
      state.progress={processedCount:items.length+failed.length,candidateCount:candidates.length,successCount:items.length,failureCount:failed.length};
      await db.save();
    }
    if(!items.length)throw new Error(failed[0]?.error || '午间榜没有有效数据');
    d.darkFundMiddayRankings ||= {};
    const ranking=buildRanking(date,items,failed,candidates.length);d.darkFundMiddayRankings[date]=ranking;
    Object.assign(state,{status:'success',lastSuccessDate:date,lastSuccessAt:Date.now(),result:{successCount:items.length,failureCount:failed.length}});
    await db.save();return ranking;
  }catch(e){Object.assign(state,{status:'failed',error:e.message,lastFailureAt:Date.now()});await db.save();throw e;}
}
function latest(data=db.get()){const all=data.darkFundMiddayRankings||{};return all[Object.keys(all).sort().at(-1)]||null;}
function getStatus(){return {running,schedule:'11:40',timezone:'Asia/Shanghai',state:db.get().darkFundMiddaySyncState||null};}
async function manualSync(){
  if(running)throw Object.assign(new Error('午间榜正在生成'),{status:409});
  if(!inWindow())throw Object.assign(new Error('请在交易日11:40至13:00前生成午间榜'),{status:400});
  running=true;execute().catch(e=>console.error('[午间自媒体榜]',e.message)).finally(()=>{running=false;});
  return {started:true};
}
async function tick(now=Date.now()){
  if(running || !inWindow(now))return;
  const s=db.get().darkFundMiddaySyncState||{};
  if(s.lastSuccessDate===chinaToday(now) || (s.lastFailureAt && now-s.lastFailureAt<300000))return;
  running=true;try{await execute();}catch(e){console.error('[午间自媒体榜]',e.message);}finally{running=false;}
}
function start(){if(timer)return;timer=setInterval(()=>tick().catch(console.error),60000);timer.unref?.();tick().catch(console.error);}
function stop(){clearInterval(timer);timer=null;}
module.exports={validResult,itemOf,buildRanking,inWindow,latest,getStatus,manualSync,tick,start,stop};
