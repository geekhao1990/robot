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
  const texts=[];const ctx={fillRect(){},fillText:t=>texts.push(t),strokeRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}};
  const canvas={getContext:()=>ctx};const context={document:{createElement:()=>canvas}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin/ladder.js'),'utf8'),context);
  context.drawLadder(sample);
  assert(texts.includes('新华传媒'));assert(texts.includes('一字板'));assert.equal(canvas.width,1080);
});
