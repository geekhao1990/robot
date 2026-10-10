let articleCardsState=null;
function articleCardsActive(state){return articleCardsState===state&&!!document.getElementById('cardsJson');}
function renderArticleCards(){
  articleCardsState={images:[],sources:[],revision:0,busy:false};
  document.getElementById('content').innerHTML=`<button class="btn-sm" onclick="switchView('aiMedia')">← 返回AI自媒体</button><h2>文章＋图片 → 多张图文</h2>
  <p>上传文章和图片 → DeepSeek联合理解 → 核对并微调JSON → 确认生成多张PNG。复杂图片直接引用原图，不猜测数字。</p>
  <p class="hint">材料将发送DeepSeek，可能产生费用，不会自动发布。图片只作临时识别素材；原图引用保留原有署名和水印。</p>
  <textarea id="cardsText" style="width:100%;height:240px" maxlength="20000" oninput="invalidateArticleCards(true)" placeholder="粘贴文章，可用[图1]、[图2]提示图片应放的位置（可仅上传图片）"></textarea>
  <p><input id="cardsFiles" type="file" accept="image/png,image/jpeg,image/webp" multiple onchange="loadArticleCards(this)"> 最多8张，每次选择会替换全部素材。<label>目标图片数 <input id="cardsCount" type="number" min="1" max="12" value="3" style="width:70px" onchange="invalidateArticleCards(true)"></label></p>
  <div id="cardsAssets" style="display:flex;gap:12px;flex-wrap:wrap"></div>
  <button id="cardsPlan" class="btn-primary" onclick="planArticleCards(this)">理解图文，生成JSON</button><p id="cardsStatus" role="status"></p>
  <div id="cardsReview" hidden><h3>JSON核对与微调</h3><p>pages每项对应一张图片；调整blocks顺序即可移动图文。imageId引用下方素材编号，不要粘贴图片地址。sourceIds对应原文段落，可合并引用但不能遗漏。</p><div id="cardsWarnings" style="white-space:pre-wrap;background:#fff4d6;padding:12px"></div>
  <div id="cardsEditor"></div><details><summary>高级：编辑完整JSON（调整分页、增减及排序内容块）</summary><textarea id="cardsJson" style="width:100%;height:480px;font-family:monospace" oninput="invalidateArticleCards(false);renderArticleCardsEditor()"></textarea></details>
  <details><summary>原文段落对照</summary><div id="cardsSources" style="white-space:pre-wrap"></div></details>
  <button id="cardsDraw" class="btn-primary" onclick="generateArticleCards(this)">确认JSON并生成图片</button></div><div id="cardsOutput"></div>`;
}
function invalidateArticleCards(clearPlan){
  if(!articleCardsState)return;articleCardsState.revision++;
  document.getElementById('cardsOutput').innerHTML='';
  if(clearPlan){document.getElementById('cardsReview').hidden=true;document.getElementById('cardsJson').value='';articleCardsState.sources=[];}
}
async function loadArticleCards(input){
  const state=articleCardsState;invalidateArticleCards(true);const rev=state.revision;
  state.images=[];document.getElementById('cardsAssets').innerHTML='';
  const button=document.getElementById('cardsPlan');button.disabled=true;
  try{
    if(input.files.length>8)throw Error('最多选择8张图片');
    const images=[];
    for(const file of input.files){
      if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error('每张需为10MB以内PNG/JPG/WebP');
      const img=await createImageBitmap(file);let url;
      try{
        if(img.width*img.height>40000000)throw Error('图片像素过大，请缩小');
        const canvas=document.createElement('canvas'),scale=Math.min(1,1800/img.width,3600/img.height);canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);
        const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
        for(const quality of [.9,.8,.7,.6,.5]){url=canvas.toDataURL('image/jpeg',quality);if(url.length<850000)break;}
        if(url.length>=850000)throw Error('图片压缩后仍过大，请缩小或分图');
      }finally{img.close();}
      images.push({id:'img'+(images.length+1),data:url,name:file.name});
    }
    if(!articleCardsActive(state)||state.revision!==rev)return;
    state.images=images;
    for(const img of images){const card=document.createElement('div'),label=document.createElement('p'),image=document.createElement('img');label.textContent=`${img.id} · ${img.name}`;image.src=img.data;image.style.cssText='width:160px;max-height:220px;object-fit:contain';card.append(label,image);document.getElementById('cardsAssets').appendChild(card);}
  }catch(e){showAdminToast(e.message,'error');}finally{if(articleCardsState===state)button.disabled=false;}
}
async function planArticleCards(button){
  const state=articleCardsState;if(state.busy)return;
  invalidateArticleCards(true);const rev=state.revision;state.busy=true;button.disabled=true;
  const status=document.getElementById('cardsStatus');
  try{
    const text=document.getElementById('cardsText').value,pageCount=Number(document.getElementById('cardsCount').value);
    if(!text.trim()&&!state.images.length)throw Error('请提供文章或图片');
    const assetIds=[];
    for(const image of state.images){
      if(!articleCardsActive(state)||rev!==state.revision)return;
      status.textContent=`正在准备图片 ${assetIds.length+1}/${state.images.length}…`;
      const r=await api('/api/admin/ladder/article-cards/asset',{method:'POST',body:JSON.stringify({image:image.data})});assetIds.push(r.assetId);
    }
    if(!articleCardsActive(state)||rev!==state.revision)return;
    status.textContent='正在联合理解文章和图片，生成分页JSON…';
    const result=await api('/api/admin/ladder/article-cards/plan',{method:'POST',body:JSON.stringify({text,pageCount,assetIds})});
    if(!articleCardsActive(state)||rev!==state.revision)return;
    state.sources=result.sources;document.getElementById('cardsJson').value=JSON.stringify(result.data,null,2);
    document.getElementById('cardsWarnings').textContent=(result.data.warnings||[]).join('\n')||'请对照原文和图片核对；未提示异常不代表数据准确。';
    document.getElementById('cardsSources').textContent=result.sources.map(s=>s.id+'：'+s.original).join('\n\n');
    renderArticleCardsEditor();
    document.getElementById('cardsReview').hidden=false;status.textContent=`已生成${result.data.pages.length}页方案，请确认JSON后绘图。图片尚未生成。`;
  }catch(e){if(articleCardsActive(state)){status.textContent=e.message;showAdminToast(e.message,'error');}}
  finally{state.busy=false;button.disabled=false;}
}
function renderArticleCardsEditor(){
  const root=document.getElementById('cardsEditor');root.replaceChildren();
  let data;try{data=JSON.parse(document.getElementById('cardsJson').value);if(!Array.isArray(data.pages))throw Error();}catch(_){root.textContent='JSON格式暂不完整，修正后恢复内容框。';return;}
  const field=(parent,label,value,change)=>{
    const caption=document.createElement('label'),input=document.createElement('textarea');caption.textContent=label;input.value=value||'';input.style.cssText='display:block;width:100%;min-height:70px;margin:8px 0 14px';input.oninput=()=>change(input.value);parent.append(caption,input);
  };
  const update=(pi,bi,key,value)=>{const d=JSON.parse(document.getElementById('cardsJson').value);(bi==null?d.pages[pi]:d.pages[pi].blocks[bi])[key]=value;document.getElementById('cardsJson').value=JSON.stringify(d,null,2);invalidateArticleCards(false);};
  data.pages.forEach((page,pi)=>{
    if(!page||typeof page!=='object')return;
    const section=document.createElement('section');section.style.cssText='padding:18px;border:1px solid #ddd;border-radius:10px;margin:16px 0';
    field(section,`第${pi+1}张 · 标题`,page.title,v=>update(pi,null,'title',v));
    (Array.isArray(page.blocks)?page.blocks:[]).forEach((block,bi)=>{
      if(!block||typeof block!=='object')return;
      const box=document.createElement('div');box.style.cssText='padding:14px;margin:12px 0;background:#f6f7f9;border-left:3px solid #bcc3cc';
      if(block.type==='image'){
        const asset=articleCardsState.images.find(i=>i.id===block.imageId),label=document.createElement('p');label.textContent=`原图引用：${block.imageId||'未指定'}`;box.append(label);
        if(asset){const img=document.createElement('img');img.src=asset.data;img.style.cssText='max-width:100%;max-height:360px;object-fit:contain';box.append(img);}else{box.style.borderColor='#e74c3c';}
        field(box,'图片说明',block.caption,v=>update(pi,bi,'caption',v||null));
      }else if(block.type==='bullets')field(box,'要点（每行一条）',(Array.isArray(block.items)?block.items:[]).join('\n'),v=>update(pi,bi,'items',v.split('\n').filter(s=>s.trim())));
      else field(box,block.type==='heading'?'小标题':'正文',block.text,v=>update(pi,bi,'text',v));
      const original=document.createElement('div');original.style.cssText='white-space:pre-wrap;color:#777;font-size:13px';original.textContent='原文对照：'+(Array.isArray(block.sourceIds)?block.sourceIds:[]).map(id=>articleCardsState.sources.find(s=>s.id===id)?.original||`未知段落${id}`).join('\n');box.append(original);section.append(box);
    });root.append(section);
  });
}
async function generateArticleCards(button){
  const state=articleCardsState;if(state.busy)return;
  const rev=state.revision;state.busy=true;button.disabled=true;
  const status=document.getElementById('cardsStatus');
  try{
    const data=JSON.parse(document.getElementById('cardsJson').value);
    if(!confirm('已核对图文JSON中的内容、来源编号及图片位置，确认生成？'))return;
    document.getElementById('cardsOutput').innerHTML='';
    const checked=await api('/api/admin/ladder/article-cards/confirm',{method:'POST',body:JSON.stringify({confirmed:true,data,imageIds:state.images.map(i=>i.id),sourceIds:state.sources.map(s=>s.id)})});
    const assets=Object.fromEntries(state.images.map(i=>[i.id,i.data])),urls=[];
    for(let i=0;i<checked.data.pages.length;i++){
      if(!articleCardsActive(state)||rev!==state.revision)return;
      status.textContent=`正在绘制第${i+1}/${checked.data.pages.length}张…`;
      const canvas=await drawArticleCard(checked.data,checked.data.pages[i],assets,i);urls.push(canvas.toDataURL('image/png'));canvas.width=canvas.height=1;
    }
    if(!articleCardsActive(state)||rev!==state.revision)return;
    const output=document.getElementById('cardsOutput');output.innerHTML='';
    urls.forEach((url,i)=>{const section=document.createElement('section'),link=document.createElement('a'),img=document.createElement('img');link.href=url;link.download=`图文复盘-${i+1}.png`;link.textContent=`下载第${i+1}张PNG`;link.className='btn-primary';img.src=url;img.style.cssText='display:block;width:540px;max-width:100%;margin:16px 0';section.append(link,img);output.appendChild(section);});
    status.textContent=`已生成${urls.length}张图片，可逐张下载。`;
  }catch(e){if(articleCardsActive(state)){status.textContent=e.message;showAdminToast(e.message,'error');}}
  finally{state.busy=false;button.disabled=false;}
}
