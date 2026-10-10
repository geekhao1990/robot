const test=require('node:test'),assert=require('node:assert/strict');
const {prepareText,arrangeSections,paginateSections,stripLeadingHeader}=require('../src/article-sections');
const {splitParagraphs}=require('../src/article-rewrite');
const cards=require('../src/article-cards');
const sample=`大家好，今天复盘，市场震荡，先看量化数据与情绪变化。
情绪量化：
涨停跌停数：
市场整体情绪：
大肉大面数：
上涨家数占比 58%，整体情绪处于微热区。
昨日大面 50 个，跌停 13 个，大肉 57 个，涨停 43 个。
今日大面 13 个，跌停 8 个，大肉 102 个，涨停 69 个。
负反馈大幅减少，正反馈大幅增加。
今天市场情绪弱修复，赚钱效应有，但不大。
实盘赛：整体亏损1.62%。
题材梳理：
电池板块表现较强，不更改这部分内容。`;
const records=text=>splitParagraphs(prepareText(text)).map(p=>({...p,rewritten:p.original,changes:['保留信息'],warnings:[]}));
test('leading title/date/brand removed but dates and times in factual prose survive',()=>{
 const body='上证指数盘中下探，收阴线。\n2026年10月8日公布政策。\n盘中10:30出现回落。\n10.09';
 assert.equal(prepareText('市场复盘\n2026-10-10 15:30\n小程序指标仓库 · 市场观察\n'+body),body);
 assert.equal(prepareText('大家好，10.08：\n'+body),'大家好，\n'+body);
 for(const header of ['2026年10月10日 星期六','10月10日','时间：15:30','2026.10.10','10月10日复盘','市场复盘：2026-10-10'])assert.equal(stripLeadingHeader(header+'\n'+body),body);
 assert.equal(prepareText('2026年10月8日，上证指数盘中下探。'),'2026年10月8日，上证指数盘中下探。');
});
test('each index description ends its own image without adding index headings',()=>{
 const raw='大家好，10.08：\n上证指数盘中下探，收阴线。\n创业板冲高回落，收阴线。\n微盘股指数也是冲高回落，收阴线。\n盘面亮点：\n三大指数冲高回落，创业板跌超3%。';
 const source=records(raw),pages=paginateSections(arrangeSections(source).sections);
 assert.deepEqual(pages.map(p=>p.section),['上证指数','创业板','微盘股','']);
 assert.ok(pages.slice(0,3).every(p=>p.insertImageAfter));assert.equal(pages[3].insertImageAfter,false);
 assert.equal(pages[0].blocks.at(-1).text,'上证指数盘中下探，收阴线。');
 assert.equal(pages[1].blocks.length,1);assert.equal(pages[2].blocks.length,1);
 assert.equal(pages.flatMap(p=>p.blocks).map(b=>b.text).join(''),source.map(p=>p.rewritten).join(''));
 const tail=paginateSections(arrangeSections(records('尾盘股指数下跌。\n情绪量化：\n上涨家数占比58%。')).sections);
 assert.equal(tail[0].section,'尾盘股');assert.equal(tail[0].insertImageAfter,true);
});
test('index headings retain their description, pasted sentences split, mixed comparisons stay intact',()=>{
 const pages=paginateSections(arrangeSections(records('上证指数：\n盘中下探，收阴线。\n创业板冲高回落。微盘股指数下跌。')).sections);
 assert.deepEqual(pages.map(p=>p.section),['上证指数','创业板','微盘股']);assert.equal(pages[0].blocks.length,2);
 const mixed='上证指数与创业板走势不同。';assert.equal(paginateSections(arrangeSections(records(mixed)).sections)[0].section,'');
});
test('user example groups metrics, daily counts and feedback under their own headings',()=>{
 const source=records(sample),layout=arrangeSections(source),pages=paginateSections(layout.sections);
 const get=name=>pages.filter(p=>p.section===name).flatMap(p=>p.blocks).map(b=>b.text);
 assert.deepEqual(get('情绪量化'),['情绪量化：','上涨家数占比 58%，整体情绪处于微热区。']);
 assert.deepEqual(get('涨停跌停数'),['涨停跌停数：']);
 assert.deepEqual(get('市场整体情绪'),['市场整体情绪：','负反馈大幅减少，正反馈大幅增加。','今天市场情绪弱修复，赚钱效应有，但不大。']);
 assert.deepEqual(get('大肉大面数'),['大肉大面数：','昨日大面 50 个，跌停 13 个，大肉 57 个，涨停 43 个。','今日大面 13 个，跌停 8 个，大肉 102 个，涨停 69 个。']);
 assert.deepEqual(get('实盘赛'),['实盘赛：','整体亏损1.62%。']);
 assert.equal(pages.filter(p=>p.insertImageAfter).length,5);
 assert.equal(layout.moves.length,3);assert.deepEqual(pages.flatMap(p=>p.blocks).flatMap(b=>b.sourceIds).sort(),source.map(p=>p.id).sort());
 assert.match(pages.at(-1).blocks.map(b=>b.text).join(''),/题材梳理/);assert.equal(pages.at(-1).insertImageAfter,false);
});
test('inline headings split cleanly and clear source rules take precedence over model tags',()=>{
 assert.equal(prepareText('情绪量化：涨停跌停数：市场整体情绪：大肉大面数：实盘赛：亏损1%'),'情绪量化：\n涨停跌停数：\n市场整体情绪：\n大肉大面数：\n实盘赛：\n亏损1%');
 const ps=records(sample);ps.find(p=>p.original.includes('58%')).section='大肉大面数';
 const groups=arrangeSections(ps).sections;assert.match(groups.find(g=>g.name==='情绪量化').paragraphs[1].rewritten,/58%/);
 const nontrivial=records('情绪量化：\n市场整体情绪：\n风险偏好的量化读数较前期改善。');nontrivial.at(-1).section='情绪量化';
 assert.equal(arrangeSections(nontrivial).sections[0].paragraphs.length,2);
});
test('missing or repeated headings do not invent sections or merge unrelated parts',()=>{
 const ps=records('大肉大面数：\n上涨家数占比58%。\n题材梳理：\n昨日大面50个。\n情绪量化：\n市场整体情绪：\n上涨家数占比60%。');
 const {sections}=arrangeSections(ps);assert.match(sections[0].paragraphs[1].rewritten,/58%/);
 assert.equal(sections[1].paragraphs[1].rewritten,'昨日大面50个。');assert.match(sections[2].paragraphs[1].rewritten,/60%/);
 const duplicate=records('情绪量化：\n情绪量化：\n市场整体情绪：\n上涨家数占比58%。');assert.equal(arrangeSections(duplicate).moves.length,0);
});
test('different semantic descriptions on one pasted line split before rewriting',()=>{
 const body='上涨家数占比58%，整体情绪处于微热区。昨日大面50个，跌停13个，大肉57个，涨停43个。今日大面13个，跌停8个，大肉102个，涨停69个。负反馈大幅减少，正反馈大幅增加。今天市场情绪弱修复，赚钱效应有，但不大。';
 const prepared=prepareText(body);assert.equal(prepared.replace(/\n/g,''),body);assert.equal(prepared.split('\n').length,3);
 const {sections}=arrangeSections(records('情绪量化：\n市场整体情绪：\n大肉大面数：\n'+body));
 assert.match(sections[0].paragraphs[1].rewritten,/58%/);assert.match(sections[1].paragraphs[1].rewritten,/负反馈.*赚钱效应/);assert.match(sections[2].paragraphs[1].rewritten,/昨日.*今日/);
});
test('semantic breaks do not equalize short sections; only oversized sections continue',()=>{
 const layout=arrangeSections(records('情绪量化：\n上涨家数占比58%。\n涨停跌停数：\n市场整体情绪：\n'+('市场情绪观察。'.repeat(500))));
 const pages=paginateSections(layout.sections);assert.equal(pages[0].insertImageAfter,true);assert.equal(pages[1].blocks.length,1);
 const large=pages.filter(p=>p.section==='市场整体情绪');assert.ok(large.length>1);assert.equal(large.filter(p=>p.insertImageAfter).length,1);assert.equal(large.at(-1).insertImageAfter,true);
 assert.equal(pages.flatMap(p=>p.blocks).map(b=>b.text).join(''),layout.sections.flatMap(s=>s.paragraphs).map(p=>p.rewritten).join(''));
});
test('plan returns rearranged copied article, concrete move notes and preserved data',async()=>{
 const old=process.env.DEEPSEEK_API_KEY;process.env.DEEPSEEK_API_KEY='test';
 try{
  const result=await cards.plan({text:sample,pageCount:99},'admin',async(url,opts)=>{
   const payload=JSON.parse(opts.body);assert.match(payload.messages[0].content,/section字段/);assert.match(payload.messages[0].content,/组合数字归“大肉大面数”/);
   const input=JSON.parse(payload.messages[1].content).paragraphs;
   return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({paragraphs:input.map(p=>({id:p.id,rewritten:p.original,changes:['保留示例数据。'],section:''})),warnings:[]})}}]})};
  });
  assert.match(result.article,/情绪量化：\n\n上涨家数占比 58%/);assert.match(result.article,/市场整体情绪：\n\n负反馈/);assert.match(result.article,/大肉大面数：\n\n昨日大面 50/);
  assert.equal(result.layoutChanges.length,3);assert.ok(result.changes.some(c=>c.changes.some(s=>s.includes('归到“情绪量化”'))));
  assert.equal(result.data.pages.length,7);
 }finally{if(old===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=old;}
});
