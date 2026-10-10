const CARDS_CSS=`*{box-sizing:border-box}body{margin:0;font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#252b35}.ac-poster{width:900px;min-height:1100px;position:relative;padding:44px;background:#f9f6ef;overflow:hidden}.ac-brand{font-size:17px;letter-spacing:3px;color:#97784d}.ac-title{font-size:38px;line-height:1.4;margin:20px 0 26px;padding-bottom:24px;border-bottom:3px solid #b82940;overflow-wrap:anywhere}.ac-block{position:relative;background:#fff;border:1px solid #e7e3dc;border-radius:12px;padding:22px;margin:16px 0}.ac-block h2{font-size:27px;margin:0;color:#ac263d;line-height:1.5}.ac-block p,.ac-block li{font-size:23px;line-height:1.85;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.ac-block ul{margin:0;padding-left:28px}.ac-block img{display:block;width:100%;height:auto}.ac-block figcaption{font-size:17px;color:#777;line-height:1.6;margin-top:12px;overflow-wrap:anywhere}.ac-footer{font-size:15px;color:#888;line-height:1.8;border-top:1px solid #ddd;padding-top:18px;margin-top:28px}.ac-watermark{position:absolute;right:0;color:rgba(169,63,78,.08);font-size:25px;transform:rotate(-40deg);pointer-events:none}`;
function articleCardsTemplate(data,page,assets,index){
  const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const blocks=page.blocks.map(b=>{
    if(b.type==='image'){
      const src=assets[b.imageId];if(!src||!/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(src))throw Error('图片素材缺失：'+b.imageId+'，请重新选择图片');
      return `<figure class="ac-block" style="margin-left:0;margin-right:0"><img src="${src}" alt="${e(b.imageId)}">${b.caption?`<figcaption>${e(b.caption)}</figcaption>`:''}</figure>`;
    }
    if(b.type==='heading')return `<section class="ac-block"><h2>${e(b.text)}</h2></section>`;
    if(b.type==='paragraph')return `<section class="ac-block"><p>${e(b.text)}</p></section>`;
    if(b.type==='bullets')return `<section class="ac-block"><ul>${b.items.map(t=>`<li>${e(t)}</li>`).join('')}</ul></section>`;
    throw Error('未知内容块类型');
  }).join('');
  return `<main class="ac-poster"><div class="ac-brand">小程序指标仓库 · 图文复盘</div><h1 class="ac-title">${e(page.title)}</h1>${blocks}<footer class="ac-footer">${e(data.title)} · ${index+1}/${data.pages.length}<br>数据来自互联网，图文由AI辅助整理，不构成投资建议，投资需谨慎。</footer>${Array.from({length:12},(_,i)=>`<span class="ac-watermark" style="top:${200+i*400}px">小程序指标仓库</span>`).join('')}</main>`;
}
async function drawArticleCard(data,page,assets,index){
  if(typeof html2canvas!=='function')throw Error('绘图组件未加载，请刷新');
  const frame=document.createElement('iframe');frame.setAttribute('aria-hidden','true');frame.style.cssText='position:fixed;left:-10000px;top:0;width:900px;height:100px;border:0';document.body.appendChild(frame);
  try{
    const doc=frame.contentDocument;doc.open();doc.write(`<!doctype html><meta charset="utf-8"><style>${CARDS_CSS}</style>${articleCardsTemplate(data,page,assets,index)}`);doc.close();await doc.fonts.ready;
    await Promise.all([...doc.images].map(img=>img.decode()));
    const poster=doc.querySelector('.ac-poster'),height=Math.ceil(poster.getBoundingClientRect().height);
    if(height>5500)throw Error(`第${index+1}页过长，请拆分JSON页面；若原图太长，请将原图切成多张后重传，避免裁切内容`);
    frame.style.height=height+'px';
    return await html2canvas(poster,{scale:1.5,width:900,height,windowWidth:900,windowHeight:height,scrollX:0,scrollY:0,logging:false,backgroundColor:'#f9f6ef',imageTimeout:15000});
  }finally{frame.remove();}
}
