let articleCardsState=null;
function articleCardsActive(state){return articleCardsState===state&&!!document.getElementById('cardsText');}
function renderArticleCards(){
  articleCardsState={revision:0,busy:false,result:null};
  document.getElementById('content').innerHTML=`<button class="btn-sm" onclick="switchView('aiMedia')">← 返回AI自媒体</button><h2>复盘文章改写成图</h2>
  <p>粘贴文章 → 同义改写为自然流畅的复盘文章 → 自动生成公众号长图，并列出改了什么。无需上传图片，也无需确认文案。</p>
  <p class="hint">仅发送文字至DeepSeek，可能产生费用；不识别图片、不自动发布。保留原文事实、数据和观点，发布前请检查结果。</p>
  <textarea id="cardsText" style="width:100%;height:300px" maxlength="20000" oninput="invalidateArticleCards()" placeholder="粘贴复盘文章，图片占位及无意义图片链接会自动清理"></textarea>
  <p>按“情绪量化、涨停跌停数、市场整体情绪、大肉大面数、实盘赛”等标题分图，相关描述归到对应标题下，段尾留出插入配图的位置。不均分、不显示页码。</p>
  <button id="cardsPlan" class="btn-primary" onclick="planArticleCards(this)">同义改写并生成长图</button><p id="cardsStatus" role="status"></p>
  <section id="cardsReport" hidden><h3>本次改写说明</h3><p id="cardsCleanup"></p><div id="cardsWarnings" style="white-space:pre-wrap;color:#9c6413"></div><div id="cardsChanges"></div>
  <details><summary>完整改写文章（可复制到公众号）</summary><textarea id="cardsArticle" readonly style="width:100%;height:320px"></textarea></details>
  <button id="cardsRetryDraw" class="btn-sm" onclick="redrawArticleCards(this)" hidden>重新绘图（不再次调用AI）</button></section><div id="cardsOutput"></div>`;
}
function invalidateArticleCards(){
  if(!articleCardsState)return;articleCardsState.revision++;articleCardsState.result=null;
  document.getElementById('cardsOutput').innerHTML='';document.getElementById('cardsReport').hidden=true;
}
function renderArticleCardsReport(result){
  document.getElementById('cardsCleanup').textContent=`已清理${result.removed||0}处图片占位或图片链接。以下说明仅供后台查看，不会写进长图。`;
  document.getElementById('cardsWarnings').textContent=(result.warnings||[]).join('\n');
  document.getElementById('cardsArticle').value=result.article;
  const root=document.getElementById('cardsChanges');root.replaceChildren();
  for(const change of result.changes){
    const details=document.createElement('details'),summary=document.createElement('summary');
    summary.textContent=(change.original===change.rewritten?'保留原文：':'改写：')+change.changes.join('；');details.append(summary);
    const before=document.createElement('p'),after=document.createElement('p');before.textContent='原文：'+change.original;after.textContent='改写后：'+change.rewritten;details.append(before,after);
    if(change.warnings?.length){const warning=document.createElement('p');warning.textContent=change.warnings.join('；');warning.style.color='#b56b00';details.append(warning);}
    details.style.cssText='padding:12px;margin:10px 0;border:1px solid #e4e4e4;border-radius:6px';root.append(details);
  }
  document.getElementById('cardsReport').hidden=false;
}
async function drawArticleCardsResult(state,rev){
  const current=()=>articleCardsActive(state)&&rev===state.revision;
  if(!current())return;
  const data=state.result.data,urls=[],status=document.getElementById('cardsStatus');
  document.getElementById('cardsOutput').innerHTML='';document.getElementById('cardsRetryDraw').hidden=false;
  for(let i=0;i<data.pages.length;i++){
    if(!current())return;status.textContent='同义改写完成，正在排版绘制长图…';
    const canvas=await drawArticleCard(data,data.pages[i],i);
    try{if(!current())return;urls.push(canvas.toDataURL('image/png'));}finally{canvas.width=canvas.height=1;}
  }
  if(!current())return;
  const output=document.getElementById('cardsOutput');
  urls.forEach((url,i)=>{const section=document.createElement('section'),link=document.createElement('a'),img=document.createElement('img');link.href=url;link.download=`复盘文章-${String(i+1).padStart(2,'0')}.png`;link.textContent=`下载长图 ${i+1}${data.pages[i].section?' · '+data.pages[i].section:''}`;link.className='btn-primary';img.src=url;img.style.cssText='display:block;width:540px;max-width:100%;margin:16px 0';section.append(link,img);
    if(data.pages[i].insertImageAfter){const tip=document.createElement('p');tip.textContent=`此段结束，可在公众号中接着插入“${data.pages[i].section}”的配图（本提示不在图片内）。`;tip.style.color='#956c25';section.append(tip);}output.appendChild(section);});
  document.getElementById('cardsRetryDraw').hidden=true;status.textContent=`已生成${urls.length}张连续阅读长图。改写说明在上方，可直接下载。`;
}
async function planArticleCards(button){
  const state=articleCardsState;if(state.busy)return;
  invalidateArticleCards();const rev=state.revision;state.busy=true;button.disabled=true;
  const status=document.getElementById('cardsStatus');
  try{
    const text=document.getElementById('cardsText').value;
    if(text.trim().length<30)throw Error('请粘贴至少30字的复盘文章');
    status.textContent='正在同义改写，梳理复盘表达并整理修改说明…';
    const result=await api('/api/admin/ladder/article-cards/plan',{method:'POST',body:JSON.stringify({text})});
    if(!articleCardsActive(state)||rev!==state.revision)return;
    state.result=result;renderArticleCardsReport(result);await drawArticleCardsResult(state,rev);
  }catch(e){if(articleCardsActive(state)&&rev===state.revision){status.textContent=e.message;showAdminToast(e.message,'error');}}
  finally{state.busy=false;button.disabled=false;}
}
async function redrawArticleCards(button){
  const state=articleCardsState;if(state.busy||!state.result)return;
  const rev=state.revision;state.busy=true;button.disabled=true;
  try{await drawArticleCardsResult(state,rev);}catch(e){if(articleCardsActive(state)&&rev===state.revision){document.getElementById('cardsStatus').textContent=e.message;showAdminToast(e.message,'error');}}
  finally{state.busy=false;button.disabled=false;}
}
