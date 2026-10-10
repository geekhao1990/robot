const CARDS_CSS=`*{box-sizing:border-box}body{margin:0;font-family:"Microsoft YaHei","PingFang SC",sans-serif;color:#252b35}.ac-poster{width:900px;padding:24px 60px;background:#fff;overflow:hidden}.ac-brand{font-size:18px;letter-spacing:2px;color:#929292;margin:14px 0 24px}.ac-title{font-size:43px;line-height:1.5;margin:0 0 34px;padding-bottom:22px;border-bottom:3px solid #af3545;overflow-wrap:anywhere}.ac-heading{font-size:34px;line-height:1.6;margin:30px 0 18px;color:#a52c40}.ac-paragraph{font-size:30px;line-height:1.95;margin:0 0 24px;white-space:pre-wrap;overflow-wrap:anywhere;text-align:justify}.ac-footer{font-size:18px;color:#999;line-height:1.8;border-top:1px solid #e5e5e5;padding-top:20px;margin:32px 0 10px}`;
function articleCardsTemplate(data,page,index){
  const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const blocks=page.blocks.map(b=>{
    if(b.type==='heading')return `<h2 class="ac-heading">${e(b.text)}</h2>`;
    if(b.type==='paragraph')return `<p class="ac-paragraph">${e(b.text)}</p>`;
    throw Error('复盘文章仅支持文字内容');
  }).join('');
  const header=index===0?`<div class="ac-brand">小程序指标仓库 · 市场观察</div><h1 class="ac-title">${e(data.title)}</h1>`:'';
  const footer=index===data.pages.length-1?'<footer class="ac-footer">数据来自互联网，文章由AI辅助整理，不构成投资建议，投资需谨慎。</footer>':'';
  return `<main class="ac-poster">${header}${blocks}${footer}</main>`;
}
async function drawArticleCard(data,page,index){
  if(typeof html2canvas!=='function')throw Error('绘图组件未加载，请刷新');
  const frame=document.createElement('iframe');frame.setAttribute('aria-hidden','true');frame.style.cssText='position:fixed;left:-10000px;top:0;width:900px;height:100px;border:0';document.body.appendChild(frame);
  try{
    const doc=frame.contentDocument;doc.open();doc.write(`<!doctype html><meta charset="utf-8"><style>${CARDS_CSS}</style>${articleCardsTemplate(data,page,index)}`);doc.close();await doc.fonts.ready;
    const poster=doc.querySelector('.ac-poster'),height=Math.ceil(poster.getBoundingClientRect().height);
    if(height>5500)throw Error('该内容段落排版过长，请在原文补充小标题或分段后重试');
    frame.style.height=height+'px';
    return await html2canvas(poster,{scale:1.5,width:900,height,windowWidth:900,windowHeight:height,scrollX:0,scrollY:0,logging:false,backgroundColor:'#fff'});
  }finally{frame.remove();}
}
