const article=require('./article-rewrite');
const {arrangeSections,paginateSections}=require('./article-sections');
const fail=message=>Object.assign(new Error(message),{status:400});
// Pagination is layout only: it must never add page labels to the article.
function paginate(paragraphs){return paginateSections(arrangeSections(paragraphs).sections);}
async function plan(body,token,fetchImpl){
  if(body?.image||body?.images?.length||body?.assetIds?.length)throw fail('复盘文章功能仅接收文字，不上传或识别图片，请刷新后台');
  const result=await article.rewrite({text:body?.text,style:'smooth',voice:'neutral',format:'recapCards'},fetchImpl);
  const arranged=arrangeSections(result.paragraphs),ordered=arranged.sections.flatMap(s=>s.paragraphs);
  const data={title:'市场复盘',pages:paginateSections(arranged.sections)};
  const changes=result.paragraphs.map(p=>{
    const final=ordered.find(o=>o.id===p.id);
    return {id:p.id,original:p.original,rewritten:final.rewritten,changes:[...p.changes,...(final.rewritten!==p.rewritten?['保留原标题作为配图分隔点。']:[]),...arranged.moves.filter(m=>m.id===p.id).map(m=>m.description)],warnings:p.warnings};
  });
  const warnings=[...new Set([...result.warnings.filter(w=>!w.includes('取消勾选')), ...changes.flatMap(p=>p.warnings)])];
  return {data,article:ordered.map(p=>p.rewritten).join('\n\n'),changes,layoutChanges:arranged.moves,removed:result.removed,warnings};
}
module.exports={plan,paginate};
