const SECTION_NAMES=['情绪量化','涨停跌停数','市场整体情绪','大肉大面数','实盘赛'];
function headingName(text){
  return String(text||'').trim().replace(/^#{1,6}\s*/,'').replace(/[：:]\s*$/,'').trim();
}
function isHeading(text){
  const t=String(text||'').trim();
  return (t.length<=32&&/[：:]$/.test(t))||/^#{1,6}\s+\S/.test(t)||SECTION_NAMES.includes(t);
}
function prepareText(text){
  if(typeof text!=='string')return text;
  // Support pasted headings on one line and "实盘赛：普遍亏损…".
  let result=text.replace(/\r\n?/g,'\n');
  const re=new RegExp('(^|\\n)([ \\t]*(?:#{1,6}\\s*)?(?:'+SECTION_NAMES.join('|')+')[：:])[ \\t]*(?=\\S)','g');
  for(let i=0;i<SECTION_NAMES.length;i++)result=result.replace(re,'$1$2\n');
  return result.split('\n').flatMap(line=>{
    const sentences=line.match(/[^。！？；]+[。！？；]*|[。！？；]+/g)||[line];
    if(new Set(sentences.map(inferredSection).filter(Boolean)).size<2)return [line];
    const pieces=[];let current='',kind='';
    for(const sentence of sentences){
      const next=inferredSection(sentence);
      if(next&&kind&&next!==kind){pieces.push(current);current='';}
      current+=sentence;if(next)kind=next;
    }
    if(current)pieces.push(current);return pieces;
  }).join('\n');
}
function inferredSection(text){
  if(/(?:上涨|下跌|涨跌)(?:家数|个股|股票).*占比|上涨家数占比/.test(text))return '情绪量化';
  if(/大肉|大面/.test(text)&&/\d/.test(text))return '大肉大面数';
  if(/正反馈|负反馈|赚钱效应|情绪.{0,8}(?:修复|分化|退潮)/.test(text))return '市场整体情绪';
  if(/实盘赛|参赛|整体(?:亏|盈)|实盘.*(?:收益|亏损|盈利)/.test(text))return '实盘赛';
  if(/(?:涨停|跌停).*\d|\d.*(?:涨停|跌停)/.test(text))return '涨停跌停数';
  return '';
}
function arrangeSections(paragraphs){
  const sections=[],moves=[];let ordinary=[],region=[];
  const pushOrdinary=()=>{if(ordinary.length){sections.push({paragraphs:ordinary});ordinary=[];}};
  const pushRegion=()=>{
    if(!region.length)return;
    const groups=[],entries=[];let current;
    for(const p of region){
      const name=headingName(p.original??p.rewritten);
      if(isHeading(p.original??p.rewritten)&&SECTION_NAMES.includes(name)){
        current={name,paragraphs:[{...p,rewritten:name+'：'}]};groups.push(current);
      }else entries.push({p,from:current});
    }
    for(const {p,from} of entries){
      const targetName=inferredSection(p.original??p.rewritten)||p.section||'';
      // Only relocate to a unique, existing heading within this part of the article.
      const matches=groups.filter(g=>g.name===targetName);
      const target=matches.length===1?matches[0]:from;
      target.paragraphs.push(p);
      if(target!==from)moves.push({id:p.id,from:from.name,to:target.name,description:`将此段从“${from.name}”归到“${target.name}”，与对应配图位置对齐。`});
    }
    sections.push(...groups);region=[];
  };
  for(const p of paragraphs){
    const text=p.original??p.rewritten,name=headingName(text);
    if(isHeading(text)&&SECTION_NAMES.includes(name)){pushOrdinary();region.push(p);}
    else if(isHeading(text)){pushRegion();pushOrdinary();ordinary.push(p);}
    else if(region.length)region.push(p);
    else ordinary.push(p);
  }
  pushRegion();pushOrdinary();return {sections,moves};
}
function paginateSections(sections){
  const pages=[];
  for(const section of sections){
    let blocks=[],weight=0;
    const flush=()=>{if(blocks.length){pages.push({blocks,section:section.name||'',insertImageAfter:false});blocks=[];weight=0;}};
    for(const p of section.paragraphs){
      const heading=isHeading(p.original??p.rewritten);
      const chars=Array.from(p.rewritten),pieces=[];
      for(let i=0;i<chars.length;i+=700)pieces.push(chars.slice(i,i+700).join(''));
      for(const text of pieces){
        // Safety limit only, not equal-size pagination. Do not strand a heading.
        const cost=text.length+45;
        if(weight+cost>1100&&blocks.length&&(blocks.at(-1).type!=='heading'||weight>1300))flush();
        blocks.push({type:heading?'heading':'paragraph',text,sourceIds:[p.id]});weight+=cost;
      }
    }
    flush();
    if(section.name&&pages.length)pages.at(-1).insertImageAfter=true;
  }
  return pages;
}
module.exports={SECTION_NAMES,prepareText,arrangeSections,paginateSections};
