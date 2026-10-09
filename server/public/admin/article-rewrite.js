function renderArticleRewrite(){
  document.getElementById('content').innerHTML=`<button class="btn-sm" onclick="switchView('aiMedia')">← 返回AI自媒体</button><h2>复盘文章改写</h2>
  <p style="margin:16px 0;color:#666">保留大意与关键数据，调整措辞，清理图片占位和无意义图片链接。原文会发送到DeepSeek，可能产生接口费用；不会自动发布。</p>
  <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px"><label>表达方式 <select id="articleStyle"><option value="light">轻度改写（保留段落顺序）</option><option value="smooth">通顺改写（改善衔接）</option></select></label>
  <label>个人经历 <select id="articleVoice"><option value="neutral">保留作者归属，不冒充我的操作</option><option value="original">我自己的文章，保留第一人称</option></select></label></div>
  <style>.article-columns{display:grid;grid-template-columns:1fr 1fr;gap:20px}.article-columns textarea{width:100%;box-sizing:border-box;height:560px;padding:16px;font:15px/1.8 sans-serif;border:1px solid #ddd;border-radius:8px}.article-alert{white-space:pre-wrap;background:#fff5da;padding:14px;line-height:1.7;margin:14px 0}@media(max-width:900px){.article-columns{grid-template-columns:1fr}}</style>
  <div id="articleWarnings" class="article-alert" hidden></div>
  <div class="article-columns"><section><h3>原文</h3><textarea id="articleSource" maxlength="20000" placeholder="粘贴完整复盘文章（最多20000字），不用先手动清理图片链接"></textarea><button id="articleRun" class="btn-primary" onclick="runArticleRewrite(this)">清理并改写</button><p id="articleStatus" role="status"></p></section>
  <section><h3>改写结果（可继续编辑）</h3><textarea id="articleResult" placeholder="改写后在此展示，不需要查看JSON"></textarea><button id="articleCopy" class="btn-primary" onclick="copyArticleRewrite()" disabled>复制正文</button><p class="hint">复制内容以当前编辑框为准；改写不等于事实核验或原创认定，请保留必要出处。</p></section></div>
  <details><summary>查看清理后的原文</summary><pre id="articleCleaned" style="white-space:pre-wrap;line-height:1.7"></pre></details>`;
}
async function runArticleRewrite(button){
  const source=document.getElementById('articleSource'),output=document.getElementById('articleResult'),status=document.getElementById('articleStatus');
  const text=source.value;if(text.trim().length<30){showAdminToast('请粘贴完整文章（至少30字）','error');return;}
  const style=document.getElementById('articleStyle').value,voice=document.getElementById('articleVoice').value;
  const copy=document.getElementById('articleCopy'),warnings=document.getElementById('articleWarnings');
  if(output.value&&!confirm('重新改写将替换右侧已编辑的正文，是否继续？'))return;
  button.disabled=true;copy.disabled=true;source.readOnly=true;output.readOnly=true;warnings.hidden=true;status.textContent='正在清理并改写，请稍候…';
  try{
    const result=await api('/api/admin/ladder/article/rewrite',{method:'POST',body:JSON.stringify({text,style,voice})});
    if(document.getElementById('articleResult')!==output)return;
    output.value=result.article;document.getElementById('articleCleaned').textContent=result.cleanedSource;
    status.textContent=`改写完成，预清理${result.removed}处图片占位或图片链接。请对照核对后复制。`;
    warnings.textContent=(result.warnings||[]).join('\n');warnings.hidden=!warnings.textContent;
  }catch(e){if(document.getElementById('articleResult')===output){status.textContent=(e.message||'改写失败')+(output.value?'；右侧保留的是上次结果。':'');showAdminToast(status.textContent,'error');}}
  finally{button.disabled=false;source.readOnly=false;output.readOnly=false;copy.disabled=!output.value;}
}
async function copyArticleRewrite(){
  const output=document.getElementById('articleResult');
  try{await navigator.clipboard.writeText(output.value);showAdminToast('已复制改写正文');}
  catch(_){output.focus();output.select();showAdminToast('无法自动复制，已选中正文，请按Ctrl+C','error');}
}
