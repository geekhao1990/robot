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
test('canvas draws supplied data only and frontend parses',()=>{
  const texts=[];const ctx={save(){},restore(){},fillRect(){},fillText:t=>texts.push(t),strokeRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}};
  const canvas={getContext:()=>ctx};const context={document:{createElement:()=>canvas}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin/ladder.js'),'utf8'),context);
  context.drawLadder(sample);
  assert(texts.includes('新华传媒'));assert(texts.includes('一字板'));assert.equal(canvas.width,1080);
});
test('change values produce half-opacity red crosses and signed colors; sparse first-board rows compact',()=>{
  const texts=[],strokes=[];
  const ctx={globalAlpha:1,save(){this.saved=this.globalAlpha;},restore(){this.globalAlpha=this.saved;},fillRect(){},strokeRect(){},beginPath(){},moveTo(){},lineTo(){},
    fillText(t){texts.push({text:t,color:this.fillStyle,alpha:this.globalAlpha});},stroke(){strokes.push({color:this.strokeStyle,alpha:this.globalAlpha});}};
  const canvas={getContext:()=>ctx},context={document:{createElement:()=>canvas}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin/ladder.js'),'utf8'),context);
  context.drawLadder({...sample,groups:[{height:'4板',stocks:[{name:'上涨股',sector:'电池',change:'2.16%',broken:null},{name:'下跌股',change:'-1.45%',broken:false}]}]});
  assert(texts.some(t=>t.text==='2.16%'&&t.color==='#ff3b30'&&t.alpha===0.5));
  assert(texts.some(t=>t.text==='-1.45%'&&t.color==='#00a84f'&&t.alpha===0.5));
  assert(texts.some(t=>t.text==='电池'&&t.alpha===0.5));
  assert.equal(strokes.length,2);assert(strokes.every(s=>s.color==='#ff3b30'&&s.alpha===0.5));
  assert.equal(ctx.globalAlpha,1);
  const stocks=Array.from({length:15},()=>({name:'测试股票'}));
  context.drawLadder({...sample,groups:[{height:'首板',stocks}]});const compact=canvas.height;
  context.drawLadder({...sample,groups:[{height:'首板',stocks:stocks.map(s=>({...s,time:'09:30',sector:'电池'}))}]});
  assert.equal(canvas.height-compact,3*(145-58));
});
