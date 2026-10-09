const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const sample={date:'2026-10-09',market:['情绪68'],sectors:['电池(2)'],groups:[{height:'首板',stocks:[{name:'甲',time:'09:30',sector:'电池',oneWord:false,broken:false},{name:'乙',time:'29:88',sector:null,oneWord:null,broken:null,change:'-1.5%'}]}],warnings:['乙的板块不清楚']};
function setup(kind='ladder',data=sample){
 const elements={ladderJson:{value:JSON.stringify(data)},mediaReview:{innerHTML:''},mediaReviewCount:{},mediaWording:{innerHTML:'old'},ladderOutput:{innerHTML:'old'}};
 const ctx={document:{getElementById:id=>elements[id],querySelectorAll:()=>[]},mediaKind:kind,confirm:()=>true,showAdminToast:msg=>{throw Error(msg);},invalidateLadder:()=>{elements.mediaWording.innerHTML='';elements.ladderOutput.innerHTML='';}};
 for(const file of ['ladder-layout.js','media-review.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin',file),'utf8'),ctx);
 return {ctx,elements};
}
test('suspect fields are specific, nullable flags stay unknown, real dates checked',()=>{
 const {ctx}=setup(),issues=ctx.mediaReviewIssues('ladder',sample);
 assert(!Object.keys(issues).some(k=>k.startsWith('groups.0.stocks.0')));
 for(const key of ['name','sector','time','broken','oneWord'])assert(issues['groups.0.stocks.1.'+key]);
 assert(ctx.mediaReviewIssues('ladder',{...sample,date:'2026-02-30'}).date);
});
test('dragon units, direction and duplicate names flagged; same stock across seats allowed',()=>{
 const {ctx}=setup();const stock={name:'甲',amount:'1.09e',direction:'buy'};
 const data={date:'10-09',groups:[{name:'一',stocks:[stock]},{name:'二',stocks:[stock]}]};
 assert.equal(Object.keys(ctx.mediaReviewIssues('dragon',data)).length,0);
 data.groups[0].stocks.push({...stock,amount:'99',direction:'unknown'});
 const issues=ctx.mediaReviewIssues('dragon',data);assert(issues['groups.0.stocks.1.name']);assert(issues['groups.0.stocks.1.amount']);assert(issues['groups.0.stocks.1.direction']);
});
test('form edits synchronize JSON immediately without rerendering focused inputs',()=>{
 const {ctx,elements}=setup();ctx.renderMediaReview();const html=elements.mediaReview.innerHTML;
 ctx.editMediaReview('groups.0.stocks.1.time','10:30');
 ctx.editMediaReview('groups.0.stocks.1.broken','false','bool');
 ctx.editMediaReview('groups.0.stocks.1.sector','');
 const data=JSON.parse(elements.ladderJson.value);
 assert.equal(data.groups[0].stocks[1].time,'10:30');assert.equal(data.groups[0].stocks[1].broken,false);assert.equal(data.groups[0].stocks[1].sector,null);
 assert.equal(elements.mediaReview.innerHTML,html);assert.equal(elements.mediaWording.innerHTML,'');assert.equal(elements.ladderOutput.innerHTML,'');
 assert.deepEqual(data.groups[0].stocks[0],sample.groups[0].stocks[0]);
 ctx.editMediaReview('groups.0.stocks.1.broken','','bool');assert.equal(JSON.parse(elements.ladderJson.value).groups[0].stocks[1].broken,null);
});
test('raw JSON, add/remove records, issue filter and escaping work together',()=>{
 const {ctx,elements}=setup();ctx.mutateMediaReview('groups.0.stocks',0,false);
 assert.equal(JSON.parse(elements.ladderJson.value).groups[0].stocks.length,3);
 ctx.mutateMediaReview('groups.0.stocks',2,true);assert.equal(JSON.parse(elements.ladderJson.value).groups[0].stocks.length,2);
 ctx.editMediaReview('groups.0.stocks.1.name','<img src=x onerror=alert(1)>');
 vm.runInNewContext('mediaReviewOnlyIssues=true',ctx);ctx.renderMediaReview();
 assert.match(elements.mediaReview.innerHTML,/&lt;img/);assert.doesNotMatch(elements.mediaReview.innerHTML,/<img src=x/);
 assert.doesNotMatch(elements.mediaReview.innerHTML,/data-mr-path="groups.0.stocks.0.name"/);
 elements.ladderJson.value='{';ctx.rawMediaReviewChanged();assert.match(elements.mediaReview.innerHTML,/数据格式异常/);
 elements.ladderJson.value=JSON.stringify(sample);ctx.rawMediaReviewChanged();assert.match(elements.mediaReview.innerHTML,/涨停时间/);
});
