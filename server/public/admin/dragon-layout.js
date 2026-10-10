const DRAGON_CSS=`
*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;background:#eee}
.dragon-poster{position:relative;width:1000px;padding:42px 32px 24px;background:#fcfaf5;overflow:hidden;color:#20242e}
.dragon-head{padding:0 8px 26px;border-bottom:3px solid #bb273d}.dragon-kicker{font-size:15px;letter-spacing:3px;color:#9b7d59;margin-bottom:12px}.dragon-head h1{font-size:48px;line-height:1.25;letter-spacing:1px;margin:0;font-weight:800}.dragon-date{color:#b0263b;margin-right:12px}.dragon-legend{display:flex;gap:24px;margin-top:19px;font-size:16px;color:#777}.dragon-legend span:before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;background:#b92e41}.dragon-legend span:nth-child(2):before{background:#26855d}.dragon-legend span:nth-child(3):before{background:#8a8c94}
.dragon-table{margin-top:20px;background:white;border:1px solid #e5e1da;border-radius:12px;overflow:hidden}.dragon-labels{display:flex;background:#ede9e1;color:#756754;font-size:16px;padding:14px 0;font-weight:600}.dragon-labels b{width:146px;padding-left:22px}.dragon-labels span{padding-left:22px}.dragon-row{display:flex;border-top:1px solid #e9e7e1;align-items:stretch}.dragon-row:nth-child(odd){background:#f8f9f8}.dragon-seat{flex:0 0 146px;padding:18px 14px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:21px;line-height:1.45;overflow-wrap:anywhere;text-align:center;border-right:1px solid #e9e7e1}.dragon-entries{flex:1;min-width:0;padding:16px 22px 4px;display:flex;align-content:flex-start;flex-wrap:wrap;column-gap:24px}.dragon-entry{max-width:100%;margin:0 0 12px;line-height:1.5;font-size:21px;font-weight:600;overflow-wrap:anywhere}.dragon-entry.buy{color:#b92e41}.dragon-entry.sell{color:#26855d}.dragon-entry.unknown{color:#777}.dragon-period{font-size:15px;margin-left:4px;font-weight:400}.dragon-amount{font-variant-numeric:tabular-nums;margin-left:9px;font-size:21px}.dragon-note{display:block;font-size:14px;font-weight:400;color:#737b81;line-height:1.5}.dragon-footer{margin-top:20px;text-align:center;color:#95918b;font-size:13px;line-height:1.8}.dragon-watermarks{position:absolute;inset:0;pointer-events:none;overflow:hidden}.dragon-watermarks span{position:absolute;white-space:nowrap;color:rgba(169,63,78,.095);font-size:25px;transform:rotate(-48deg)}
`;
function dragonTemplate(data){
  const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const parts=String(data.date).split('-');
  const date=`${Number(parts.at(-2))}月${Number(parts.at(-1))}日`;
  const groups=data.groups.map(group=>`<div class="dragon-row"><div class="dragon-seat">${e(group.name)}</div><div class="dragon-entries">${group.stocks.map(s=>`<div class="dragon-entry ${['buy','sell'].includes(s.direction)?s.direction:'unknown'}"><span>${e(s.name)}</span>${s.period?`<span class="dragon-period">(${e(s.period)})</span>`:''}${s.amount!=null?`<span class="dragon-amount">${e(s.amount)}</span>`:''}${s.note?`<span class="dragon-note">${e(s.note)}</span>`:''}</div>`).join('')}</div></div>`).join('');
  return `<main class="dragon-poster"><header class="dragon-head"><div class="dragon-kicker">资金动向 · 席位观察</div><h1><span class="dragon-date">${date}</span>游资龙虎榜</h1><div class="dragon-legend"><span>红色为买入</span><span>绿色为卖出</span><span>灰色为方向待确认</span></div></header><section class="dragon-table"><div class="dragon-labels"><b>游资 / 席位</b><span>股票 · 金额 · 备注</span></div>${groups}</section><footer class="dragon-footer">数据来自互联网，图表由AI生成，不构成投资建议，投资需谨慎。</footer><div class="dragon-watermarks">${Array.from({length:80},(_,i)=>`<span style="top:${140+i*220}px;left:${i%2?790:-65}px">小程序指标仓库</span>`).join('')}</div></main>`;
}
async function drawDragon(data){
  if(typeof html2canvas!=='function')throw new Error('绘图组件未加载，请刷新后台');
  const frame=document.createElement('iframe');frame.setAttribute('aria-hidden','true');
  frame.style.cssText='position:fixed;left:-10000px;top:0;width:1000px;height:100px;border:0;pointer-events:none';
  document.body.appendChild(frame);
  try{
    const doc=frame.contentDocument;doc.open();doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${DRAGON_CSS}</style></head><body>${dragonTemplate(data)}</body></html>`);doc.close();await doc.fonts.ready;
    const poster=doc.querySelector('.dragon-poster'),height=Math.ceil(poster.getBoundingClientRect().height);
    if(height>8000)throw new Error('图片过长，请分批生成');frame.style.height=height+'px';
    const original=await html2canvas(poster,{scale:2,width:1000,height,windowWidth:1000,windowHeight:height,scrollX:0,scrollY:0,backgroundColor:'#fcfaf5',logging:false});
    return dragonPortraitCanvas(original);
  }finally{frame.remove();}
}
// Export-only sizing; recognition, template and review workflow are unchanged.
function dragonPortraitCanvas(original){
  const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1920;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fcfaf5';ctx.fillRect(0,0,1080,1920);
  const scale=Math.min(1080/original.width,1920/original.height);
  const width=original.width*scale,height=original.height*scale;
  ctx.drawImage(original,(1080-width)/2,(1920-height)/2,width,height);
  return canvas;
}
