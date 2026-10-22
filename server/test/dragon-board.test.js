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
      assert.equal(body.thinking.type,'disabled');assert.equal(body.max_tokens,32768);
      assert.match(body.messages[0].content,/游资龙虎榜/);
      assert.match(body.messages[0].content,/不得填0/);
      assert.match(body.messages[0].content,/尤其最后一行/);
      assert.match(body.messages[0].content,/红色=buy/);
      assert.match(body.messages[0].content,/绿色=sell/);
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
test('period suffix is separated and last-row directions survive missing amounts',()=>{
  const data={date:'10-21',groups:[{name:'拉萨天团',stocks:[
    {name:'同为股份（三日）',period:null,amount:null,direction:'buy'},
    {name:'慧辰股份',period:null,amount:null,direction:'sell'},
    {name:'股票(3日)',period:'三日',amount:null,direction:'sell'},
  ]}]};
  dragon.validate(data);
  assert.equal(data.groups[0].stocks[0].name,'同为股份');
  assert.equal(data.groups[0].stocks[0].period,'三日');
  assert.equal(data.groups[0].stocks[2].name,'股票');
  const html=context().dragonTemplate(data);
  assert.match(html,/dragon-entry buy"><span>同为股份<\/span><span class="dragon-period">\(三日\)/);
  assert.match(html,/dragon-entry sell"><span>慧辰股份/);
  assert.doesNotMatch(html,/class="dragon-net /);
  const css=fs.readFileSync(path.join(__dirname,'../public/admin/dragon-layout.js'),'utf8');
  assert.match(css,/\.dragon-seat\{flex:0 0 155px;[^}]*font-size:calc\(var\(--stock-size\) \* \.75\)/);
  assert.match(css,/\.dragon-net\{[^}]*font-size:calc\(var\(--stock-size\) \* \.75 - 1px\)/);
  assert.match(css,/padding:16px 17px 12px/);
  assert.match(css,/\.dragon-entry\{margin:0;font-size:var\(--stock-size\)/);
  assert.match(css,/font-size:calc\(var\(--stock-size\) \* \.6\)/);
  assert.match(css,/\.dragon-row\{flex:0 0 auto/);
  assert.match(css,/\.dragon-net\{[^}]*font-family:"Source Han Sans SC","Noto Sans CJK SC","Microsoft YaHei"[^}]*font-weight:700/);
});
test('seat rows sort by signed primary totals without moving stocks or mutating JSON',()=>{
  const ctx=context();
  const stock=(amount,direction='buy')=>({name:'股票',amount,direction,note:'昨入999亿 净888万'});
  const groups=[{name:'流出大',stocks:[stock('-2e','sell')]},{name:'缺失',stocks:[stock(null)]},{name:'流入小',stocks:[stock('1.07e'),stock('700w','sell')]},{name:'流入大',stocks:[stock('2亿')]},{name:'流出小',stocks:[stock('-1万','sell')]}];
  const before=JSON.stringify(groups);
  const ranked=ctx.dragonRankedGroups(groups);
  assert.equal(ranked.map(x=>x.group.name).join(','),'流入大,流入小,流出小,流出大,缺失');
  assert.equal(ranked[1].total,100000000);
  assert.equal(ranked[1].group,groups[2]);assert.equal(JSON.stringify(groups),before);
  assert.equal(ctx.dragonNetLabel(100000000),'净流入 +1亿');
  assert.equal(ctx.dragonNetLabel(-10000),'净流入 -1万');
  for(const amount of [null,'','不明','1.2','1e+8','-2万'])assert.equal(ctx.dragonStockAmount(stock(amount)),null);
  const html=ctx.dragonTemplate({date:'10-21',groups});
  assert.equal((html.match(/class="dragon-net /g)||[]).length,4);
  assert.doesNotMatch(html,/金额未提供|图示合计/);
  assert.match(html,/<span>流入小<\/span><small class="dragon-net buy">净流入 \+1亿/);
});
test('dragon template escapes content and preserves labels without inventing missing numbers',()=>{
  const ctx=context();const html=ctx.dragonTemplate(sample);
  assert.match(html,/10月9日/);assert.match(html,/1.09e/);assert.match(html,/三日/);assert.match(html,/昨入228万/);
  assert.match(html,/dragon-entry buy/);assert.match(html,/dragon-entry sell/);
  assert.equal((html.match(/class="dragon-amount"/g)||[]).length,1);
  assert.match(html,/指标仓库/);assert.doesNotMatch(html,/小程序指标仓库|马仔数据/);
  assert.match(html,/数据仅供参考，请勿作为投资依据。/);
  assert.match(ctx.dragonTemplate(sample,'自定义<水印>'),/自定义&lt;水印&gt;/);
  assert.doesNotMatch(html,/红色为买入|绿色为卖出|灰色为方向待确认/);
  assert.match(html,/class="dragon-signature">由【指标仓库】整理/);
  assert.equal((ctx.dragonTemplate(sample,'中央测试').match(/中央测试/g)||[]).length,1);
  assert.match(ctx.dragonTemplate(sample,''),/<div class="dragon-watermarks"><\/div>/);
  const escaped=ctx.dragonTemplate({...sample,groups:[{name:'<script>',stocks:[{name:'<img>',direction:'unknown'}]}]});
  assert.match(escaped,/&lt;script&gt;/);assert.match(escaped,/&lt;img&gt;/);assert.doesNotMatch(escaped,/<script>/);
});
test('dragon lays out full-width 1:1 at 2x and cleans up its temporary frame',async()=>{
  for(const fail of [false,true]){
    let removed=false,options;
    const poster={scrollHeight:1080,style:{setProperty(){}}};
    const frame={setAttribute(){},style:{},remove(){removed=true;},contentDocument:{open(){},write(){},close(){},fonts:{ready:Promise.resolve()},querySelector:()=>poster}};
    const canvas={getContext:()=>({fillRect(){},drawImage(){}})};
    const ctx=context({document:{createElement:tag=>tag==='canvas'?canvas:frame,body:{appendChild(){}}},html2canvas:async(el,opts)=>{options=opts;if(fail)throw Error('render failed');return {width:2000,height:4400};}});
    if(fail)await assert.rejects(ctx.drawDragon(sample),/render failed/);else {const result=await ctx.drawDragon(sample);assert.equal(result.width,1080);assert.equal(result.height,1080);}
    assert(removed);assert.equal(options.scale,2);assert.equal(options.height,1080);assert.equal(options.width,1080);
  }
});
test('dragon fits dense content without changing data and rejects overflow instead of clipping',()=>{
  const ctx=context();let size;
  const poster={style:{setProperty(key,value){if(key==='--stock-size')size=parseInt(value);}},get scrollHeight(){return size>26?1200:1080;}};
  ctx.fitDragonPoster(poster);assert.equal(size,26);
  for(const fitAt of [17,16,14]){
    const dense={style:poster.style,get scrollHeight(){return size>fitAt?1200:1080;}};
    ctx.fitDragonPoster(dense);assert.equal(size,fitAt);
  }
  assert.throws(()=>ctx.fitDragonPoster({style:{setProperty(){}},scrollHeight:2100}),/拆分榜单/);
});
test('dragon output only adds background padding, without cropping or stretching',()=>{
  for(const original of [{width:2000,height:4400},{width:2000,height:2000}]){
    let draw;const canvas={getContext:()=>({fillRect(){},drawImage:(...args)=>draw=args})};
    const ctx=context({document:{createElement:()=>canvas}});ctx.dragonPortraitCanvas(original);
    const [source,x,y,w,h]=draw;assert.equal(source,original);assert.equal(draw.length,5);
    assert(Math.abs(w/h-original.width/original.height)<1e-9);
    assert(x>=0&&y>=0&&x+w<=1080.00001&&y+h<=1080.00001);
    assert.equal(canvas.width,1080);assert.equal(canvas.height,1080);
  }
});
