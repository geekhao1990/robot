const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const article=require('../src/article-rewrite');
const source='10.08复盘：上证指数冲高回落，下跌个股近4000家。成交1.6万亿。原文作者持有1成哈药股份，后续观察60均线。';
test('cleanup removes multiline image markup and placeholders, preserves meaningful text and citations',()=>{
 const result=article.cleanArticle(source+'\n[图片]\n![](\nhttps://wework.qpic.cn/wwpic3az/a/0\n)\nhttps://wework.qpic.cn/wwpic3az/b/0\n[政策来源](https://example.com/policy)');
 assert.equal(result.removed,3);assert.doesNotMatch(result.text,/qpic|\[图片\]/);assert.match(result.text,/政策来源/);assert.match(result.text,/1.6万亿/);
 assert.throws(()=>article.cleanArticle('[图片]'),/不足30/);assert.throws(()=>article.cleanArticle('a'.repeat(20001)),/20000/);
});
test('number warnings detect additions and omissions without changing article',()=>{
 assert.equal(article.numberChanges('跌超 - 2%，成交1.6万亿','跌超-2%，成交1.6万亿').length,0);
 assert.equal(article.numberChanges(source,source.replace('4000','5000')).length,2);
});
test('DS call uses server key, bounded non-thinking output and attribution guard',async()=>{
 const old=process.env.DEEPSEEK_API_KEY;process.env.DEEPSEEK_API_KEY='test';
 try{
  const result=await article.rewrite({text:source},async(url,opts)=>{
   const body=JSON.parse(opts.body);assert.equal(body.thinking.type,'disabled');assert.equal(body.model,'deepseek-flash');assert.match(body.messages[0].content,/不冒充使用者/);assert.match(body.messages[0].content,/不改日期/);
   assert.match(body.messages[0].content,/必须保留“大肉大面数”/);
   assert.equal(JSON.parse(body.messages[1].content).paragraphs[0].original,source);
   return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({paragraphs:[{id:'p1',rewritten:source,changes:['保持原文']}],warnings:[]})}}]})};
  });
  assert.equal(result.article,source);assert.equal(result.cleanedSource,source);
  for(const response of [{ok:false,status:429},{ok:true,json:async()=>({choices:[{finish_reason:'length'}]})},{ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'bad'}}]})}])await assert.rejects(article.rewrite({text:source},async()=>response),{status:502});
 }finally{if(old===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=old;}
});
test('article route requires admin, serializes paid calls and releases lock on failure',async()=>{
 const routes={},mod={exports:{}};let reject,called=0;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/routes/ladder.js'),'utf8'),{module:mod,require:id=>id==='../auth'?{isAdmin:t=>t==='admin'}:id==='../article-rewrite'?{rewrite:()=>{called++;return new Promise((_,r)=>reject=r);}}:{}});
 class E extends Error{constructor(status,message){super(message);this.status=status;}}
 mod.exports({get:(p,h)=>routes[p]=h,post:(p,h)=>routes[p]=h},E);
 const route=routes['/api/admin/ladder/article/rewrite'];
 await assert.rejects(route({headers:{},body:{text:source}}),{status:401});assert.equal(called,0);
 const ctx={headers:{authorization:'admin'},body:{text:source}},pending=route(ctx);
 await assert.rejects(route(ctx),{status:409});reject(Error('failed'));await assert.rejects(pending,/failed/);
 const second=route(ctx);assert.equal(called,2);reject(Error('again'));await assert.rejects(second,/again/);
});
test('frontend renders returned text as text, not HTML, and ignores late navigation results',async()=>{
 const elements={};for(const id of ['articleSource','articleResult','articleStatus','articleCopy','articleWarnings','articleCleaned','articleParagraphs','articleJson'])elements[id]={value:'',textContent:''};
 elements.articleSource.value=source;elements.articleStyle={value:'light'};elements.articleVoice={value:'neutral'};
 let resolve;const ctx={document:{getElementById:id=>elements[id]},confirm:()=>true,showAdminToast(){},api:()=>new Promise(r=>resolve=r)};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin/article-rewrite.js'),'utf8'),ctx);
 let pending=ctx.runArticleRewrite({});resolve({paragraphs:[{id:'p1',original:source,rewritten:'<script>test</script>',separator:'',changes:['替换'],warnings:[]}],cleanedSource:source,removed:0,warnings:['test']});await pending;
 assert.equal(elements.articleResult.value,'<script>test</script>');assert.equal(elements.articleWarnings.textContent,'test');
 assert.doesNotMatch(elements.articleParagraphs.innerHTML,/<script>/);assert.match(elements.articleParagraphs.innerHTML,/&lt;/);
 pending=ctx.runArticleRewrite({});const fresh={value:'new screen'};elements.articleResult=fresh;resolve({article:'old result',cleanedSource:source,removed:0});await pending;assert.equal(fresh.value,'new screen');
});
test('paragraph IDs preserve titles, lines and blank separators; invalid model mapping rejected',()=>{
 const text='大肉大面数：\n\n市场整体情绪：\n今日大面50个。';
 const paragraphs=article.splitParagraphs(text);
 assert.equal(paragraphs.map(p=>p.original+p.separator).join(''),text);
 const data={paragraphs:paragraphs.map(p=>({id:p.id,rewritten:p.original,changes:['保持标题']})),warnings:[]};
 data.paragraphs[0].rewritten='情绪统计：';
 const result=article.validateParagraphs(paragraphs,data);
 assert.equal(result[0].rewritten,'大肉大面数：');assert.match(result[0].warnings[0],/自动恢复/);
 assert.throws(()=>article.validateParagraphs(paragraphs,{...data,paragraphs:data.paragraphs.slice(1)}),/不完整/);
 assert.throws(()=>article.validateParagraphs(paragraphs,{...data,paragraphs:[data.paragraphs[1],data.paragraphs[0],data.paragraphs[2]]}),/错位/);
 assert.throws(()=>article.validateParagraphs(paragraphs,{...data,paragraphs:data.paragraphs.map(p=>({...p,rewritten:''}))}),/缺失/);
});
test('paragraph deselection, manual editing and bulk restore assemble exact original order',()=>{
 const elements={};const get=id=>elements[id]??=( {value:'',textContent:'',classList:{toggle(){}}} );
 const ctx={document:{getElementById:get}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin/article-rewrite.js'),'utf8'),ctx);
 const ps=article.splitParagraphs('大肉大面数：\n\n市场震荡下行。').map(p=>({...p,rewritten:p.original==='大肉大面数：'?'大肉大面数量：':'市场呈震荡下行走势。',changes:['同义转写'],warnings:[],accepted:true}));
 ctx.fixture=ps;vm.runInNewContext('articleReview=fixture',ctx);ctx.renderArticleParagraphs();
 ctx.chooseArticleParagraph(0,false);assert.equal(get('articleResult').value,'大肉大面数：\n\n市场呈震荡下行走势。');
 ctx.editArticleParagraph(1,'走势震荡向下。');assert.equal(get('articleResult').value,'大肉大面数：\n\n走势震荡向下。');
 ctx.editArticleParagraph(1,'');assert.equal(get('articleCopy').disabled,true);
 ctx.selectAllArticle(false);assert.equal(get('articleResult').value,'大肉大面数：\n\n市场震荡下行。');assert.equal(get('articleCopy').disabled,false);
 ctx.selectAllArticle(true);assert.equal(get('articleCopy').disabled,true);
 for(const [a,b] of [['相同','相同'],['改词','改句'],['<x>','<script>'],['字'.repeat(1000),'句'.repeat(1000)]]){
   const diff=ctx.articleDiff(a,b);assert.doesNotMatch(diff.rewritten,/<script>/);
   const plain=s=>s.replace(/<mark[^>]*>|<\/mark>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
   assert.equal(plain(diff.original),a);assert.equal(plain(diff.rewritten),b);
 }
});
