const article=require('./article-rewrite');
const fail=message=>Object.assign(new Error(message),{status:400});
// Pagination is layout only: it must never add page labels to the article.
function paginate(paragraphs,targetPages=3){
  const total=paragraphs.reduce((n,p)=>n+p.rewritten.length+45,0);
  const limit=Math.min(1100,Math.max(350,Math.ceil(total/targetPages)));
  const pages=[];let blocks=[],weight=0;
  const flush=()=>{if(blocks.length){pages.push({blocks});blocks=[];weight=0;}};
  for(const p of paragraphs){
    const isHeading=p.rewritten.length<=32&&/[：:]$/.test(p.rewritten);
    const chars=Array.from(p.rewritten),pieces=[];
    for(let i=0;i<chars.length;i+=700)pieces.push(chars.slice(i,i+700).join(''));
    for(const text of pieces){
      const cost=text.length+45;
      if(weight+cost>limit&&blocks.length&&(blocks.at(-1).type!=='heading'||weight>limit+200))flush();
      blocks.push({type:isHeading?'heading':'paragraph',text,sourceIds:[p.id]});weight+=cost;
    }
  }
  flush();return pages;
}
async function plan(body,token,fetchImpl){
  if(body?.image||body?.images?.length||body?.assetIds?.length)throw fail('复盘文章功能仅接收文字，不上传或识别图片，请刷新后台');
  const pageCount=Number(body?.pageCount??3);
  if(!Number.isInteger(pageCount)||pageCount<1||pageCount>12)throw fail('期望长图数量为1至12');
  const result=await article.rewrite({text:body?.text,style:'smooth',voice:'neutral',format:'recapCards'},fetchImpl);
  const data={title:'市场复盘',pages:paginate(result.paragraphs,pageCount)};
  const changes=result.paragraphs.map(p=>({id:p.id,original:p.original,rewritten:p.rewritten,changes:p.changes,warnings:p.warnings}));
  const warnings=[...new Set([...result.warnings.filter(w=>!w.includes('取消勾选')), ...changes.flatMap(p=>p.warnings)])];
  return {data,article:result.article,changes,removed:result.removed,warnings};
}
module.exports={plan,paginate};
