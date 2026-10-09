let ladderImage = '', ladderRevision = 0;
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
  </div>`;
  const status = document.getElementById('aiMediaRankingStatus');
  api('/api/admin/dark-fund-ranking').then(data=>{
    status.textContent=data.sync && data.sync.running ? '榜单正在更新，请完成后生成内容' : data.ranking ? `当前榜单：${data.ranking.tradeDate}` : '暂无榜单，请先在功能设置中生成暗盘榜';
  }).catch(error=>{status.textContent=error.message||'榜单状态读取失败';});
}
function renderLadder() {
  ladderImage = ''; ladderRevision++;
  document.getElementById('content').innerHTML = `<button class="btn-sm" onclick="switchView('aiMedia')">← 返回AI自媒体</button><h2 style="margin-top:16px">连板天梯图生成</h2>
  <p class="hint" style="margin-top:8px">模板来自抖音连扳炒家</p>
  <p style="margin:16px 0">上传截图 → DeepSeek识图提取JSON → 人工确认 → 绘图。截图将直接发送DeepSeek，可能产生接口费用。</p>
  <p id="ladderConfig">正在检查接口配置…</p>
  <input type="file" accept="image/png,image/jpeg" onchange="loadLadderImage(this)" />
  <button id="ladderRecognize" class="btn-primary" onclick="recognizeLadder(this)" disabled>识别并提取JSON</button>
  <div style="display:flex;gap:20px;margin-top:20px;align-items:flex-start"><img id="ladderSource" style="width:35%;display:none" alt="原始截图" />
  <div style="flex:1"><p id="ladderNotice">也可以粘贴已有JSON。断板划线需要对照原图人工确认。</p>
  <textarea id="ladderJson" style="width:100%;height:480px;font-family:monospace" oninput="invalidateLadder()" placeholder="识别后的JSON会显示在这里，可直接修改"></textarea>
  <button class="btn-primary" onclick="confirmLadder(this)">确认JSON并生成图片</button>
  </div></div>
  <div id="ladderOutput" style="margin-top:20px"></div>`;
  api('/api/admin/ladder/config').then(c=>{
    const el=document.getElementById('ladderConfig');
    if(el) el.textContent=`DeepSeek：${c.deepseekConfigured?'已配置':'未配置'}；模型：${c.model}。未配置时仍可粘贴JSON绘图。`;
  }).catch(e=>showAdminToast(e.message,'error'));
}
function invalidateLadder(){ladderRevision++;const el=document.getElementById('ladderOutput');if(el)el.innerHTML='';}
async function loadLadderImage(input){
  invalidateLadder();ladderImage='';document.getElementById('ladderRecognize').disabled=true;
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
    document.getElementById('ladderRecognize').disabled=false;
  }catch(e){showAdminToast(e.message,'error');}
}
async function recognizeLadder(button){
  if(!ladderImage)return;
  invalidateLadder();const revision=ladderRevision;button.disabled=true;button.textContent='识别中，请稍候…';
  try{
    const result=await api('/api/admin/ladder/recognize',{method:'POST',body:JSON.stringify({image:ladderImage})});
    if(revision!==ladderRevision)return;
    document.getElementById('ladderJson').value=JSON.stringify(result.data,null,2);
    document.getElementById('ladderNotice').textContent=result.warning+' '+(result.data.warnings||[]).join('；');
  }catch(e){showAdminToast(e.message,'error');}finally{button.disabled=false;button.textContent='识别并提取JSON';}
}
async function confirmLadder(button){
  const revision=ladderRevision;
  try{
    const data=JSON.parse(document.getElementById('ladderJson').value);
    if(!confirm('已对照原图核对JSON中的股票、层级、日期、时间及断板标记，确认绘图？'))return;
    button.disabled=true;
    const result=await api('/api/admin/ladder/confirm',{method:'POST',body:JSON.stringify({confirmed:true,data})});
    if(revision!==ladderRevision)return;
    if(document.fonts)await document.fonts.ready;
    if(revision!==ladderRevision)return;
    const canvas=await drawLadder(result.data);
    if(revision!==ladderRevision)return;
    const url=canvas.toDataURL('image/png');
    const output=document.getElementById('ladderOutput');output.innerHTML='';
    const link=document.createElement('a');link.href=url;link.download=`连板天梯-${data.date}.png`;link.textContent='下载PNG';link.className='btn-primary';output.appendChild(link);
    const img=document.createElement('img');img.src=url;img.style.cssText='display:block;max-width:100%;width:800px;margin-top:16px';output.appendChild(img);
  }catch(e){showAdminToast(e.message,'error');}finally{button.disabled=false;}
}
