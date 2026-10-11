let fundArticleView=0;
let fundArticleJob=null;
function renderFundArticle(){
  const view=++fundArticleView;
  document.getElementById('content').innerHTML=`<button class="btn-sm" onclick="switchView('aiMedia')">← AI自媒体</button><h2>暗盘三段论</h2>
  <p>单只股票 · 共享普通查询队列及缓存 · 不扣客户次数。行情匹配资金日期，公告仅作背景。调用DS产生API费用，不自动发布。</p>
  <input id="faCode" maxlength="6" placeholder="6位股票代码"><button id="faQuery" class="btn-primary" onclick="queryFundArticle()">查询并生成</button>
  <p id="faStatus" role="status"></p><div id="faData"></div>
  <dialog id="faMissing" style="max-width:600px;width:90%;border:1px solid #ddd;border-radius:12px"><h3>补充数据（可跳过）</h3><p id="faMissingInfo"></p>
  <p>所有行情必须对应当前资金交易日。空白不填，不会按0处理。</p>
  <label>涨跌幅（%）<input id="faChange" type="number" step="any"></label><br>
  <label>收盘价（元）<input id="faClose" type="number" step="any" min="0"></label><br>
  <label>换手率（%）<input id="faTurnover" type="number" step="any" min="0"></label><br>
  <label>粘贴公告正文（选填，最多6万字）<textarea id="faNotice" maxlength="60000" style="width:100%;height:160px"></textarea></label>
  <button class="btn-primary" onclick="generateFundArticle()">按已有及补充数据生成</button><button class="btn-sm" onclick="document.getElementById('faMissing').close()">稍后生成</button></dialog>
  <div id="faActions" hidden><label><input type="checkbox" id="faNotices" checked>结合近期公告正文分析</label>
  <button class="btn-sm" onclick="showFundArticleMissing()">补充/修改行情</button><button id="faGenerate" class="btn-primary" onclick="generateFundArticle()">生成 / 重新生成</button></div>
  <section id="faOutput" hidden><p>以下内容可直接编辑；请对照数据核对后发布。复制全文不重复附加视频开场。</p>
  ${[['title','标题'],['hook','视频开场'],['body','三段正文'],['cta','引导语']].map(([key,label])=>`<label>${label}<textarea id="fa-${key}" style="display:block;width:100%;height:${key==='body'?180:60}px"></textarea></label><button class="btn-sm" onclick="copyFundArticle('${key}')">复制${label}</button>`).join('')}
  <p><button class="btn-primary" onclick="copyFundArticle()">复制标题＋正文＋引导语</button></p></section>`;
  const id=sessionStorage.getItem('fundArticleJob');if(id)pollFundArticle(id,view,false);
}
function faActive(view){return view===fundArticleView&&!!document.getElementById('faStatus');}
function faBusy(busy){document.getElementById('faQuery').disabled=busy;document.getElementById('faGenerate').disabled=busy;}
async function queryFundArticle(){
  const view=fundArticleView;const code=document.getElementById('faCode').value.trim();
  if(!/^\d{6}$/.test(code)){alert('请输入6位股票代码');return;}
  faBusy(true);document.getElementById('faOutput').hidden=true;document.getElementById('faActions').hidden=true;document.getElementById('faData').replaceChildren();
  for(const id of ['faChange','faClose','faTurnover','faNotice'])document.getElementById(id).value='';
  try{const job=await api('/api/admin/fund-article/jobs',{method:'POST',body:JSON.stringify({stockCode:code})});sessionStorage.setItem('fundArticleJob',job.id);if(faActive(view))pollFundArticle(job.id,view,true);}
  catch(e){if(faActive(view)){document.getElementById('faStatus').textContent=e.message;faBusy(false);}}
}
function renderFundArticleData(job){
  if(!job.funds)return;
  const f=job.funds,q=job.extra.quote;
  document.getElementById('faData').innerHTML=`<h3>${esc(f.stockName)} · ${esc(f.tradeDate)} 收盘</h3><p>${job.cacheHit?'命中收盘缓存':'普通查询已完成'}；3日暗盘：${esc(f.dark3??'不足3日')}；5日：${esc(f.dark5??'不足5日')}</p>
  <table><thead><tr><th>日期</th><th>主力净流入</th><th>明盘</th><th>暗盘</th></tr></thead><tbody>${f.days.map(d=>`<tr><td>${esc(d.date)}</td><td>${esc(d.main)}</td><td>${esc(d.bright)}</td><td>${esc(d.dark)}</td></tr>`).join('')}</tbody></table>
  <p>收盘价：${esc(q.close??'缺失')}元；涨跌幅：${esc(q.changePercent??'缺失')}%；换手率：${esc(q.turnover??'缺失')}%</p>
  <p style="color:#ad6400">${esc(job.extra.warnings.join('；'))}</p>
  <details><summary>近期公告正文（近30日，最多5篇）</summary>${job.extra.notices.map(n=>`<details><summary>${esc(n.date)} ${esc(n.title)} — ${n.status==='ready'?`已读取${n.content.length}字 / ${n.pages}页`:'正文读取失败，未用于分析'}</summary><p><a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">查看原文</a></p>${n.status==='ready'?`<pre style="white-space:pre-wrap;max-height:360px;overflow:auto">${esc(n.content)}</pre>`:`<p style="color:#ad6400">${esc(n.error||'未取得正文')}，可手动粘贴补充。</p>`}</details>`).join('')||'<p>近30日未取得匹配公告，不代表没有公告。</p>'}</details>`;
  document.getElementById('faActions').hidden=false;
}
async function pollFundArticle(id,view,auto){
  if(!faActive(view))return;
  try{
    const job=await api('/api/admin/fund-article/jobs/'+encodeURIComponent(id));if(!faActive(view))return;fundArticleJob=job;
    document.getElementById('faStatus').textContent=job.error||job.stage+(job.status==='querying'?`（队列待处理${job.queue.userWaiting}，执行中${job.queue.active}）`:'');
    const busy=['querying','generating'].includes(job.status);faBusy(busy);
    if(busy){setTimeout(()=>pollFundArticle(id,view,auto),2000);return;}
    renderFundArticleData(job);
    if(job.output){for(const key of ['title','hook','body','cta'])document.getElementById('fa-'+key).value=job.output[key];document.getElementById('faOutput').hidden=false;}
    if(auto&&job.status==='ready'){
      if(job.extra.warnings.length||['close','changePercent','turnover'].some(k=>job.extra.quote[k]==null))showFundArticleMissing();else generateFundArticle();
    }
  }catch(e){if(faActive(view)){document.getElementById('faStatus').textContent=e.message;faBusy(false);if(e.status===404)sessionStorage.removeItem('fundArticleJob');}}
}
function showFundArticleMissing(){document.getElementById('faMissingInfo').textContent=`对应交易日：${fundArticleJob.funds.tradeDate}。${fundArticleJob.extra.warnings.join('；')}`;document.getElementById('faMissing').showModal();}
async function generateFundArticle(){
  if(!fundArticleJob)return;const view=fundArticleView;
  const manual={changePercent:document.getElementById('faChange').value,close:document.getElementById('faClose').value,turnover:document.getElementById('faTurnover').value,notice:document.getElementById('faNotice').value};
  faBusy(true);document.getElementById('faMissing').close();document.getElementById('faOutput').hidden=true;
  try{await api('/api/admin/fund-article/jobs/'+fundArticleJob.id+'/generate',{method:'POST',body:JSON.stringify({manual,useNotices:document.getElementById('faNotices').checked})});if(faActive(view))pollFundArticle(fundArticleJob.id,view,false);}
  catch(e){if(faActive(view)){document.getElementById('faStatus').textContent=e.message;faBusy(false);}}
}
async function copyFundArticle(key){
  const text=key?document.getElementById('fa-'+key).value:['title','body','cta'].map(k=>document.getElementById('fa-'+k).value).join('\n\n');
  try{await navigator.clipboard.writeText(text);document.getElementById('faStatus').textContent='已复制';}catch{alert('复制失败，请在文本框中手动选择复制');}
}
