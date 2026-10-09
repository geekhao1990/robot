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
   return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({article:source,warnings:[]})}}]})};
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
 const elements={};for(const id of ['articleSource','articleResult','articleStatus','articleCopy','articleWarnings','articleCleaned'])elements[id]={value:'',textContent:''};
 elements.articleSource.value=source;elements.articleStyle={value:'light'};elements.articleVoice={value:'neutral'};
 let resolve;const ctx={document:{getElementById:id=>elements[id]},confirm:()=>true,showAdminToast(){},api:()=>new Promise(r=>resolve=r)};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin/article-rewrite.js'),'utf8'),ctx);
 let pending=ctx.runArticleRewrite({});resolve({article:'<script>test</script>',cleanedSource:source,removed:0,warnings:['test']});await pending;
 assert.equal(elements.articleResult.value,'<script>test</script>');assert.equal(elements.articleWarnings.textContent,'test');
 pending=ctx.runArticleRewrite({});const fresh={value:'new screen'};elements.articleResult=fresh;resolve({article:'old result',cleanedSource:source,removed:0});await pending;assert.equal(fresh.value,'new screen');
});
