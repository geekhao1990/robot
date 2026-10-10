// One shared layout for the reference preview and confirmed JSON exports.
const LADDER_CSS = "\n*{box-sizing:border-box}html,body{margin:0;padding:0}body{background:#e8e7e1;font-family:\"Microsoft YaHei\",\"PingFang SC\",sans-serif;color:#111}\n.poster{position:relative;width:698px;margin:0 auto;padding:36px 22px 10px;background:#f7f4eb;overflow:hidden}\n.poster:before{content:\"\";position:absolute;inset:0;pointer-events:none;opacity:.3;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.62' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Cpath fill='%239b937e' filter='url(%23n)' opacity='.45' d='M0 0h200v200H0z'/%3E%3C/svg%3E\");mix-blend-mode:multiply}\n.top,.heading,.sectors,.ladder{position:relative}.top{margin:0 18px;font-size:15px;color:#888;min-height:105px}.market-line{height:39px;display:flex;align-items:flex-start;white-space:nowrap;gap:9px}.market-line .right{margin-left:auto}.red{color:#c6343b}.green{color:#399466}.big{font-size:20px;line-height:24px}.index-line{display:flex;align-items:center;gap:9px;padding-top:3px}.index-value{font-size:19px;letter-spacing:.1px}.breadth{margin-left:auto;display:flex;gap:7px;align-items:center;color:#cb4249;font-size:16px}.breadth .bar{display:flex;width:134px;height:6px;border-radius:6px;overflow:hidden;gap:4px;background:#e5e1d7}.bar i{display:block;background:#e64b51;width:59%}.bar b{display:block;background:#24b77b;flex:1}\n.heading{display:flex;align-items:baseline;gap:9px;margin:3px 24px 18px;height:60px;white-space:nowrap;color:#bd1f35;font-weight:900}.heading h1{font-size:43px;letter-spacing:-2px;margin:0;line-height:60px}.heading span{font-size:25px;letter-spacing:-1.4px;font-weight:900}.sectors{margin:0 25px 21px;min-height:61px;display:flex;flex-wrap:wrap;gap:4px 26px;align-content:flex-start;font-size:19px;font-weight:bold;line-height:31px;color:#aa292a}.sectors .battery{color:#aa8827}.sectors .publish{color:#576054}\n.ladder{width:652px;border:1px solid #cc9ca3;border-radius:21px 21px 16px 16px;overflow:hidden;background:white}.table-head{height:44px;display:flex;align-items:center;color:white;background:#c8203a;font-size:22px}.height-head{width:82px;flex-shrink:0;text-align:center}.table-head .desc{font-size:16px;margin-left:10px}.table-head .label{margin-left:14px}.tier{display:flex;border-top:1px solid #d7d7d7}.height{width:82px;flex-shrink:0;border-right:1px solid #e7e7e7;display:flex;align-items:center;justify-content:center;color:#ae303e;font-size:24px;line-height:28px;font-weight:600;text-align:center}.stocks{flex:1;min-width:0;padding:12px 8px 9px;display:flex;flex-wrap:wrap;align-content:start;row-gap:12px}.stock{flex:0 0 calc(100% / 7);position:relative;min-width:0;text-align:center;height:59px;font-family:\"Microsoft YaHei\",sans-serif}.stock .meta{font-family:Arial,\"Microsoft YaHei\",sans-serif;display:block;height:20px;line-height:19px;font-size:13px;letter-spacing:.5px;color:#333}.stock .name{display:block;white-space:nowrap;font-size:16px;line-height:21px;font-weight:600;letter-spacing:-.6px}.stock .sector{display:block;font-size:12px;line-height:20px;white-space:nowrap;color:#913d31}.stock .sector.battery{color:#a08022}.stock .sector.publish{color:#545a50}.stock .meta em{display:inline-block;padding:0 3px;line-height:18px;border-radius:7px;background:#d95350;color:#fff;font-size:12px;font-style:normal;letter-spacing:-.5px}.stock.broken{opacity:.5}.stock.broken:after,.stock.broken:before{content:\"\";position:absolute;top:30px;left:4px;right:4px;height:1px;background:#ca4245;transform:rotate(22deg);pointer-events:none}.stock.broken:after{transform:rotate(-22deg)}.stock .meta.up{color:#c63636}.stock .meta.down{color:#307b21}.tier.short{min-height:85px}.tier.two{min-height:158px}.tier.first{min-height:85px}.tier.first .height{font-size:23px}.compact{flex:0 0 100%;font-size:16px;line-height:22px;text-align:justify;padding:0 4px;margin-top:1px;font-weight:500;letter-spacing:.1px}\n.watermarks{position:absolute;inset:0;pointer-events:none;z-index:3;overflow:hidden}.watermarks span{position:absolute;display:block;white-space:nowrap;color:rgba(169,63,78,.095);font-size:18px;font-weight:400;transform:rotate(-48deg);transform-origin:center}\n@media print{@page{size:698px 1378px;margin:0}body{background:none}.poster{margin:0;print-color-adjust:exact;-webkit-print-color-adjust:exact}}\n\n.disclaimer{position:relative;margin:15px 0 4px;text-align:center;font-size:12px;line-height:20px;color:#888;white-space:normal}.market-generic{font-size:15px;line-height:30px;overflow-wrap:anywhere}.market-line{height:auto;min-height:39px;white-space:normal}.market-line>span{min-width:0}.index-line{flex-wrap:wrap}.sectors{height:auto}.stock.long .name{font-size:13px;letter-spacing:-.8px}.stock.long .sector{font-size:11px}.compact-stock{display:inline-block;position:relative}.compact-stock.broken{opacity:.5}.compact-stock.broken:before,.compact-stock.broken:after{content:'';position:absolute;left:0;right:0;top:50%;height:1px;background:#ca4245;transform:rotate(15deg)}.compact-stock.broken:after{transform:rotate(-15deg)}";
const LADDER_DISCLAIMER = '数据来自互联网，图表由AI生成，不构成投资建议，投资需谨慎。';
// 720 × 1280 logical pixels, exported as 1080 × 1920. Keep the title
// below the top crop of a centred portrait thumbnail; only scale the data.
const LADDER_PORTRAIT_CSS = `
.poster{width:720px;height:1280px;padding:0 22px}
.top{position:absolute;top:40px;left:22px;right:22px;margin:0;min-height:0;font-size:14px}
.market-line{min-height:30px}.index-value{font-size:17px}.market-generic{font-size:14px;line-height:24px}
.heading{position:absolute;top:172px;left:22px;right:22px;margin:0;height:auto;display:block;text-align:center;white-space:normal}
.heading h1{font-size:54px;line-height:1.15;letter-spacing:2px;font-weight:900}
.heading span{display:block;margin-top:8px;font-size:20px;line-height:26px;letter-spacing:0}
.poster-viewport{position:absolute;top:286px;left:22px;right:22px;height:918px;overflow:hidden}
.poster-content{transform-origin:top center}
.sectors{margin:0 12px 10px;min-height:0;gap:2px 18px;font-size:17px;line-height:26px}
.ladder{width:100%;border-radius:14px}.table-head{height:34px;font-size:20px}.table-head .desc{font-size:14px}
.height,.height-head{width:72px}.height{font-size:22px}.stocks{padding:7px 7px 6px;row-gap:5px}
.stock{height:53px}.stock .meta{height:17px;line-height:17px}.stock .name{line-height:19px}.stock .sector{line-height:17px}
.stock.broken:before,.stock.broken:after{top:26px}.tier.short,.tier.two,.tier.first{min-height:0}
.compact{font-size:15px;line-height:20px}.disclaimer{position:absolute;left:26px;right:26px;bottom:34px;margin:0;font-size:12px;line-height:18px}
@media print{@page{size:720px 1280px;margin:0}}
`;
function fitLadderPoster(poster){
  const content=poster.querySelector('.poster-content'),viewport=poster.querySelector('.poster-viewport');
  content.style.transform='none';
  const scale=Math.min(1,viewport.clientHeight/content.scrollHeight);
  if(!Number.isFinite(scale)||scale<0.72)throw new Error('天梯数据过多，9:16单图会导致字号过小，请减少本次数据后分批生成（未裁掉数据）');
  content.style.transform=`scale(${scale})`;
  return scale;
}
function ladderEscape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function ladderTemplate(data) {
  const e=ladderEscape;
  const p=data.presentation||{};
  const wording=(key,fallback)=>e(p[key]??fallback);
  const hasChange=s=>s.change!=null&&String(s.change).trim()!=='';
  const broken=s=>hasChange(s)||s.broken===true;
  function stock(s) {
    const change=Number(String(s.change||'').replace(/[％%\s]/g,'').replace(/−/g,'-').replace(/＋/g,'+'));
    const cls=hasChange(s)?change<0?'down':change>0?'up':'':'';
    const meta=hasChange(s)?e(s.change):s.oneWord===true?'<em>一字板</em>':e(s.time);
    return `<div class="stock ${broken(s)?'broken':''} ${String(s.name).length>4?'long':''}"><span class="meta ${cls}">${meta}</span><span class="name">${e(s.name)}</span><span class="sector ${s.sector==='电池'?'battery':s.sector==='出版'?'publish':''}">${e(s.sector)}</span></div>`;
  }
  const groups=data.groups.map(g=>{
    const first=/首\s*板/.test(g.height);
    let content='',compact=[];
    const flush=()=>{if(compact.length){content+=`<div class="compact">${compact.map(s=>`<span class="compact-stock ${broken(s)?'broken':''}">${e(s.name)}</span>`).join('、')}</div>`;compact=[];}};
    for(const s of g.stocks){if(first&&!s.time&&!s.sector&&!hasChange(s)&&s.oneWord!==true)compact.push(s);else{flush();content+=stock(s);}}flush();
    const height=first?`${wording('firstBoard','首 板')}<br>(${g.stocks.length})`:e(g.height);
    return `<div class="tier ${first?'first':g.stocks.length<=7?'short':g.stocks.length<=14?'two':''}"><div class="height">${height}</div><div class="stocks">${content}</div></div>`;
  }).join('');
  const parts=data.date.split('-').map(Number);
  const dateText=`${parts[0]}年${parts[1]}月${parts[2]}日 星期${'日一二三四五六'[new Date(Date.UTC(parts[0],parts[1]-1,parts[2])).getUTCDay()]}`;
  const market=p.market||data.market||[];
  let top='';
  const breadth=(market[3]||'').match(/^(涨|上涨)\s*(\d+)(家?)\s*(跌|下跌)\s*(\d+)(家?)$/);
  if(market.length===4&&breadth){
    const total=Number(breadth[2])+Number(breadth[5]);
    top=`<div class="market-line"><span>${e(market[0])}</span><span class="right">${e(market[1])}</span></div><div class="index-line"><span class="red index-value">${e(market[2])}</span><span class="breadth">${breadth[1]}${breadth[2]}${breadth[3]}<span class="bar"><i style="width:${total?Number(breadth[2])/total*100:50}%"></i><b></b></span><span class="green">${breadth[4]}${breadth[5]}${breadth[6]}</span></span></div>`;
  }else{top=market.map(s=>`<div class="market-generic">${e(s)}</div>`).join('');}
  const sectors=(data.sectors||[]).flatMap(s=>s.split(/\s+(?=\S+[（(])/)).map(s=>`<span class="${s.startsWith('电池')?'battery':s.startsWith('出版')?'publish':''}">${e(s)}</span>`).join('');
  return `<main class="poster"><div class="top">${top}</div><div class="heading"><h1>${wording('title','连板天梯')}</h1><span>（${e(dateText)}）</span></div><div class="poster-viewport"><div class="poster-content"><div class="sectors">${sectors}</div><section class="ladder"><div class="table-head"><span class="height-head">${wording('heightHead','高度')}</span><span class="label">${wording('tierHead','梯队')}</span><span class="desc">（${wording('brokenNote','打叉的表示断板')}）</span></div>${groups}</section></div></div><p class="disclaimer">${LADDER_DISCLAIMER}</p><div class="watermarks" aria-hidden="true">${Array.from({length:70},(_,i)=>`<span style="top:${100+i*154}px;left:${i%2?574:-57}px">小程序指标仓库</span>`).join('')}</div></main>`;
}
async function drawLadder(data) {
  if(typeof html2canvas!=='function')throw new Error('绘图组件未加载，请刷新后台');
  const frame=document.createElement('iframe');
  frame.setAttribute('aria-hidden','true');
  frame.style.cssText='position:fixed;left:-10000px;top:0;width:720px;height:1280px;border:0;pointer-events:none';
  document.body.appendChild(frame);
  try{
    const doc=frame.contentDocument;
    doc.open();doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${LADDER_CSS}${LADDER_PORTRAIT_CSS}</style></head><body>${ladderTemplate(data)}</body></html>`);doc.close();
    await doc.fonts.ready;
    const poster=doc.querySelector('.poster');
    fitLadderPoster(poster);
    return await html2canvas(poster,{scale:1.5,width:720,height:1280,windowWidth:720,windowHeight:1280,scrollX:0,scrollY:0,backgroundColor:'#f7f4eb',logging:false,imageTimeout:10000});
  }finally{frame.remove();}
}
