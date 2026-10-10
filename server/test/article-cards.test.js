const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const cards=require('../src/article-cards');
const source='市场震荡下行，题材弱势轮动，下跌近4000家，成交1.6万亿。\n大肉大面数：';
const rewritten='市场呈震荡下行态势，题材轮动仍显乏力，下跌近4000家，成交1.6万亿。';
const model=()=>({paragraphs:[{id:'p1',rewritten,changes:['将“震荡下行”调整为“呈震荡下行态势”；将“弱势轮动”改成“轮动仍显乏力”。']},{id:'p2',rewritten:'大肉大面数：',changes:['保留统计标题。']}],warnings:[]});
const fixture=()=>({data:{title:'市场复盘',pages:[{blocks:[{type:'paragraph',text:rewritten,sourceIds:['p1']}]},{blocks:[{type:'heading',text:'大肉大面数：',sourceIds:['p2']}]}]},article:rewritten,changes:[{id:'p1',original:source,rewritten,changes:['句式重组'],warnings:[]}],warnings:[],removed:1});
test('text-only DS rewrite preserves mapping, reports exact changes and needs no confirmation',async()=>{
 const old=process.env.DEEPSEEK_API_KEY;process.env.DEEPSEEK_API_KEY='test';
 try{
  const result=await cards.plan({text:source+'\n[图片]\n![](https://a.test/x.png)',pageCount:2},'admin',async(url,opts)=>{
   const body=JSON.parse(opts.body);assert.equal(body.model,'deepseek-flash');assert.equal(typeof body.messages[1].content,'string');assert.doesNotMatch(opts.body,/image_url|base64/);
   assert.match(body.messages[0].content,/公众号复盘文章/);assert.match(body.messages[0].content,/不得新增“1\/3”/);assert.match(body.messages[0].content,/不摘要删减/);
   const ps=JSON.parse(body.messages[1].content).paragraphs;assert.equal(ps.length,2);assert.equal(ps[1].original,'大肉大面数：');
   return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(model())}}]})};
  });
  assert.equal(result.changes[0].original,source.split('\n')[0]);assert.equal(result.changes[0].rewritten,rewritten);assert.equal(result.removed,2);assert.match(result.changes[0].changes[0],/弱势轮动/);assert.doesNotMatch(result.warnings.join(''),/取消勾选/);
  assert.equal(result.data.pages.flatMap(p=>p.blocks).map(b=>b.text).join(''),rewritten+'大肉大面数：');
  for(const response of [{ok:false,status:429},{ok:true,json:async()=>({choices:[{finish_reason:'length'}]})},{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'bad'}}]})}])await assert.rejects(cards.plan({text:source},'admin',async()=>response),{status:502});
  const bad=model();bad.paragraphs.pop();await assert.rejects(cards.plan({text:source},'admin',async()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(bad)}}]})})),/不完整/);
 }finally{if(old===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=old;}
});
test('rejects images and invalid inputs before any paid call',async()=>{
 let calls=0;const fetch=()=>{calls++;throw Error('unexpected');};
 for(const body of [{text:source,assetIds:['id']},{text:source,images:['x']},{text:source,image:'data:x'},{text:source,pageCount:0},{text:'[图片]'},{}])await assert.rejects(cards.plan(body,'admin',fetch),{status:400});
 assert.equal(calls,0);
});
test('pagination preserves every character, avoids heading orphans and bounds dense content',()=>{
 const paragraphs=[{id:'p1',rewritten:'a'.repeat(699)+'📈'+ '分析。'.repeat(1700)},{id:'p2',rewritten:'后续观察：'},{id:'p3',rewritten:'保持原文条件，不新增判断。'}];
 const pages=cards.paginate(paragraphs,3);assert.ok(pages.length>1);
 assert.equal(pages.flatMap(p=>p.blocks).map(b=>b.text).join(''),paragraphs.map(p=>p.rewritten).join(''));
 assert.ok(pages.flatMap(p=>p.blocks).every(b=>!/[\uD800-\uDBFF]$/.test(b.text)));
 const dense=cards.paginate(Array.from({length:250},(_,i)=>({id:'p'+i,rewritten:'市场观察：'})),1);assert.ok(dense.length>1);assert.ok(dense.every(p=>p.blocks.length<35));
});
test('admin route removes uploads/confirmation and still shares a paid-call lock',async()=>{
 const routes={},mod={exports:{}};let reject;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/routes/ladder.js'),'utf8'),{module:mod,require:id=>id==='../auth'?{isAdmin:t=>t==='admin'}:id==='../article-cards'?{plan:()=>new Promise((_,r)=>reject=r)}:{}});
 class E extends Error{constructor(status,message){super(message);this.status=status;}}
 mod.exports({get:(p,h)=>routes[p]=h,post:(p,h)=>routes[p]=h},E);
 const base='/api/admin/ladder/article-cards/',ctx={headers:{authorization:'admin'},body:{text:source}};
 assert.equal(routes[base+'asset'],undefined);assert.equal(routes[base+'confirm'],undefined);await assert.rejects(routes[base+'plan']({headers:{},body:{}}),{status:401});
 const pending=routes[base+'plan'](ctx);await assert.rejects(routes[base+'plan'](ctx),{status:409});await assert.rejects(routes['/api/admin/ladder/article/rewrite'](ctx),{status:409});reject(Error('failed'));await assert.rejects(pending,/failed/);
 const next=routes[base+'plan'](ctx);reject(Error('again'));await assert.rejects(next,/again/);
});
test('article artwork has no pagination or card boxes and escapes text',()=>{
 const ctx={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin/article-cards-layout.js'),'utf8'),ctx);
 const d=fixture().data;d.title='<script>alert(1)</script>';d.pages[0].blocks[0].text='<img onerror=x>';
 const first=ctx.articleCardsTemplate(d,d.pages[0],0),last=ctx.articleCardsTemplate(d,d.pages[1],1);
 assert.doesNotMatch(first+last,/<script>|<img|\b1\/2\b|第一张|第二张|ac-block/);assert.match(first,/&lt;script&gt;/);
 assert.match(first,/ac-title/);assert.doesNotMatch(last,/ac-title|ac-brand/);assert.doesNotMatch(first,/不构成投资建议/);assert.match(last,/不构成投资建议/);
 assert.throws(()=>ctx.articleCardsTemplate(d,{blocks:[{type:'image'}]},0),/仅支持文字/);
});
test('canvas renderer uses full measured height and cleans up success/failure',async()=>{
 let removed=0,draws=0,height=1200;
 const doc={open(){},write(){},close(){},fonts:{ready:Promise.resolve()},querySelector:()=>({getBoundingClientRect:()=>({height})})};
 const ctx={document:{createElement:()=>({setAttribute(){},style:{},contentDocument:doc,remove(){removed++;}}),body:{appendChild(){}}},html2canvas:async(el,opts)=>{draws++;assert.equal(opts.height,height);return {width:1350};}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin/article-cards-layout.js'),'utf8'),ctx);const d=fixture().data;
 assert.equal((await ctx.drawArticleCard(d,d.pages[0],0)).width,1350);height=5501;await assert.rejects(ctx.drawArticleCard(d,d.pages[0],0),/过长/);assert.equal(removed,2);assert.equal(draws,1);
});
function frontend(){
 const node=()=>({children:[],style:{},value:'',innerHTML:'',hidden:true,append(...items){this.children.push(...items);},appendChild(item){this.children.push(item);},replaceChildren(){this.children=[];}});
 const elements={};for(const id of ['content','cardsText','cardsCount','cardsOutput','cardsReport','cardsStatus','cardsCleanup','cardsWarnings','cardsChanges','cardsArticle','cardsRetryDraw'])elements[id]=node();
 elements.cardsText.value=source;elements.cardsCount.value='3';
 const ctx={document:{getElementById:id=>elements[id],createElement:node},showAdminToast(){},confirm(){throw Error('should never ask confirmation');}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/admin/article-cards.js'),'utf8'),ctx);vm.runInContext('articleCardsState={revision:0,busy:false,result:null}',ctx);return {ctx,elements};
}
test('one action rewrites then draws automatically; change notes stay outside artwork',async()=>{
 const {ctx,elements}=frontend();let calls=0,draws=0;
 ctx.api=async(p,opts)=>{calls++;assert.match(p,/\/plan$/);assert.deepEqual(Object.keys(JSON.parse(opts.body)),['text','pageCount']);return fixture();};
 ctx.drawArticleCard=async()=>{draws++;return {toDataURL:()=> 'data:image/png;base64,abc'};};
 await ctx.planArticleCards({});assert.match(elements.cardsStatus.textContent,/已生成/);assert.equal(calls,1);assert.equal(draws,2);assert.equal(elements.cardsOutput.children.length,2);assert.equal(elements.cardsReport.hidden,false);assert.equal(elements.cardsArticle.value,rewritten);assert.match(elements.cardsChanges.children[0].children[0].textContent,/句式重组/);
 ctx.renderArticleCards();assert.doesNotMatch(elements.content.innerHTML,/type="file"|确认JSON|cardsJson|cardsEditor|cardsFiles/);
});
test('editing/navigating cancels stale results; redraw retries without another paid request',async()=>{
 const {ctx,elements}=frontend();let resolve,draws=0,calls=0;
 ctx.api=()=>{calls++;return new Promise(r=>resolve=r);};ctx.drawArticleCard=async()=>{draws++;throw Error('canvas failed');};
 let pending=ctx.planArticleCards({});ctx.invalidateArticleCards();resolve(fixture());await pending;assert.equal(draws,0);
 pending=ctx.planArticleCards({});resolve(fixture());await pending;assert.equal(draws,1);assert.equal(elements.cardsRetryDraw.hidden,false);assert.match(elements.cardsStatus.textContent,/canvas failed/);
 ctx.drawArticleCard=async()=>({toDataURL:()=> 'data:image/png;base64,abc'});await ctx.redrawArticleCards({});assert.equal(calls,2);assert.equal(elements.cardsRetryDraw.hidden,true);
 pending=ctx.planArticleCards({});delete elements.cardsText;resolve(fixture());await pending;assert.equal(draws,1);
});
