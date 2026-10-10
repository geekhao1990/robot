let ladderImage = '', ladderRevision = 0;
let mediaKind = 'ladder';
const mediaEndpoint = kind => kind==='dragon'?'/api/admin/ladder/dragon':'/api/admin/ladder';
function renderAiMedia() {
  ladderRevision++;
  document.getElementById('content').innerHTML = `<h2>AI自媒体</h2>
  <div style="display:flex;flex-wrap:wrap;gap:20px;margin-top:20px">
    <section style="flex:1;min-width:280px;padding:24px;border:1px solid #eee;border-radius:12px;background:#fff">
      <h3>连板天梯图生成</h3>
      <p class="hint" style="margin:12px 0">模板来自抖音连扳炒家</p>
      <p style="margin:12px 0 20px;color:#666">上传截图，确认识别JSON后生成图片。</p>
      <button class="btn-primary" onclick="switchView('ladder')">进入连板天梯图生成</button>
    </section>
    <section style="flex:1;min-width:280px;padding:24px;border:1px solid #eee;border-radius:12px;background:#fff">
      <h3>暗盘榜分享图与文案</h3>
      <p id="aiMediaRankingStatus" class="hint" style="margin:12px 0">读取榜单状态中…</p>
      <p style="margin:12px 0 20px;color:#666">使用已生成的收盘榜单，不重复查询、不扣次数。</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn-primary" onclick="generateRankingCopy(this)">生成文案 / 复制</button>
        <button class="btn-primary" onclick="generateRankingPoster('inflow',this)">流入分享图</button>
        <button class="btn-primary" onclick="generateRankingPoster('outflow',this)">流出分享图</button>
      </div>
    </section>
    <section style="flex:1;min-width:280px;padding:24px;border:1px solid #eee;border-radius:12px;background:#fff">
      <h3>游资龙虎榜图生成</h3>
      <p style="margin:12px 0 20px;color:#666">识别席位、买卖方向、金额及备注，确认JSON后统一排版导出。</p>
      <button class="btn-primary" onclick="switchView('dragon')">进入游资龙虎榜图生成</button>
    </section>
    <section style="flex:1;min-width:280px;padding:24px;border:1px solid #eee;border-radius:12px;background:#fff">
      <h3>图文转多图</h3><p style="margin:12px 0 20px;color:#666">文章＋多张图片联合理解，确认分页JSON后生成多张图文。复杂图表直接引用原图。</p>
      <button class="btn-primary" onclick="switchView('articleRewrite')">进入图文生成</button>
    </section>
  </div>`;
  const status = document.getElementById('aiMediaRankingStatus');
  api('/api/admin/dark-fund-ranking').then(data=>{
    status.textContent=data.sync && data.sync.running ? '榜单正在更新，请完成后生成内容' : data.ranking ? `当前榜单：${data.ranking.tradeDate}` : '暂无榜单，请先在功能设置中生成暗盘榜';
  }).catch(error=>{status.textContent=error.message||'榜单状态读取失败';});
}
function renderLadder(kind = 'ladder') {
  resetMediaWording();
  mediaReviewOnlyIssues=false;
  mediaKind=kind;
  const isDragon=kind==='dragon', title=isDragon?'游资龙虎榜':'连板天梯';
  ladderImage = ''; ladderRevision++;
  document.getElementById('content').innerHTML = `<button class="btn-sm" onclick="switchView('aiMedia')">← 返回AI自媒体</button><h2 style="margin-top:16px">${title}图生成</h2>
  <p class="hint" style="margin-top:8px">${isDragon?'红色买入、绿色卖出；金额及三日、昨入备注按原图保留。':'模板来自抖音连扳炒家'}</p>
  <p style="margin:16px 0">上传截图 → DeepSeek识图提取JSON → 人工确认 → ${MEDIA_WORDING_POLICIES[kind]?'可选文案调整 → ':''}绘图。截图将直接发送DeepSeek，可能产生接口费用。</p>
  <p id="ladderConfig">正在检查接口配置…</p>
  <input type="file" accept="image/png,image/jpeg" onchange="loadLadderImage(this)" />
  <button id="ladderRecognize" class="btn-primary" onclick="recognizeLadder(this)" disabled>识别并提取JSON</button>
  <style>${MEDIA_REVIEW_CSS}.mr-layout:has(.mr-source img[src=""]){grid-template-columns:1fr}</style>
  <div class="mr-layout"><div class="mr-source"><p>原图对照 · 点击图片放大/还原，可滚动查看</p><img id="ladderSource" src="" style="display:none" onclick="this.classList.toggle('mr-zoom')" alt="原始截图" /></div>
  <div style="min-width:0"><p id="ladderNotice">直接在数据框里核对和修改，空白不代表0，待确认不代表否。</p>
  <div id="mediaReview"></div>
  <details class="mr-advanced"><summary>高级选项：原始JSON（可粘贴 / 编辑）</summary><textarea id="ladderJson" style="width:100%;height:300px;font-family:monospace" oninput="rawMediaReviewChanged()" placeholder="也可粘贴已有JSON，自动转成数据框"></textarea></details>
  <button class="btn-primary" onclick="confirmLadder(this)">${MEDIA_WORDING_POLICIES[kind]?'确认数据，下一步':'确认数据并生成图片'}</button>
  </div></div>
  <div id="mediaWording"></div>
  <div id="ladderOutput" style="margin-top:20px"></div>`;
  renderMediaReview();
  api('/api/admin/ladder/config').then(c=>{
    const el=document.getElementById('ladderConfig');
    if(el) el.textContent=`DeepSeek：${c.deepseekConfigured?'已配置':'未配置'}；模型：${c.model}。未配置时仍可粘贴JSON绘图。`;
  }).catch(e=>showAdminToast(e.message,'error'));
}
function invalidateLadder(resetWording=true){ladderRevision++;if(resetWording)resetMediaWording();const el=document.getElementById('ladderOutput');if(el)el.innerHTML='';}
async function loadLadderImage(input){
  invalidateLadder();ladderImage='';document.getElementById('ladderRecognize').disabled=true;
  document.getElementById('ladderJson').value='';
  document.getElementById('ladderSource').src='';document.getElementById('ladderSource').style.display='none';
  renderMediaReview();
  const file=input.files[0];if(!file)return;
  const revision=ladderRevision;
  try{
    if(!['image/png','image/jpeg'].includes(file.type)||file.size>10*1024*1024)throw new Error('请选择10MB以内PNG/JPG');
    const image=await createImageBitmap(file);
    const c=document.createElement('canvas'), scale=Math.min(1,1800/image.width,3500/image.height);
    c.width=Math.round(image.width*scale);c.height=Math.round(image.height*scale);
    c.getContext('2d').drawImage(image,0,0,c.width,c.height);image.close();
    let url=c.toDataURL('image/jpeg',0.9);
    for(let q=0.8;url.length>900000&&q>=0.4;q-=0.1)url=c.toDataURL('image/jpeg',q);
    if(url.length>900000)throw new Error('图片过大，请裁剪后上传');
    if(revision!==ladderRevision)return;
    ladderImage=url;document.getElementById('ladderSource').src=url;document.getElementById('ladderSource').style.display='block';
    document.getElementById('ladderJson').value='';
    renderMediaReview();
    document.getElementById('ladderRecognize').disabled=false;
  }catch(e){showAdminToast(e.message,'error');}
}
async function recognizeLadder(button){
  if(!ladderImage)return;
  invalidateLadder();const revision=ladderRevision,kind=mediaKind;button.disabled=true;button.textContent='识别中，请稍候…';
  try{
    const result=await api(mediaEndpoint(kind)+'/recognize',{method:'POST',body:JSON.stringify({image:ladderImage})});
    if(revision!==ladderRevision)return;
    document.getElementById('ladderJson').value=JSON.stringify(result.data,null,2);
    document.getElementById('ladderNotice').textContent=result.warning||'请核对下方数据框，确认后才绘图。';
    renderMediaReview();
  }catch(e){showAdminToast(e.message,'error');}finally{button.disabled=false;button.textContent='识别并提取JSON';}
}
async function confirmLadder(button,wordingConfirmed=false){
  const revision=ladderRevision,kind=mediaKind;
  try{
    let data=JSON.parse(document.getElementById('ladderJson').value);
    if(wordingConfirmed){
      if(!mediaWordingReview||mediaWordingReview.kind!==kind||mediaWordingReview.source!==document.getElementById('ladderJson').value)throw new Error('JSON已变更，请重新确认JSON');
      data=applyMediaWording(kind,data,mediaWordingReview.rows);
    }
    if(!confirm(wordingConfirmed?'确认采用所选文案生成图片？':kind==='dragon'?'已对照原图核对数据框中的席位、股票、日期、买卖方向、金额及备注，确认绘图？':'已对照原图核对数据框中的股票、层级、日期、时间及断板标记，进入文案选项？'))return;
    button.disabled=true;
    const result=await api(mediaEndpoint(kind)+'/confirm',{method:'POST',body:JSON.stringify({confirmed:true,data})});
    if(revision!==ladderRevision)return;
    if(MEDIA_WORDING_POLICIES[kind]&&!wordingConfirmed){showMediaWording(kind,result.data);return;}
    if(document.fonts)await document.fonts.ready;
    if(revision!==ladderRevision)return;
    const canvas=await (kind==='dragon'?drawDragon(result.data):drawLadder(result.data));
    if(revision!==ladderRevision)return;
    const url=canvas.toDataURL('image/png');
    const output=document.getElementById('ladderOutput');output.innerHTML='';
    const link=document.createElement('a');link.href=url;link.download=`${kind==='dragon'?'游资龙虎榜':'连板天梯'}-${data.date}.png`;link.textContent='下载PNG';link.className='btn-primary';output.appendChild(link);
    const img=document.createElement('img');img.src=url;img.style.cssText='display:block;max-width:100%;width:800px;margin-top:16px';output.appendChild(img);
  }catch(e){showAdminToast(e.message,'error');}finally{button.disabled=false;}
}
