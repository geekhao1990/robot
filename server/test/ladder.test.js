const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const ladder=require('../src/ladder-ocr');
const sample={date:'2026-10-09',market:['市场情绪：68'],sectors:[],groups:[{height:'9板',stocks:[{name:'新华传媒',time:null,sector:'出版',oneWord:true,broken:null}]}],warnings:['核对断板']};
test('validate confirmed data and reject malformed fields',()=>{
  assert.equal(ladder.validate(sample),sample);
  assert.throws(()=>ladder.validate({...sample,date:''}));
  assert.throws(()=>ladder.validate({...sample,groups:[{height:'1板',stocks:[{name:'股票',broken:'false'}]}]}));
});
test('long review warnings are preserved without relaxing canvas field limits',()=>{
  const warning='首板底部一行15只个股未显示涨停时间与所属板块，需人工确认。'.repeat(10);
  const data={...sample,warnings:[warning]};
  assert.equal(ladder.validate(data).warnings[0],warning);
  assert.doesNotThrow(()=>ladder.validate({...sample,warnings:['字'.repeat(5000)]}));
  assert.throws(()=>ladder.validate({...sample,warnings:['字'.repeat(5001)]}),/5000/);
  assert.throws(()=>ladder.validate({...sample,warnings:[{}]}),/warnings/);
  assert.throws(()=>ladder.validate({...sample,warnings:'不是数组'}),/warnings/);
  assert.throws(()=>ladder.validate({...sample,market:['字'.repeat(121)]}),/market/);
});
test('image goes directly to DeepSeek and result stays unconfirmed',async()=>{
  const keys=['DEEPSEEK_API_KEY'];
  const old=keys.map(k=>process.env[k]);keys.forEach(k=>process.env[k]='test');
  const calls=[];
  try{
    const result=await ladder.recognize('data:image/png;base64,YQ==',async(url,opts)=>{
      calls.push({url,opts});return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(sample)}}]})};
    });
    assert.equal(result.data.groups[0].stocks[0].name,'新华传媒');
    assert.equal(result.confirmed,undefined);
    assert.equal(calls.length,1);
    assert.equal(calls[0].url,'https://api.deepseek.com/chat/completions');
    const body=JSON.parse(calls[0].opts.body);
    assert.equal(body.model,'deepseek-flash');
    assert.equal(body.thinking.type,'disabled');
    assert.equal(body.max_tokens,32768);
    assert.match(body.messages[0].content,/完整保留所有行/);
    assert.equal(body.messages[1].content[1].image_url.url,'data:image/png;base64,YQ==');
    assert.equal(ladder.status().ocrConfigured,undefined);
  }finally{keys.forEach((k,i)=>old[i]===undefined?delete process.env[k]:process.env[k]=old[i]);}
});
test('truncated output is rejected, logged safely and never automatically retried',async()=>{
  const old=process.env.DEEPSEEK_API_KEY,oldWarn=console.warn;
  process.env.DEEPSEEK_API_KEY='test-secret';const logs=[];console.warn=(...args)=>logs.push(args.join(' '));
  try{
    for(const content of ['{"groups":[',JSON.stringify(sample)]){
      let calls=0;
      await assert.rejects(ladder.recognize('data:image/png;base64,YQ==',async()=>{
        calls++;return {ok:true,json:async()=>({usage:{completion_tokens:32768},choices:[{finish_reason:'length',message:{content}}]})};
      }),e=>e.status===502&&/不是图片被裁切/.test(e.message)&&!/减少图片/.test(e.message));
      assert.equal(calls,1);
    }
    assert.equal(logs.length,2);assert.match(logs[0],/32768/);
    assert.doesNotMatch(logs.join(' '),/test-secret|base64|新华传媒/);
  }finally{console.warn=oldWarn;if(old===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=old;}
});
test('routes require admin and explicit confirmation',()=>{
  const routes={};const mod={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/routes/ladder.js'),'utf8'),{module:mod,require:id=>id==='../auth'?{isAdmin:t=>t==='admin'}:ladder});
  class E extends Error{constructor(status,message){super(message);this.status=status;}}
  mod.exports({get:(p,h)=>routes[p]=h,post:(p,h)=>routes[p]=h},E);
  assert.throws(()=>routes['/api/admin/ladder/config']({headers:{}}),{status:401});
  assert.throws(()=>routes['/api/admin/ladder/confirm']({headers:{authorization:'admin'},body:{data:sample}}),{status:400});
  assert.equal(routes['/api/admin/ladder/confirm']({headers:{authorization:'admin'},body:{data:sample,confirmed:true}}).data,sample);
});
function layoutContext(extra={}) {
  const context={...extra};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin/ladder-layout.js'),'utf8'),context);
  return context;
}
test('shared template preserves data, disclaimer and red cross styling',()=>{
  const context=layoutContext();
  const html=context.ladderTemplate({...sample,groups:[{height:'4板',stocks:[{name:'上涨股',sector:'电池',change:'2.16%',broken:null},{name:'下跌股',change:'-1.45%',broken:false}]}]});
  assert.match(html,/stock broken/);assert.match(html,/meta up/);assert.match(html,/meta down/);
  assert.match(html,/小程序指标仓库/);
  assert.match(html,/数据来自互联网，图表由AI生成，不构成投资建议，投资需谨慎。/);
  const css=vm.runInNewContext('LADDER_CSS',context);
  assert.match(css,/opacity:.5/);assert.match(css,/100% \/ 7/);
  assert.match(context.ladderTemplate(sample),/一字板/);
});
test('compact names stay in first board, are escaped and counted',()=>{
  const context=layoutContext();
  const html=context.ladderTemplate({...sample,groups:[{height:'首板',stocks:[{name:'<img src=x onerror=alert(1)>'},{name:'股票二'}]}]});
  assert.match(html,/首 板<br>\(2\)/);assert.match(html,/class="compact"/);
  assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img src=x/);
  const normal=context.ladderTemplate({...sample,groups:[{height:'首板',stocks:[{name:'股票',time:'09:30',sector:'电池'}]}]});
  assert.doesNotMatch(normal,/class="compact"/);
});
test('Canvas renders unchanged HTML at 2x, exports 9:16 and cleans up on success or failure',async()=>{
  for(const failure of [false,true]){
    let removed=false,written='',options;
    const poster={getBoundingClientRect:()=>({height:1400})};
    const frame={setAttribute(){},style:{},remove(){removed=true;},contentDocument:{open(){},write(s){written=s;},close(){},fonts:{ready:Promise.resolve()},querySelector:()=>poster}};
    const canvas={getContext:()=>({fillRect(){},drawImage(){}})};
    const context=layoutContext({document:{createElement:tag=>tag==='canvas'?canvas:frame,body:{appendChild(){}}},html2canvas:async(el,opts)=>{assert.equal(el,poster);options=opts;if(failure)throw Error('render failure');return {width:1396,height:2800};}});
    if(failure)await assert.rejects(context.drawLadder(sample),/render failure/);
    else {const result=await context.drawLadder(sample);assert.equal(result.width,1080);assert.equal(result.height,1920);}
    assert(removed);assert.equal(options.scale,2);assert.equal(options.height,1400);assert.match(written,/新华传媒/);
  }
});
test('ladder export preserves all pixels with proportional fitting for tall and wide originals',()=>{
  for(const original of [{width:1396,height:2800},{width:1396,height:1200}]){
    let draw;const canvas={getContext:()=>({fillRect(){},drawImage:(...args)=>draw=args})};
    const ctx=layoutContext({document:{createElement:()=>canvas}});
    ctx.ladderPortraitCanvas(original);
    const [source,x,y,w,h]=draw;
    assert.equal(source,original);assert.equal(draw.length,5);
    assert(Math.abs(w/h-original.width/original.height)<1e-9);
    assert(x>=0&&y>=0&&x+w<=1080.00001&&y+h<=1920.00001);
    assert.equal(canvas.width,1080);assert.equal(canvas.height,1920);
  }
});
test('market header uses template styling regardless of row count or order without changing JSON',()=>{
  const ctx=layoutContext();
  const market=['沪深总成交：放量 市场情绪：68','无明显偏好，风格整体上涨','上证指数 3813.79 +1.89 +0.05%','涨3297 跌2145'];
  const data={...sample,market},before=JSON.stringify(data),html=ctx.ladderTemplate(data);
  assert.equal(JSON.stringify(data),before);
  assert.doesNotMatch(html,/市场情绪|无明显偏好|风格整体上涨/);
  assert.match(html,/沪深总成交：放量/);assert.match(html,/class="index-line"/);assert.match(html,/class="bar"/);
  assert.match(html,/3813.79 \+1.89 \+0.05%/);assert.match(html,/涨3297/);assert.match(html,/跌2145/);
  const variants=[['上涨家数：3,297','上证指数：3813.79 -1.89 -0.05%','下跌家数：2,145'],['上涨3297家，下跌2145家','上证指数 3813.79 +1.89 +0.05%']];
  for(const rows of variants){const output=ctx.ladderMarketTop(rows);assert.match(output,/class="bar"/);assert.match(output,/class="index-value"/);}
  assert.match(ctx.ladderMarketTop(variants[0]),/class="green">3813.79 -1.89 -0.05%/);
});
test('market header does not invent missing breadth and safely escapes unknown notes',()=>{
  const ctx=layoutContext();
  const html=ctx.ladderMarketTop(['市场情绪：68','风格偏好不明显','上证指数：3800 +0.1%','上涨2000家','<img src=x>']);
  assert.doesNotMatch(html,/市场情绪|偏好|class="bar"|下跌/);
  assert.match(html,/上涨2000家/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);
});
