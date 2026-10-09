// JSON remains the source of truth; forms edit only the selected field.
let mediaReviewOnlyIssues=false;
const MEDIA_REVIEW_CSS=`.mr-layout{display:grid;grid-template-columns:minmax(240px,36%) minmax(0,1fr);gap:20px;align-items:start;margin-top:20px}.mr-source{position:sticky;top:12px;max-height:85vh;overflow:auto;background:#f5f6f8;padding:10px;border-radius:10px}.mr-source img{width:100%;cursor:zoom-in}.mr-source img.mr-zoom{width:180%;max-width:none}.mr-source:has(img[src=""]){display:none}.mr-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}.mr-field{display:block;font-size:13px;color:#525866}.mr-field input,.mr-field select,.mr-field textarea{display:block;width:100%;box-sizing:border-box;margin-top:5px;padding:9px;border:1px solid #d8dce3;border-radius:6px;font:inherit;color:#202630;background:white}.mr-field.mr-risk{background:#fff3cf;padding:7px;border-radius:7px}.mr-reason{display:block;color:#925900;font-size:12px;line-height:1.5;margin-top:4px}.mr-card{border:1px solid #e1e4e9;border-radius:10px;padding:14px;margin:12px 0;background:white}.mr-card.mr-suspect{border-color:#e4ae43}.mr-group{margin-top:22px;padding-top:10px;border-top:2px solid #e1e4e9}.mr-toolbar{padding:12px;background:#f3f5f8;border-radius:8px;margin:12px 0;line-height:1.8}.mr-warning{background:#fff3cf;padding:12px;border-radius:8px;color:#80520b;margin:10px 0;white-space:pre-wrap}.mr-actions{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.mr-array{display:flex;gap:8px;align-items:end;margin:8px 0}.mr-array .mr-field{flex:1}.mr-advanced{margin:16px 0}.mr-advanced summary{cursor:pointer;color:#666}@media(max-width:900px){.mr-layout{grid-template-columns:1fr}.mr-source{position:static;max-height:380px}}`;
function mediaReviewIssues(kind,data){
  const issues={};const add=(path,msg)=>{(issues[path]??=[]).push(msg);};
  const date=String(data.date||'');
  const match=date.match(kind==='dragon'?/^(?:(\d{4})-)?(\d{2})-(\d{2})$/:/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match)add('date','日期缺失或格式异常');
  else{const y=Number(match[1]||2000),m=Number(match[2]),d=Number(match[3]),dt=new Date(Date.UTC(y,m-1,d));if(dt.getUTCMonth()+1!==m||dt.getUTCDate()!==d)add('date','日期不存在，请对照原图');}
  const warnings=Array.isArray(data.warnings)?data.warnings.filter(v=>typeof v==='string'):[];
  (Array.isArray(data.groups)?data.groups:[]).forEach((g,i)=>{
    if(!g||typeof g!=='object')return;
    const gp=`groups.${i}`,label=kind==='dragon'?'name':'height';
    if(!g[label])add(`${gp}.${label}`,'分组名称缺失');
    const stocks=Array.isArray(g.stocks)?g.stocks:[],counts=new Map();
    stocks.forEach(s=>{if(s?.name)counts.set(s.name,(counts.get(s.name)||0)+1);});
    stocks.forEach((s,j)=>{
      if(!s||typeof s!=='object')return;
      const p=`${gp}.stocks.${j}`;
      if(!s.name)add(`${p}.name`,'股票名缺失');
      if(counts.get(s.name)>1)add(`${p}.name`,'同组出现同名股票，请检查是否重复');
      for(const w of warnings)if(s.name&&w.includes(s.name))add(`${p}.name`,w);
      if(kind==='dragon'){
        if(!s.amount)add(`${p}.amount`,'金额未识别；原图没有时可留空，不要补0');
        else if(!/^[+\-−＋]?\d+(?:\.\d+)?\s*(?:[ew万亿]|万元|亿元)$/i.test(s.amount))add(`${p}.amount`,'金额格式或单位待核对（如1.09e、-7554w）');
        if(!['buy','sell'].includes(s.direction))add(`${p}.direction`,'买卖方向不确定，请核对原图颜色');
        if(s.direction==='buy'&&/^[\-−]/.test(s.amount||''))add(`${p}.amount`,'买入方向与负金额不一致，请核对');
      }else{
        if(!s.sector)add(`${p}.sector`,'板块未识别；原图没有时可留空');
        if(s.time&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s.time))add(`${p}.time`,'时间格式异常，应为HH:mm');
        if(!s.time&&!s.change&&s.oneWord!==true)add(`${p}.time`,'时间未识别；原图没有时可留空');
        if(s.change&&!/^[+\-−＋]?\d+(?:\.\d+)?[%％]$/.test(s.change))add(`${p}.change`,'涨跌幅格式异常，请保留百分号');
        if(s.broken==null)add(`${p}.broken`,'断板状态不确定，请核对红叉/划线');
        if(s.change&&s.broken===false)add(`${p}.broken`,'存在涨跌幅：当前绘图规则会打叉，请确认是否断板');
        if(s.oneWord==null)add(`${p}.oneWord`,'一字板状态未确认，不等于“否”');
      }
    });
  });
  return issues;
}
function mediaReviewRead(){return JSON.parse(document.getElementById('ladderJson').value);}
function mediaReviewStore(data,redraw=true){
  document.getElementById('ladderJson').value=JSON.stringify(data,null,2);
  invalidateLadder();if(redraw)renderMediaReview();else refreshMediaReviewIssues(data);
}
function refreshMediaReviewIssues(data){
  const issues=mediaReviewIssues(mediaKind,data),e=ladderEscape;
  document.querySelectorAll('[data-mr-path]').forEach(el=>{
    const reason=issues[el.dataset.mrPath]||[];
    el.classList.toggle('mr-risk',reason.length>0);
    el.querySelector('.mr-reason').innerHTML=reason.map(e).join('<br>');
  });
  const count=document.getElementById('mediaReviewCount');if(count)count.textContent=Object.keys(issues).length;
}
function editMediaReview(path,value,type='text'){
  try{
    const data=mediaReviewRead(),parts=path.split('.');let target=data;
    if(parts.some(p=>['__proto__','constructor','prototype'].includes(p)))throw Error('字段不可编辑');
    for(const p of parts.slice(0,-1))target=target[p];
    target[parts.at(-1)]=type==='bool'?(value===''?null:value==='true'):(value===''&&parts.includes('stocks')?null:value);
    // Old wording must never cover subsequently corrected source text.
    if(parts[0]==='market'&&data.presentation)delete data.presentation.market;
    mediaReviewStore(data,false);
  }catch(e){showAdminToast(e.message,'error');}
}
function mutateMediaReview(path,index,remove){
  try{
    const data=mediaReviewRead();let arr=data;
    if(path.split('.').some(p=>['__proto__','constructor','prototype'].includes(p)))throw Error('字段不可编辑');
    for(const p of path.split('.')){if(arr[p]==null)arr[p]=[];arr=arr[p];}
    if(remove){if(!confirm('确认删除这一条数据？'))return;arr.splice(index,1);}
    else if(path==='groups')arr.push(mediaKind==='dragon'?{name:'',stocks:[]}:{height:'',stocks:[]});
    else if(path.endsWith('.stocks'))arr.push(mediaKind==='dragon'?{name:'',amount:null,direction:'unknown',period:null,note:null}:{name:'',time:null,sector:null,change:null,oneWord:null,broken:null});
    else arr.push('');
    if(path==='market'&&data.presentation)delete data.presentation.market;
    mediaReviewStore(data);
  }catch(e){showAdminToast(e.message,'error');}
}
function rawMediaReviewChanged(){invalidateLadder();renderMediaReview();}
function renderMediaReview(){
  const container=document.getElementById('mediaReview');if(!container)return;
  let data;
  try{data=mediaReviewRead();if(!data||!Array.isArray(data.groups)||data.groups.some(g=>!g||!Array.isArray(g.stocks)||g.stocks.some(s=>!s||typeof s!=='object')))throw Error('需要groups分组和stocks列表');}
  catch(e){container.innerHTML=`<p class="mr-warning">${document.getElementById('ladderJson').value?'数据格式异常，请在高级选项中修正JSON后再核对。':'上传图片并识别后，这里将显示逐条数据框；也可在高级选项粘贴JSON。'}</p>`;return;}
  const e=ladderEscape,issues=mediaReviewIssues(mediaKind,data);
  function field(path,label,value,type='text'){
    const reason=issues[path]||[];
    const options=type==='bool'?[['','待确认'],['true','是'],['false','否']]:[['unknown','待确认'],['buy','买入（红）'],['sell','卖出（绿）']];
    const control=type==='text'?`<input aria-label="${e(label)}" value="${e(value)}" oninput="editMediaReview('${path}',this.value)">`:`<select aria-label="${e(label)}" onchange="editMediaReview('${path}',this.value,'${type}')">${options.map(([v,t])=>`<option value="${v}" ${String(value??(type==='bool'?'':'unknown'))===v?'selected':''}>${t}</option>`).join('')}</select>`;
    return `<label data-mr-path="${path}" class="mr-field ${reason.length?'mr-risk':''}">${e(label)}${control}<span class="mr-reason">${reason.map(e).join('<br>')}</span></label>`;
  }
  const arrays=mediaKind==='dragon'?'':['market','sectors'].map(key=>`<h4>${key==='market'?'顶部市场摘要':'板块统计'}</h4>${(Array.isArray(data[key])?data[key]:[]).map((s,i)=>`<div class="mr-array">${field(`${key}.${i}`,`第${i+1}条`,s)}<button type="button" class="btn-sm" onclick="mutateMediaReview('${key}',${i},true)">删除</button></div>`).join('')}<button type="button" class="btn-sm" onclick="mutateMediaReview('${key}',0,false)">添加一条</button>`).join('');
  container.innerHTML=`<div class="mr-toolbar"><strong>逐条数据核对 · ${data.groups.reduce((n,g)=>n+g.stocks.length,0)}条股票记录</strong><br>黄色为待核对项，不代表一定错误；未高亮也不保证识别正确。缺失信息允许保持空白，切勿补造。<br><label><input type="checkbox" ${mediaReviewOnlyIssues?'checked':''} onchange="mediaReviewOnlyIssues=this.checked;renderMediaReview()"> 仅看有疑点的股票</label> · <span id="mediaReviewCount">${Object.keys(issues).length}</span>个字段待核对 <button type="button" class="btn-sm" onclick="renderMediaReview()">刷新筛选</button></div>
    ${(Array.isArray(data.warnings)?data.warnings:[]).length?`<div class="mr-warning"><strong>识别器提示（请对照原图）</strong><br>${data.warnings.map(e).join('<br>')}</div>`:''}
    ${field('date',mediaKind==='dragon'?'日期（YYYY-MM-DD或MM-DD）':'日期（YYYY-MM-DD）',data.date)}${arrays}
    ${data.groups.map((g,i)=>{const gp=`groups.${i}`;return `<section class="mr-group"><div class="mr-actions">${field(`${gp}.${mediaKind==='dragon'?'name':'height'}`,mediaKind==='dragon'?'游资 / 席位':'连板层级',g[mediaKind==='dragon'?'name':'height'])}<button type="button" class="btn-sm" onclick="mutateMediaReview('groups',${i},true)">删除分组</button></div>
    ${g.stocks.map((s,j)=>{const p=`${gp}.stocks.${j}`,suspect=Object.keys(issues).some(k=>k.startsWith(p+'.'));if(mediaReviewOnlyIssues&&!suspect)return '';return `<article class="mr-card ${suspect?'mr-suspect':''}"><div class="mr-actions"><strong>${j+1}. ${e(s.name||'未识别股票名')}</strong><button type="button" class="btn-sm" onclick="mutateMediaReview('${gp}.stocks',${j},true)">删除股票</button></div><div class="mr-fields">${(mediaKind==='dragon'?[['name','股票名'],['amount','金额（保留单位）'],['direction','买卖方向','direction'],['period','周期（三日等）'],['note','备注（昨入等）']]:[['name','股票名'],['time','涨停时间'],['sector','板块 / 概念'],['change','涨跌幅'],['oneWord','一字板','bool'],['broken','断板','bool']]).map(([key,label,type])=>field(`${p}.${key}`,label,s[key],type)).join('')}</div></article>`;}).join('')}
    <button type="button" class="btn-sm" onclick="mutateMediaReview('${gp}.stocks',0,false)">添加遗漏股票</button></section>`;}).join('')}
    <button type="button" class="btn-sm" style="margin-top:16px" onclick="mutateMediaReview('groups',0,false)">添加分组</button>`;
}
