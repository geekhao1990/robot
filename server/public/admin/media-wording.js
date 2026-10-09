// Optional post-recognition stage. Modules without a policy go straight to drawing.
const MEDIA_WORDING_POLICIES = {ladder:true};
const LADDER_WORDING_FIELDS = [
  ['title','标题','连板天梯',4],['heightHead','高度表头','高度',3],
  ['tierHead','梯队表头','梯队',4],['firstBoard','首板名称','首 板',3],
  ['brokenNote','断板说明','打叉的表示断板',16]
];
function mediaWordingOptions(kind,data,variant='A') {
  if(!MEDIA_WORDING_POLICIES[kind])return [];
  const alternatives={B:['连板复盘','板数','梯队个股','首板','红叉标记断板个股'],C:['连板一览','连板数','个股名单','首板股','红叉表示当日未连板']};
  const rows=LADDER_WORDING_FIELDS.map(([key,label,original,max],i)=>({key,label,original:data.presentation?.[key]??original,value:alternatives[variant]?.[i]??data.presentation?.[key]??original,max}));
  (data.market||[]).forEach((original,i)=>{
    let value=original;
    if(variant!=='A')value=value.replace(/沪深总成交[：:]\s*放量/g,'沪深成交量放大').replace(/无明显偏好/g,'风格偏好不明显');
    if(variant==='C')value=value.replace(/^涨\s*(\d+)\s*跌\s*(\d+)$/,'上涨$1家 下跌$2家');
    rows.push({key:`market.${i}`,label:`顶部摘要${i+1}`,original:data.presentation?.market?.[i]??original,value:variant==='A'?(data.presentation?.market?.[i]??original):value,max:120});
  });
  return rows;
}
function applyMediaWording(kind,data,rows){
  const result=JSON.parse(JSON.stringify(data));
  if(!MEDIA_WORDING_POLICIES[kind])return result;
  const presentation={};
  for(const row of rows){
    const value=row.enabled===false?row.original:row.value;
    if(row.key.startsWith('market.')){
      if(!presentation.market)presentation.market=[...(data.market||[])];
      presentation.market[Number(row.key.slice(7))]=value;
    }else if(LADDER_WORDING_FIELDS.some(([key])=>key===row.key))presentation[row.key]=value;
  }
  result.presentation=presentation;
  return result;
}
let mediaWordingReview=null;
function resetMediaWording(){
  mediaWordingReview=null;
  const el=document.getElementById('mediaWording');if(el)el.innerHTML='';
}
function showMediaWording(kind,data,variant='A'){
  const source=document.getElementById('ladderJson').value;
  mediaWordingReview={kind,data,source,rows:mediaWordingOptions(kind,data,variant)};
  const e=ladderEscape;
  document.getElementById('mediaWording').innerHTML=`<section style="margin-top:20px;border:1px solid #ddd;padding:20px;border-radius:10px">
    <h3>文案表达（可选）</h3><p>只调整文字，不改股票、日期、数值及图表样式。默认A保留原文；取消勾选可保留该项原文。</p>
    <div style="display:flex;gap:12px;margin:16px 0">${[['A','保留原文'],['B','简洁复盘'],['C','通俗表达']].map(([v,label])=>`<button type="button" class="${v===variant?'btn-primary':'btn-sm'}" onclick="selectMediaWording('${v}')">${v} ${label}</button>`).join('')}</div>
    <table style="width:100%;text-align:left"><thead><tr><th>采用</th><th>位置</th><th>原文</th><th>修改后（可编辑）</th></tr></thead><tbody>${mediaWordingReview.rows.map((r,i)=>`<tr><td><input type="checkbox" checked onchange="updateMediaWording(${i},'enabled',this.checked)"></td><td>${e(r.label)}</td><td>${e(r.original)}</td><td><input aria-label="${e(r.label)}修改后" style="width:100%" maxlength="${r.max}" value="${e(r.value)}" oninput="updateMediaWording(${i},'value',this.value)"></td></tr>`).join('')}</tbody></table>
    <p class="hint">修改上方JSON后需重新确认；股票数据不会被文案选项覆盖。此步骤不调用AI，不产生额外接口费用。</p>
    <button class="btn-primary" onclick="confirmLadder(this,true)">确认文案并生成图片</button>
    <button class="btn-sm" onclick="skipMediaWording(this)">跳过修改，原文生成</button></section>`;
}
function selectMediaWording(variant){
  if(!mediaWordingReview)return;
  invalidateLadder(false);
  showMediaWording(mediaWordingReview.kind,mediaWordingReview.data,variant);
}
function updateMediaWording(index,key,value){
  if(!mediaWordingReview)return;
  mediaWordingReview.rows[index][key]=value;invalidateLadder(false);
}
function skipMediaWording(button){
  if(!mediaWordingReview)return;
  mediaWordingReview.rows.forEach(r=>{r.enabled=false;});
  return confirmLadder(button,true);
}
