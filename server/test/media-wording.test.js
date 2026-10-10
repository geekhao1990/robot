const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {validate}=require('../src/ladder-ocr');
const sample={date:'2026-10-09',market:['沪深总成交：放量 市场情绪：68','无明显偏好，风格整体上涨','上证指数 3813.79 +1.89 +0.05%','涨3297 跌2145'],groups:[{height:'首板',stocks:[{name:'股票甲',time:'09:30',sector:'电池',change:null}]}]};
const read=name=>fs.readFileSync(path.join(__dirname,'../public/admin',name),'utf8');
function make(extra={}){vm.runInNewContext(read('ladder-layout.js'),extra);vm.runInNewContext(read('media-wording.js'),extra);vm.runInNewContext(read('media-review.js'),extra);return extra;}
test('ABC wording preserves facts and original rendering while unknown modules skip',()=>{
  const ctx=make(),before=JSON.stringify(sample);
  for(const variant of ['A','B','C']){
    const data=ctx.applyMediaWording('ladder',sample,ctx.mediaWordingOptions('ladder',sample,variant));
    validate(data);
    assert.equal(JSON.stringify(data.groups),JSON.stringify(sample.groups));
    assert.equal(JSON.stringify(data.market),JSON.stringify(sample.market));
    const html=ctx.ladderTemplate(data);
    assert.match(html,/class="bar"/);assert.match(html,/3297/);assert.match(html,/2145/);
    if(variant==='A')assert.equal(html,ctx.ladderTemplate(sample));
    if(variant==='B')assert.match(html,/<h1>连板复盘/);
    if(variant==='C')assert.match(html,/上涨3297家/);
  }
  assert.equal(JSON.stringify(sample),before);
  assert.equal(ctx.mediaWordingOptions('dragon',sample).length,0);
  assert.equal(JSON.stringify(ctx.applyMediaWording('dragon',sample,[])),before);
});
test('individual deselection and manual text are respected; facts and limits validated',()=>{
  const ctx=make(),rows=ctx.mediaWordingOptions('ladder',sample,'B');
  rows[0].enabled=false;rows[1].value='板数';
  const data=ctx.applyMediaWording('ladder',sample,rows);
  assert.equal(data.presentation.title,'连板天梯');assert.equal(data.presentation.heightHead,'板数');
  validate(data);
  data.presentation.market[2]='上证指数 3813.79 -1.89 +0.05%';
  assert.throws(()=>validate(data),/数值及正负号/);
  assert.throws(()=>validate({...sample,presentation:{title:'过长过长过长'}}),/最多4/);
  assert.throws(()=>validate({...sample,presentation:{groups:[]}}),/文案/);
});
test('both templates draw directly; wording is optional and stale wording is rejected',async()=>{
  const elements={};for(const id of ['content','ladderConfig','ladderJson','ladderOutput','mediaWording'])elements[id]={innerHTML:'',value:'',appendChild(){}};
  let draws=0;const errors=[];
  const ctx=make({document:{getElementById:id=>elements[id],createElement:()=>({style:{}})},api:async(url,opts)=>opts?{data:JSON.parse(opts.body).data}:{},confirm:()=>{throw Error('unexpected confirmation');},showAdminToast:e=>errors.push(e)});
  vm.runInNewContext(read('ladder.js'),ctx);
  ctx.drawLadder=ctx.drawDragon=async()=>{draws++;return {toDataURL:()=>''};};
  ctx.renderLadder();elements.ladderJson.value=JSON.stringify(sample);
  await ctx.confirmLadder({});assert.equal(draws,1);assert.equal(elements.mediaWording.innerHTML,'');
  ctx.openLadderWording();assert.match(elements.mediaWording.innerHTML,/A 保留原文/);
  ctx.selectMediaWording('C');await ctx.confirmLadder({},true);assert.equal(draws,2);
  ctx.invalidateLadder();assert.equal(elements.mediaWording.innerHTML,'');
  await ctx.confirmLadder({},true);assert.equal(draws,2);assert.match(errors[0],/JSON已变更/);
  ctx.renderLadder('dragon');elements.ladderJson.value=JSON.stringify(sample);
  await ctx.confirmLadder({});assert.equal(draws,3);assert.equal(elements.mediaWording.innerHTML,'');
});
test('one recognize click calls DS once then draws automatically for both templates',async()=>{
  for(const kind of ['ladder','dragon']){
    const elements={};for(const id of ['ladderJson','ladderOutput','ladderNotice','mediaWording'])elements[id]={innerHTML:'',value:'',appendChild(){}};
    const calls=[],errors=[];let draws=0;
    const ctx=make({document:{getElementById:id=>elements[id],createElement:()=>({style:{}})},api:async(url,opts)=>{calls.push(url);return {data:url.endsWith('/recognize')?sample:JSON.parse(opts.body).data};},confirm:()=>{throw Error('unexpected confirmation');},showAdminToast:e=>errors.push(e)});
    vm.runInNewContext(read('ladder.js'),ctx);
    vm.runInNewContext(`ladderImage='data:image/png;base64,YQ==';mediaKind='${kind}'`,ctx);
    ctx.renderMediaReview=()=>{};
    ctx.drawLadder=ctx.drawDragon=async()=>{draws++;return {toDataURL:()=>''};};
    const button={};await ctx.recognizeLadder(button);
    assert.equal(calls.filter(p=>p.endsWith('/recognize')).length,1);
    assert.equal(draws,1);assert.equal(errors.length,0);assert.equal(button.disabled,false);
    await ctx.confirmLadder({});assert.equal(draws,2);
    assert.equal(calls.filter(p=>p.endsWith('/recognize')).length,1);
  }
});
