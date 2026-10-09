let articleReview=null;
const articleEscape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function articleDiff(original,rewritten){
  const a=Array.from(original),b=Array.from(rewritten),e=articleEscape;
  let ops=[];
  // Bound memory for long paragraphs; shorter paragraphs get an exact character diff.
  if(a.length*b.length>250000){
    let start=0,end=0;while(start<a.length&&start<b.length&&a[start]===b[start])start++;
    while(end<a.length-start&&end<b.length-start&&a[a.length-1-end]===b[b.length-1-end])end++;
    ops=[['same',a.slice(0,start).join('')],['del',a.slice(start,a.length-end).join('')],['add',b.slice(start,b.length-end).join('')],['same',a.slice(a.length-end).join('')]];
  }else{
    const dp=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
    for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)dp[i][j]=a[i]===b[j]?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
    let i=0,j=0;while(i<a.length||j<b.length){if(i<a.length&&j<b.length&&a[i]===b[j]){ops.push(['same',a[i++]]);j++;}else if(i<a.length&&(j===b.length||dp[i+1][j]>=dp[i][j+1]))ops.push(['del',a[i++]]);else ops.push(['add',b[j++]]);}
  }
  const merged=[];for(const [type,text] of ops){if(!text)continue;if(merged.at(-1)?.[0]===type)merged.at(-1)[1]+=text;else merged.push([type,text]);}
  const render=side=>merged.filter(([type])=>type==='same'||type===side).map(([type,text])=>type==='same'?e(text):`<mark class="article-${type}">${e(text)}</mark>`).join('');
  return {original:render('del'),rewritten:render('add')};
}
function assembleArticle(paragraphs){return paragraphs.map(p=>(p.accepted===false?p.original:p.rewritten)+p.separator).join('');}
function renderArticleRewrite(){
  articleReview=null;
  document.getElementById('content').innerHTML=`<button class="btn-sm" onclick="switchView('aiMedia')">← 返回AI自媒体</button><h2>复盘文章逐段改写</h2>
  <p style="margin:16px 0;color:#666">按原文换行逐段对应，不合并、不删段；“大肉大面数”等配图标题保留。红色为替换前，绿色为修改后。取消勾选即恢复该段原文。</p>
  <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px"><label>表达方式 <select id="articleStyle"><option value="smooth">充分改写（同义转写、重组句式）</option><option value="light">轻度改写</option></select></label>
  <label>个人经历 <select id="articleVoice"><option value="neutral">保留作者归属，不冒充我的操作</option><option value="original">我自己的文章，保留第一人称</option></select></label></div>
  <style>.article-columns{display:grid;grid-template-columns:1fr 1fr;gap:16px}.article-text{width:100%;box-sizing:border-box;min-height:120px;padding:12px;font:15px/1.8 sans-serif;border:1px solid #ddd;border-radius:8px}.article-alert{white-space:pre-wrap;background:#fff5da;padding:14px;line-height:1.7;margin:14px 0}.article-card{background:white;border:1px solid #ddd;border-radius:10px;padding:18px;margin:18px 0}.article-card.off{background:#f5f5f5}.article-diff{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8;margin:10px 0}.article-del{background:#ffe3e3;color:#a42a2a;text-decoration:line-through}.article-add{background:#dbf3de;color:#17632e}.article-card ul{color:#656565;line-height:1.7}.article-rows{border:0;padding:0;min-width:0}@media(max-width:900px){.article-columns{grid-template-columns:1fr}}</style>
  <textarea class="article-text" id="articleSource" maxlength="20000" style="height:240px" placeholder="粘贴原文（最多20000字）；每个非空行作为一段，单独标题也会保留。"></textarea>
  <p class="hint">原文会发送DeepSeek并可能产生费用。仅清理图片占位及无意义图片链接，必要来源保留；改写不等于事实核验。</p>
  <button id="articleRun" class="btn-primary" onclick="runArticleRewrite(this)">生成逐段改写与说明</button><p id="articleStatus" role="status"></p>
  <div id="articleWarnings" class="article-alert" hidden></div>
  <fieldset id="articleParagraphs" class="article-rows"></fieldset>
  <h3>最终正文预览（随勾选实时更新）</h3><textarea class="article-text" id="articleResult" style="height:320px" readonly placeholder="在上方逐段编辑、勾选；这里自动合并最终正文"></textarea>
  <button id="articleCopy" class="btn-primary" onclick="copyArticleRewrite()" disabled>复制最终正文</button>
  <details><summary>高级选项：对应段落JSON</summary><pre id="articleJson" style="white-space:pre-wrap"></pre></details>
  <details><summary>查看清理后的原文</summary><pre id="articleCleaned" style="white-space:pre-wrap;line-height:1.7"></pre></details>`;
}
function renderArticleParagraphs(){
  const e=articleEscape;
  document.getElementById('articleParagraphs').innerHTML=`<div><button type="button" class="btn-sm" onclick="selectAllArticle(true)">全部采用改写</button> <button type="button" class="btn-sm" onclick="selectAllArticle(false)">全部恢复原文</button></div>`+articleReview.map((p,i)=>{
    const diff=articleDiff(p.original,p.rewritten);
    return `<section id="articleRow${i}" class="article-card ${p.accepted===false?'off':''}"><label><input type="checkbox" ${p.accepted===false?'':'checked'} onchange="chooseArticleParagraph(${i},this.checked)"> 第${i+1}段 · 采用改写</label><div class="article-columns"><div><h4>对应原文</h4><div class="article-diff" id="articleOriginal${i}">${diff.original}</div></div><div><h4>改写后（可编辑）</h4><textarea class="article-text" oninput="editArticleParagraph(${i},this.value)">${e(p.rewritten)}</textarea><div id="articleDiff${i}" class="article-diff">${diff.rewritten}</div></div></div><strong>AI初始修改说明</strong><ul>${p.changes.map(s=>`<li>${e(s)}</li>`).join('')}</ul><small>手动编辑后以当前红绿差异为准；取消勾选仅撤销这一段的改写。</small>${p.warnings?.length?`<p class="article-alert">${p.warnings.map(e).join('<br>')}</p>`:''}<p id="articleEmpty${i}" class="article-alert" ${p.accepted===false||p.rewritten.trim()?'hidden':''}>此段改写为空；请补全或取消勾选恢复原文。</p></section>`;
  }).join('');
  refreshArticleOutput();
}
function refreshArticleOutput(){
  const invalid=articleReview.some(p=>p.accepted!==false&&!p.rewritten.trim());
  document.getElementById('articleResult').value=assembleArticle(articleReview);
  document.getElementById('articleCopy').disabled=invalid;
  document.getElementById('articleJson').textContent=JSON.stringify({paragraphs:articleReview},null,2);
}
function chooseArticleParagraph(i,accepted){articleReview[i].accepted=accepted;document.getElementById('articleRow'+i).classList.toggle('off',!accepted);document.getElementById('articleEmpty'+i).hidden=!accepted||!!articleReview[i].rewritten.trim();refreshArticleOutput();}
function editArticleParagraph(i,value){
  const p=articleReview[i];p.rewritten=value;
  const diff=articleDiff(p.original,value);document.getElementById('articleOriginal'+i).innerHTML=diff.original;document.getElementById('articleDiff'+i).innerHTML=diff.rewritten;
  document.getElementById('articleEmpty'+i).hidden=p.accepted===false||!!value.trim();refreshArticleOutput();
}
function selectAllArticle(accepted){articleReview.forEach(p=>p.accepted=accepted);renderArticleParagraphs();}
async function runArticleRewrite(button){
  const source=document.getElementById('articleSource'),output=document.getElementById('articleResult'),status=document.getElementById('articleStatus');
  const text=source.value;if(text.trim().length<30){showAdminToast('请粘贴完整文章（至少30字）','error');return;}
  const style=document.getElementById('articleStyle').value,voice=document.getElementById('articleVoice').value;
  const copy=document.getElementById('articleCopy'),warnings=document.getElementById('articleWarnings'),rows=document.getElementById('articleParagraphs');
  if(output.value&&!confirm('重新改写将替换已有的逐段修改和勾选，是否继续？'))return;
  button.disabled=true;copy.disabled=true;source.readOnly=true;rows.disabled=true;warnings.hidden=true;status.textContent='正在逐段改写并生成修改说明，请稍候…';
  try{
    const result=await api('/api/admin/ladder/article/rewrite',{method:'POST',body:JSON.stringify({text,style,voice})});
    if(document.getElementById('articleResult')!==output)return;
    if(!Array.isArray(result.paragraphs)||!result.paragraphs.length)throw Error('服务端尚未更新逐段改写接口，请部署后重试');
    articleReview=result.paragraphs.map(p=>({...p,accepted:true}));renderArticleParagraphs();
    document.getElementById('articleCleaned').textContent=result.cleanedSource;
    status.textContent=`完成${articleReview.length}段对应改写，其中${articleReview.filter(p=>p.original!==p.rewritten).length}段有变化。清理${result.removed}处图片占位或图片链接。`;
    warnings.textContent=(result.warnings||[]).join('\n');warnings.hidden=!warnings.textContent;
  }catch(e){if(document.getElementById('articleResult')===output){status.textContent=(e.message||'改写失败')+(output.value?'；下方保留上次结果。':'');showAdminToast(status.textContent,'error');}}
  finally{button.disabled=false;source.readOnly=false;rows.disabled=false;if(document.getElementById('articleResult')===output){if(articleReview)refreshArticleOutput();else copy.disabled=true;}}
}
async function copyArticleRewrite(){
  if(!articleReview||articleReview.some(p=>p.accepted!==false&&!p.rewritten.trim())){showAdminToast('请补全空白改写或取消勾选恢复原文','error');return;}
  const output=document.getElementById('articleResult');
  try{await navigator.clipboard.writeText(output.value);showAdminToast('已复制当前勾选合并的正文');}
  catch(_){output.focus();output.select();showAdminToast('无法自动复制，已选中正文，请按Ctrl+C','error');}
}
