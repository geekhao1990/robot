const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const cards=require('../src/article-cards');
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const fixture=()=>({title:'复盘',pages:[{title:'市场观察',blocks:[{type:'paragraph',text:'市场震荡，成交1.6万亿。',sourceIds:['p1']},{type:'image',imageId:'img1',caption:'原图引用',sourceIds:[]}]}],warnings:['核对原图数字']});
test('schema rejects omissions, invented image/source IDs and malformed blocks',()=>{
 assert.equal(cards.validateCards(fixture(),['img1'],['p1']).pages.length,1);
 for(const mutate of [d=>d.pages[0].blocks.pop(),d=>d.pages[0].blocks[0].sourceIds=[],d=>d.pages[0].blocks[1].imageId='https://evil.test',d=>d.pages[0].blocks[0].sourceIds=['p9'],d=>d.pages[0].blocks[0].type='html',d=>d.pages=[],d=>d.warnings=[{}]]){
  const data=fixture();mutate(data);assert.throws(()=>cards.validateCards(data,['img1'],['p1']),{status:400});
 }
});
test('multimodal request uses owned temporary assets, cleans placeholders and consumes uploads',async()=>{
 const old=process.env.DEEPSEEK_API_KEY;process.env.DEEPSEEK_API_KEY='unit-test-only';
 try{
  const {assetId}=cards.saveAsset({image:pixel},'owner');
  await assert.rejects(cards.plan({text:'原文',assetIds:[assetId]},'other'),/不可访问/);
  await assert.rejects(cards.plan({text:'原文',assetIds:[assetId,assetId]},'owner'),/不同图片/);
  const result=await cards.plan({text:'市场震荡，成交1.6万亿。\n[图片]\n![](https://a.test/a.png)\nhttps://wework.qpic.cn/a/0',assetIds:[assetId],pageCount:2},'owner',async(url,options)=>{
   assert.equal(url,'https://api.deepseek.com/chat/completions');const body=JSON.parse(options.body);
   assert.equal(body.model,'deepseek-flash');assert.equal(body.thinking.type,'disabled');assert.match(body.messages[0].content,/不猜数字/);
   const content=body.messages[1].content;assert.equal(content[2].image_url.url,pixel);assert.equal(content[1].text,'img1');
   const input=JSON.parse(content[0].text);assert.equal(input.paragraphs.length,1);assert.equal(input.targetPages,2);
   return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(fixture())}}]})};
  });
  assert.equal(result.sources[0].id,'p1');assert.equal(result.data.pages.length,1);
  await assert.rejects(cards.plan({text:'原文',assetIds:[assetId]},'owner'),/已过期/);
  for(const response of [{ok:false,status:429},{ok:true,json:async()=>({choices:[{finish_reason:'length'}]})},{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'invalid'}}]})}])await assert.rejects(cards.plan({text:'原文'},'owner',async()=>response),{status:502});
 }finally{if(old===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=old;}
});
test('uploads reject remote URLs, oversize data and expired assets',async()=>{
 assert.throws(()=>cards.saveAsset({image:'https://a.test/a.png'},'owner'));
 assert.throws(()=>cards.saveAsset({image:'data:image/png;base64,'+'A'.repeat(900000)},'owner'));
 const {assetId}=cards.saveAsset({image:pixel},'owner'),now=Date.now;
 try{Date.now=()=>now()+31*60*1000;await assert.rejects(cards.plan({text:'原文',assetIds:[assetId]},'owner'),/过期/);}finally{Date.now=now;}
});
test('admin authorization, explicit confirmation and shared paid-task lock',async()=>{
 const routes={},mod={exports:{}};let reject,called=0;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/routes/ladder.js'),'utf8'),{module:mod,require:id=>id==='../auth'?{isAdmin:t=>t==='admin'}:id==='../article-cards'?{saveAsset(){called++;},validateCards:cards.validateCards,plan:()=>new Promise((_,r)=>reject=r)}:{}});
 class E extends Error{constructor(status,message){super(message);this.status=status;}}
 mod.exports({get:(p,h)=>routes[p]=h,post:(p,h)=>routes[p]=h},E);
 const base='/api/admin/ladder/article-cards/',ctx={headers:{authorization:'admin'},body:{}};
 assert.throws(()=>routes[base+'asset']({headers:{},body:{}}),{status:401});assert.equal(called,0);
 assert.throws(()=>routes[base+'confirm'](ctx),/先确认/);
 assert.equal(routes[base+'confirm']({...ctx,body:{confirmed:true,data:fixture(),imageIds:['img1'],sourceIds:['p1']}}).data.title,'复盘');
 const pending=routes[base+'plan'](ctx);await assert.rejects(routes[base+'plan'](ctx),{status:409});
 await assert.rejects(routes['/api/admin/ladder/article/rewrite'](ctx),{status:409});reject(Error('failed'));await assert.rejects(pending,/failed/);
 const next=routes[base+'plan'](ctx);reject(Error('failed again'));await assert.rejects(next,/failed again/);
});
test('template escapes all text and only embeds local known images',()=>{
 const ctx={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin/article-cards-layout.js'),'utf8'),ctx);
 const d=fixture();d.pages[0].title='<script>alert(1)</script>';d.pages[0].blocks[0].text='<img onerror=x>';
 const html=ctx.articleCardsTemplate(d,d.pages[0],{img1:pixel},0);
 assert.doesNotMatch(html,/<script>|<img onerror/);assert.match(html,/&lt;script&gt;/);assert.match(html,/原图引用/);assert.match(html,/不构成投资建议/);
 assert.throws(()=>ctx.articleCardsTemplate(d,d.pages[0],{img1:'https://a.test'},0),/素材缺失/);
});
test('canvas rendering waits for images, rejects oversize pages and always removes iframe',async()=>{
 let removed=0,draws=0,height=1200,decodeError=false;
 const doc={open(){},write(){},close(){},fonts:{ready:Promise.resolve()},images:[{decode:async()=>{if(decodeError)throw Error('decode failed');}}],querySelector:()=>({getBoundingClientRect:()=>({height})})};
 const ctx={document:{createElement:()=>({setAttribute(){},style:{},contentDocument:doc,remove(){removed++;}}),body:{appendChild(){}}},html2canvas:async(el,opts)=>{draws++;assert.equal(opts.height,height);return {width:1350};}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin/article-cards-layout.js'),'utf8'),ctx);const d=fixture();
 assert.equal((await ctx.drawArticleCard(d,d.pages[0],{img1:pixel},0)).width,1350);assert.equal(removed,1);
 height=5501;await assert.rejects(ctx.drawArticleCard(d,d.pages[0],{img1:pixel},0),/过长/);assert.equal(removed,2);assert.equal(draws,1);
 decodeError=true;await assert.rejects(ctx.drawArticleCard(d,d.pages[0],{img1:pixel},0),/decode failed/);assert.equal(removed,3);
});
test('frontend does not draw before confirmation or apply stale JSON results',async()=>{
 const elements={};for(const id of ['cardsText','cardsCount','cardsOutput','cardsReview','cardsJson','cardsStatus'])elements[id]={value:'',innerHTML:'',hidden:true};
 elements.cardsText.value='原文';elements.cardsCount.value='3';let resolve,draws=0;
 const ctx={document:{getElementById:id=>elements[id]},api:()=>new Promise(r=>resolve=r),confirm:()=>false,showAdminToast(){},drawArticleCard:()=>{draws++;}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/admin/article-cards.js'),'utf8'),ctx);
 vm.runInContext('articleCardsState={images:[],sources:[],revision:0,busy:false}',ctx);
 const pending=ctx.planArticleCards({});ctx.invalidateArticleCards(true);resolve({data:fixture(),sources:[]});await pending;
 assert.equal(elements.cardsJson.value,'');assert.equal(draws,0);
 elements.cardsJson.value=JSON.stringify(fixture());await ctx.generateArticleCards({});assert.equal(draws,0);
 const next=ctx.planArticleCards({});delete elements.cardsJson;resolve({data:fixture(),sources:[]});await next;assert.equal(draws,0);
});
test('readable fields update the JSON and invalidate old pictures without losing focus',()=>{
 const node=()=>({children:[],style:{},value:'',innerHTML:'',append(...items){this.children.push(...items);},replaceChildren(){this.children=[];}});
 const nodes={cardsEditor:node(),cardsJson:node(),cardsOutput:node()};nodes.cardsJson.value=JSON.stringify(fixture());nodes.cardsOutput.innerHTML='old image';
 const ctx={document:{getElementById:id=>nodes[id],createElement:node}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/admin/article-cards.js'),'utf8'),ctx);
 ctx.pixel=pixel;vm.runInContext("articleCardsState={images:[{id:'img1',data:pixel}],sources:[{id:'p1',original:'原文市场观察'}],revision:0}",ctx);
 ctx.renderArticleCardsEditor();const section=nodes.cardsEditor.children[0],title=section.children[1],paragraph=section.children[2].children[1];
 title.value='新标题';title.oninput();paragraph.value='调整后的表达';paragraph.oninput();
 const updated=JSON.parse(nodes.cardsJson.value);assert.equal(updated.pages[0].title,'新标题');assert.equal(updated.pages[0].blocks[0].text,'调整后的表达');assert.equal(nodes.cardsOutput.innerHTML,'');assert.equal(nodes.cardsEditor.children[0],section);
 assert.match(section.children[2].children[2].textContent,/原文市场观察/);
 nodes.cardsJson.value='{';ctx.renderArticleCardsEditor();assert.match(nodes.cardsEditor.textContent,/格式暂不完整/);
});
