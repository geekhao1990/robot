const DRAGON_CSS=`
*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;background:#eee}
.dragon-poster{position:relative;width:1000px;padding:42px 32px 24px;background:#fcfaf5;overflow:hidden;color:#20242e}
.dragon-head{padding:0 8px 26px;border-bottom:3px solid #bb273d}.dragon-kicker{font-size:15px;letter-spacing:3px;color:#9b7d59;margin-bottom:12px}.dragon-head h1{font-size:48px;line-height:1.25;letter-spacing:1px;margin:0;font-weight:800}.dragon-date{color:#b0263b;margin-right:12px}.dragon-legend{display:flex;gap:24px;margin-top:19px;font-size:16px;color:#777}.dragon-legend span:before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;background:#b92e41}.dragon-legend span:nth-child(2):before{background:#26855d}.dragon-legend span:nth-child(3):before{background:#8a8c94}
.dragon-table{margin-top:20px;background:white;border:1px solid #e5e1da;border-radius:12px;overflow:hidden}.dragon-labels{display:flex;background:#ede9e1;color:#756754;font-size:16px;padding:14px 0;font-weight:600}.dragon-labels b{width:146px;padding-left:22px}.dragon-labels span{padding-left:22px}.dragon-row{display:flex;border-top:1px solid #e9e7e1;align-items:stretch}.dragon-row:nth-child(odd){background:#f8f9f8}.dragon-seat{flex:0 0 146px;padding:18px 14px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:21px;line-height:1.45;overflow-wrap:anywhere;text-align:center;border-right:1px solid #e9e7e1}.dragon-entries{flex:1;min-width:0;padding:16px 22px 4px;display:flex;align-content:flex-start;flex-wrap:wrap;column-gap:24px}.dragon-entry{max-width:100%;margin:0 0 12px;line-height:1.5;font-size:21px;font-weight:600;overflow-wrap:anywhere}.dragon-entry.buy{color:#b92e41}.dragon-entry.sell{color:#26855d}.dragon-entry.unknown{color:#777}.dragon-period{font-size:15px;margin-left:4px;font-weight:400}.dragon-amount{font-variant-numeric:tabular-nums;margin-left:9px;font-size:21px}.dragon-note{display:block;font-size:14px;font-weight:400;color:#737b81;line-height:1.5}.dragon-footer{margin-top:20px;text-align:center;color:#95918b;font-size:13px;line-height:1.8}.dragon-watermarks{position:absolute;inset:0;pointer-events:none;overflow:hidden}.dragon-watermarks span{position:absolute;white-space:nowrap;color:rgba(169,63,78,.095);font-size:25px;transform:rotate(-48deg)}
`;
const DRAGON_PORTRAIT_CSS=`
.dragon-poster{width:720px;height:1280px;padding:0 22px}
.dragon-head{position:absolute;top:171px;left:22px;right:22px;padding:0 0 14px;text-align:center;border-bottom:2px solid #bb273d}
.dragon-kicker{position:absolute;top:-108px;left:0;right:0;font-size:14px;letter-spacing:4px;margin:0}
.dragon-head h1{font-size:44px;line-height:1.25;letter-spacing:0;font-weight:900;white-space:nowrap}
.dragon-date{margin-right:10px}.dragon-legend{justify-content:center;gap:20px;margin-top:12px;font-size:13px}
.dragon-viewport{position:absolute;top:283px;left:22px;right:22px;height:921px;overflow:hidden}
.dragon-content{transform-origin:top left}.dragon-table{margin-top:0;border-radius:10px}
.dragon-labels{font-size:13px;padding:8px 0}.dragon-labels b{width:110px;padding-left:14px}.dragon-labels span{padding-left:12px}
.dragon-seat{flex-basis:110px;padding:4px 8px;font-size:17px;line-height:1.25}
.dragon-entries{padding:4px 12px 0;column-gap:15px}.dragon-entry{margin-bottom:4px;font-size:17px;line-height:1.25}
.dragon-amount{font-size:17px;margin-left:5px}.dragon-period{font-size:13px;margin-left:2px}.dragon-note{font-size:12px;line-height:1.25}
.dragon-footer{position:absolute;left:26px;right:26px;bottom:34px;margin:0;font-size:12px;line-height:18px}
.dragon-watermarks span{font-size:18px}
@media print{@page{size:720px 1280px;margin:0}}
`;
function fitDragonPoster(poster){
  const content=poster.querySelector('.dragon-content'),viewport=poster.querySelector('.dragon-viewport');
  // Reflow at a wider logical width before scaling, so dense tables keep
  // the full poster width instead of shrinking into a narrow central strip.
  const fits=scale=>{
    content.style.width=`${100/scale}%`;
    content.style.transform=`scale(${scale})`;
    return Number.isFinite(content.scrollHeight)&&content.scrollHeight*scale<=viewport.clientHeight;
  };
  if(fits(1))return 1;
  if(!fits(0.72))throw new Error('龙虎榜数据过多，9:16单图会导致字号过小，请减少本次数据后分批生成（未裁掉数据）');
  let scale=0.72,high=1;
  for(let i=0;i<12;i++){const mid=(scale+high)/2;if(fits(mid))scale=mid;else high=mid;}
  fits(scale);
  return scale;
}
function dragonTemplate(data){
  const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const parts=String(data.date).split('-');
  const date=`${Number(parts.at(-2))}月${Number(parts.at(-1))}日`;
  const groups=data.groups.map(group=>`<div class="dragon-row"><div class="dragon-seat">${e(group.name)}</div><div class="dragon-entries">${group.stocks.map(s=>`<div class="dragon-entry ${['buy','sell'].includes(s.direction)?s.direction:'unknown'}"><span>${e(s.name)}</span>${s.period?`<span class="dragon-period">(${e(s.period)})</span>`:''}${s.amount!=null?`<span class="dragon-amount">${e(s.amount)}</span>`:''}${s.note?`<span class="dragon-note">${e(s.note)}</span>`:''}</div>`).join('')}</div></div>`).join('');
  return `<main class="dragon-poster"><header class="dragon-head"><div class="dragon-kicker">资金动向 · 席位观察</div><h1><span class="dragon-date">${date}</span>游资龙虎榜</h1><div class="dragon-legend"><span>红色为买入</span><span>绿色为卖出</span><span>灰色为方向待确认</span></div></header><div class="dragon-viewport"><div class="dragon-content"><section class="dragon-table"><div class="dragon-labels"><b>游资 / 席位</b><span>股票 · 金额 · 备注</span></div>${groups}</section></div></div><footer class="dragon-footer">数据来自互联网，图表由AI生成，不构成投资建议，投资需谨慎。</footer><div class="dragon-watermarks">${Array.from({length:80},(_,i)=>`<span style="top:${140+i*220}px;left:${i%2?574:-65}px">小程序指标仓库</span>`).join('')}</div></main>`;
}
async function drawDragon(data){
  if(typeof html2canvas!=='function')throw new Error('绘图组件未加载，请刷新后台');
  const frame=document.createElement('iframe');frame.setAttribute('aria-hidden','true');
  frame.style.cssText='position:fixed;left:-10000px;top:0;width:720px;height:1280px;border:0;pointer-events:none';
  document.body.appendChild(frame);
  try{
    const doc=frame.contentDocument;doc.open();doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${DRAGON_CSS}${DRAGON_PORTRAIT_CSS}</style></head><body>${dragonTemplate(data)}</body></html>`);doc.close();await doc.fonts.ready;
    const poster=doc.querySelector('.dragon-poster');fitDragonPoster(poster);
    return await html2canvas(poster,{scale:1.5,width:720,height:1280,windowWidth:720,windowHeight:1280,scrollX:0,scrollY:0,backgroundColor:'#fcfaf5',logging:false});
  }finally{frame.remove();}
}
