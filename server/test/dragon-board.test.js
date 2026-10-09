const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const dragon=require('../src/dragon-board');
const sample={date:'10-09',groups:[{name:'席位甲',stocks:[{name:'股票甲',amount:'1.09e',direction:'buy',period:'三日',note:'昨入228万'},{name:'股票乙',amount:null,direction:'sell'}]}],warnings:[]};
test('dragon schema preserves missing amounts, directions, units and optional year',()=>{
  assert.equal(dragon.validate(sample),sample);
  assert.doesNotThrow(()=>dragon.validate({...sample,date:'2026-10-09'}));
  assert.throws(()=>dragon.validate({...sample,date:''}));
  assert.throws(()=>dragon.validate({...sample,groups:[{name:'席位',stocks:[{name:'股票',direction:'red'}]}]}));
  assert.throws(()=>dragon.validate({...sample,warnings:['字'.repeat(5001)]}));
});
test('dragon extraction sends the image with its own prompt, without rendering or confirming',async()=>{
  const old=process.env.DEEPSEEK_API_KEY;process.env.DEEPSEEK_API_KEY='test';
  let calls=0;
  try{
    const result=await dragon.recognize('data:image/png;base64,YQ==',async(url,opts)=>{
      calls++;const body=JSON.parse(opts.body);
      assert.match(body.messages[0].content,/游资龙虎榜/);
      assert.match(body.messages[0].content,/不得填0/);
      assert.equal(body.messages[1].content[1].image_url.url,'data:image/png;base64,YQ==');
      return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(sample)}}]})};
    });
    assert.deepEqual(result.data,sample);assert.equal(calls,1);assert.equal(result.confirmed,undefined);
  }finally{if(old===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=old;}
});
test('dragon routes require administrator and explicit JSON confirmation',async()=>{
  const routes={},mod={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/routes/ladder.js'),'utf8'),{module:mod,require:id=>id==='../auth'?{isAdmin:t=>t==='admin'}:id==='../dragon-board'?dragon:require('../src/ladder-ocr')});
  class E extends Error{constructor(status,message){super(message);this.status=status;}}
  mod.exports({get:(p,h)=>routes[p]=h,post:(p,h)=>routes[p]=h},E);
  const confirm=routes['/api/admin/ladder/dragon/confirm'];
  assert.throws(()=>confirm({headers:{},body:{confirmed:true,data:sample}}),{status:401});
  assert.throws(()=>confirm({headers:{authorization:'admin'},body:{data:sample}}),{status:400});
  assert.equal(confirm({headers:{authorization:'admin'},body:{confirmed:true,data:sample}}).data,sample);
  await assert.rejects(routes['/api/admin/ladder/dragon/recognize']({headers:{},body:{}}),{status:401});
});
function context(extra={}){vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin/dragon-layout.js'),'utf8'),extra);return extra;}
test('dragon template escapes content and preserves labels without inventing missing numbers',()=>{
  const ctx=context();const html=ctx.dragonTemplate(sample);
  assert.match(html,/10月9日/);assert.match(html,/1.09e/);assert.match(html,/三日/);assert.match(html,/昨入228万/);
  assert.match(html,/dragon-entry buy/);assert.match(html,/dragon-entry sell/);
  assert.equal((html.match(/class="dragon-amount"/g)||[]).length,1);
  assert.match(html,/小程序指标仓库/);assert.doesNotMatch(html,/马仔数据/);
  assert.match(html,/数据来自互联网，图表由AI生成，不构成投资建议，投资需谨慎。/);
  const escaped=ctx.dragonTemplate({...sample,groups:[{name:'<script>',stocks:[{name:'<img>',direction:'unknown'}]}]});
  assert.match(escaped,/&lt;script&gt;/);assert.match(escaped,/&lt;img&gt;/);assert.doesNotMatch(escaped,/<script>/);
});
test('dragon exports at 2x resolution and always cleans up its temporary frame',async()=>{
  for(const fail of [false,true]){
    let removed=false,options;
    const poster={getBoundingClientRect:()=>({height:2200})};
    const frame={setAttribute(){},style:{},remove(){removed=true;},contentDocument:{open(){},write(){},close(){},fonts:{ready:Promise.resolve()},querySelector:()=>poster}};
    const ctx=context({document:{createElement:()=>frame,body:{appendChild(){}}},html2canvas:async(el,opts)=>{options=opts;if(fail)throw Error('render failed');return {width:2000};}});
    if(fail)await assert.rejects(ctx.drawDragon(sample),/render failed/);else assert.equal((await ctx.drawDragon(sample)).width,2000);
    assert(removed);assert.equal(options.scale,2);assert.equal(options.height,2200);
  }
});
