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
    assert.equal(body.messages[1].content[1].image_url.url,'data:image/png;base64,YQ==');
    assert.equal(ladder.status().ocrConfigured,undefined);
  }finally{keys.forEach((k,i)=>old[i]===undefined?delete process.env[k]:process.env[k]=old[i]);}
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
test('Canvas export uses shared HTML at 2x resolution and removes frame on success or failure',async()=>{
  for(const failure of [false,true]){
    let removed=false,written='',options;
    const poster={getBoundingClientRect:()=>({height:1400})};
    const frame={setAttribute(){},style:{},remove(){removed=true;},contentDocument:{open(){},write(s){written=s;},close(){},fonts:{ready:Promise.resolve()},querySelector:()=>poster}};
    const context=layoutContext({document:{createElement:()=>frame,body:{appendChild(){}}},html2canvas:async(el,opts)=>{assert.equal(el,poster);options=opts;if(failure)throw Error('render failure');return {width:1396};}});
    if(failure)await assert.rejects(context.drawLadder(sample),/render failure/);
    else assert.equal((await context.drawLadder(sample)).width,1396);
    assert(removed);assert.equal(options.scale,2);assert.equal(options.height,1400);assert.match(written,/新华传媒/);
  }
});
