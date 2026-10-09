let ladderImage = '', ladderRevision = 0;
function renderLadder() {
  ladderImage = ''; ladderRevision++;
  document.getElementById('content').innerHTML = `<h2>连板天梯制图</h2>
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
    const canvas=drawLadder(result.data),url=canvas.toDataURL('image/png');
    const output=document.getElementById('ladderOutput');output.innerHTML='';
    const link=document.createElement('a');link.href=url;link.download=`连板天梯-${data.date}.png`;link.textContent='下载PNG';link.className='btn-primary';output.appendChild(link);
    const img=document.createElement('img');img.src=url;img.style.cssText='display:block;max-width:100%;width:800px;margin-top:16px';output.appendChild(img);
  }catch(e){showAdminToast(e.message,'error');}finally{button.disabled=false;}
}
function drawLadder(data){
  const c=document.createElement('canvas'), columns=6, cell=145;
  const hasChange=s=>s.change!=null&&String(s.change).trim()!=='';
  // Keep ordering; start compact first-board entries on their own rows.
  const layouts=data.groups.map(g=>{
    const rows=[];
    g.stocks.forEach(s=>{
      const compact=/首板/.test(g.height)&&!s.time&&!s.sector&&!hasChange(s)&&s.oneWord!==true;
      let row=rows[rows.length-1];
      if(!row||row.stocks.length===columns||row.compact!==compact){row={compact,stocks:[],height:compact?58:cell};rows.push(row);}
      row.stocks.push(s);
    });
    return {group:g,rows,height:Math.max(70,rows.reduce((sum,r)=>sum+r.height,0)+24)};
  });
  const header=210+(data.market||[]).length*32+(data.sectors||[]).length*30;
  c.width=1080;c.height=header+layouts.reduce((sum,l)=>sum+l.height,0)+90;
  if(c.height>16000)throw new Error('图片过长，请分批生成');
  const x=c.getContext('2d');x.fillStyle='#fffaf4';x.fillRect(0,0,c.width,c.height);
  function t(s,px,py,size=25,color='#343434',max=960){x.font=`${size}px "Microsoft YaHei",sans-serif`;x.fillStyle=color;x.fillText(s||'',px,py,max);}
  t('连板天梯',35,68,52,'#bd2036');t(data.date,740,68,30,'#bd2036');
  let y=115;(data.market||[]).forEach(s=>{t(s,35,y,24);y+=32;});(data.sectors||[]).forEach(s=>{t(s,35,y,24,'#bd2036');y+=30;});
  y=header-50;x.fillStyle='#bd2036';x.fillRect(25,y,1030,50);t('高度',40,y+34,26,'white');t('梯队（红叉表示未涨停）',160,y+34,26,'white');y+=50;
  layouts.forEach(({group:g,rows,height:h})=>{
    x.fillStyle='#ffffff';x.fillRect(25,y,1030,h);t(g.height,35,y+60,29,'#bd2036',100);
    let offset=0;
    rows.forEach(row=>{
      row.stocks.forEach((s,i)=>{
        const px=160+i*148,py=y+offset+35;
        const broken=hasChange(s)||s.broken===true;
        const change=Number(String(s.change||'').replace(/[％%\s]/g,'').replace(/−/g,'-').replace(/＋/g,'+'));
        const changeColor=Number.isFinite(change)?(change<0?'#00a84f':change>0?'#ff3b30':'#777'):'#777';
        x.save();x.globalAlpha=broken?0.5:1;
        if(row.compact){t(s.name,px,py,24,'#111',140);}
        else{
          t(hasChange(s)?s.change:s.oneWord===true?'一字板':s.time||'',px,py,20,hasChange(s)?changeColor:s.oneWord?'#bd2036':'#666',140);
          t(s.name,px,py+35,24,'#111',140);
          t(s.sector||'',px,py+68,20,'#a65243',140);
        }
        if(broken){
          const top=row.compact?py-22:py+10,bottom=row.compact?py+4:py+74;
          x.strokeStyle='#ff3b30';x.lineWidth=2;
          x.beginPath();x.moveTo(px+8,top);x.lineTo(px+132,bottom);x.moveTo(px+132,top);x.lineTo(px+8,bottom);x.stroke();
        }
        x.restore();
      });
      offset+=row.height;
    });
    x.strokeStyle='#ddd';x.strokeRect(25,y,1030,h);y+=h;
  });
  t('指标仓库 · 数据据上传截图整理，仅供参考，不构成投资建议',35,y+50,24,'#999');return c;
}
