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
test('Canvas export is 1080x1920 and removes frame on success or failure',async()=>{
  for(const failure of [false,true]){
    let removed=false,written='',options;
    const poster={querySelector:s=>s==='.poster-content'?{style:{},scrollHeight:1000}:{clientHeight:918}};
    const frame={setAttribute(){},style:{},remove(){removed=true;},contentDocument:{open(){},write(s){written=s;},close(){},fonts:{ready:Promise.resolve()},querySelector:()=>poster}};
    const context=layoutContext({document:{createElement:()=>frame,body:{appendChild(){}}},html2canvas:async(el,opts)=>{assert.equal(el,poster);options=opts;if(failure)throw Error('render failure');return {width:opts.width*opts.scale,height:opts.height*opts.scale};}});
    if(failure)await assert.rejects(context.drawLadder(sample),/render failure/);
    else {const canvas=await context.drawLadder(sample);assert.equal(canvas.width,1080);assert.equal(canvas.height,1920);}
    assert(removed);assert.equal(options.scale,1.5);assert.equal(options.height,1280);assert.match(written,/新华传媒/);
  }
});
test('portrait title is below thumbnail crop and excessive data is rejected rather than clipped',()=>{
  const ctx=layoutContext(),css=vm.runInNewContext('LADDER_PORTRAIT_CSS',ctx);
  assert.match(css,/top:172px/);assert.match(css,/font-size:54px/);assert.match(css,/row-gap:5px/);
  const content={style:{},scrollHeight:1200},poster={querySelector:s=>s==='.poster-content'?content:{clientHeight:918}};
  assert.equal(ctx.fitLadderPoster(poster),918/1200);
  content.scrollHeight=1600;assert.throws(()=>ctx.fitLadderPoster(poster),/未裁掉数据/);
});
test('recognition fields survive wording and portrait rendering end to end',async()=>{
  const old=process.env.DEEPSEEK_API_KEY;process.env.DEEPSEEK_API_KEY='test';
  try{
    const data={...sample,groups:[{height:'4板',stocks:[
      {name:'上涨股',change:'2.16%',broken:false,oneWord:false},
      {name:'下跌股',time:'−1.45％',broken:null,oneWord:false},
      {name:'一字股',time:'一字板',oneWord:null,broken:false},
      {name:'划线股',broken:true,oneWord:false},
      {name:'未识别股'}
    ]}],warnings:[]};
    const result=await ladder.recognize('data:image/png;base64,YQ==',async(url,opts)=>{
      const prompt=JSON.parse(opts.body).messages[0].content;
      assert.match(prompt,/必须输出change、oneWord、broken/);
      assert.match(prompt,/oneWord=true/);assert.doesNotMatch(prompt,/不要根据涨跌幅猜断板/);
      return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(data)}}]})};
    });
    const stocks=result.data.groups[0].stocks;
    assert.equal(stocks[0].broken,true);assert.equal(stocks[1].change,'−1.45％');
    assert.equal(stocks[1].time,null);assert.equal(stocks[1].broken,true);
    assert.equal(stocks[2].oneWord,true);assert.equal(stocks[2].time,null);
    assert.equal(stocks[4].oneWord,null);assert.equal(stocks[4].broken,null);
    assert(result.data.warnings.some(w=>w.includes('未识别股')));
    ladder.validate(result.data);
    const ctx=layoutContext();
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin/media-wording.js'),'utf8'),ctx);
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin/media-review.js'),'utf8'),ctx);
    const output=ctx.applyMediaWording('ladder',result.data,ctx.mediaWordingOptions('ladder',result.data,'B'));
    assert.equal(JSON.stringify(output.groups),JSON.stringify(result.data.groups));
    const html=ctx.ladderTemplate(output);
    assert.match(html,/meta up">2.16%/);assert.match(html,/meta down">−1.45％/);assert.match(html,/<em>一字板<\/em>/);
    assert.equal((html.match(/class="stock broken/g)||[]).length,3);
    const issues=ctx.mediaReviewIssues('ladder',output);
    for(const key of ['change','oneWord','broken'])assert(issues['groups.0.stocks.4.'+key]);
  }finally{if(old===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=old;}
});
test('upload prefers PNG and never compresses small state markers below quality 0.85',async()=>{
  for(const mode of ['png','jpeg','too-large']){
    const elements={ladderRecognize:{},ladderJson:{},ladderSource:{style:{}},ladderOutput:{}};
    const encodings=[],errors=[];
    const canvas={getContext:()=>({drawImage(){}}),toDataURL:(type,q)=>{
      encodings.push([type,q]);
      return mode==='png'||(mode==='jpeg'&&q===0.9)?'data:image/png;base64,YQ==':'x'.repeat(1000001);
    }};
    const ctx={document:{getElementById:id=>elements[id],createElement:()=>canvas},createImageBitmap:async()=>({width:698,height:1378,close(){}}),resetMediaWording(){},renderMediaReview(){},showAdminToast:msg=>errors.push(msg)};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin/ladder.js'),'utf8'),ctx);
    await ctx.loadLadderImage({files:[{type:'image/png',size:1234}]});
    assert.equal(encodings[0][0],'image/png');
    assert(encodings.every(([type,q])=>type==='image/png'||q>=0.85));
    assert.equal(canvas.width,698);assert.equal(canvas.height,1378);
    if(mode==='too-large'){assert.equal(elements.ladderRecognize.disabled,true);assert.match(errors[0],/保留小字清晰度/);}
    else {assert.equal(elements.ladderRecognize.disabled,false);assert.equal(errors.length,0);}
  }
});
