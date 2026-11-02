const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseItems, parseAnchors, applyItems, playback, dueSlot } = require('../src/live-table-sync');
const {available}=require('../src/live-course');
const { pubNote } = require('../src/util');
const item = { room_id:256949, title:'课程标题', link:'https://live.myhexin.com/player/?a=live&i=256949',start_time:'2026-11-02 08:50',has_replay:1,is_future:0 };
const data = () => ({ users:[{id:'u',name:'THS复盘课',official:true}],notes:[] });
test('every day Beijing 08:30 to 21:00 has exactly 26 half-hour slots', () => {
  const time=s=>Date.parse('2026-11-07T'+s+'+08:00'); // Saturday also runs.
  assert.equal(dueSlot(time('08:29:59')),null);
  assert.equal(dueSlot(time('21:01:00')),null);
  const slots=new Set();
  for(let m=510;m<=1260;m+=30){const h=String(Math.floor(m/60)).padStart(2,'0'),min=String(m%60).padStart(2,'0');slots.add(dueSlot(time(h+':'+min+':00')));}
  assert.equal(slots.size,26);
  assert.equal(dueSlot(time('08:44:00')),'2026-11-07 08:30');
  assert.equal(dueSlot(time('21:00:00')),'2026-11-07 21:00');
});
test('live source supports wrapped/array response and rejects wrong destinations', () => {
  assert.deepEqual(parseItems([item]),parseItems({items:[item]}));
  for(const link of ['http://live.myhexin.com/player/?i=256949','https://evil.test/?i=256949','https://live.myhexin.com/player/?i=9']) assert.throws(()=>parseItems([{...item,link}]));
  assert.throws(()=>parseItems([item,item]));
});
test('idempotent sync preserves admin free/visibility and respects deletion', () => {
  const d=data();const rows=parseItems([item]);
  assert.equal(applyItems(d,rows).created,1);const note=d.notes[0];
  assert.equal(note.content,'点击下方按钮播放视频');assert.equal(note.free,true);
  note.free=false;note.visible=false;applyItems(d,rows);
  assert.equal(d.notes.length,1);assert.equal(note.free,false);assert.equal(note.visible,false);
  assert.equal(playback(d,note),item.link);
  const safe=pubNote(note);assert.equal(safe.hasResource,true);
  assert(!JSON.stringify(safe).includes('256949'));assert(!JSON.stringify(safe).includes('myhexin'));
  d.notes=[];assert.equal(applyItems(d,rows).created,0);
});
test('empty title uses start date and anchors; later title replaces same note', () => {
  const d=data();
  const rows=parseItems([{...item,title:'',anchors:['张庆国']}]);
  assert.equal(rows[0].title,'11月2日张庆国课程');
  applyItems(d,rows);const id=d.notes[0].id;
  assert.equal(parseItems([{...item,title:'',anchors:['杨光松','张群']}])[0].title,'11月2日杨光松、张群课程');
  applyItems(d,parseItems([item]));
  assert.equal(d.notes.length,1);assert.equal(d.notes[0].id,id);assert.equal(d.notes[0].title,item.title);
});
test('mini-program live course free branch skips ads; nonfree uses rewarded branch', () => {
  let page;vm.runInNewContext(fs.readFileSync(require.resolve('../../miniprogram/pages/detail/detail.js'),'utf8'),{
    require:p=>p.endsWith('/store')?{isLogin:()=>true}:p.endsWith('/util')?{}:{}, Page:p=>page=p
  });
  for(const free of [false,true]) {
    let skip;page.onGetResource.call({data:{note:{type:'course',resourceKind:'live-course',free}},handleGetResource:v=>skip=v});
    assert.equal(skip,free);
  }
});
test('playback resource requires login and does not impose ordinary paid course membership', async () => {
  const d=data(); applyItems(d,parseItems([item])); let handler;
  const realRequire=require('node:module').createRequire(require.resolve('../src/routes/public'));
  let mod={exports:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/routes/public'),'utf8'),{
    module:mod,require:p=>p==='../db'?{get:()=>d}:p==='../auth'?{userIdFor:token=>token?'u':null}:realRequire(p)
  });
  mod.exports({get:(path,fn)=>{if(path==='/api/notes/:id/resource')handler=fn;}},class extends Error{constructor(status,msg){super(msg);this.status=status;}});
  const ctx={headers:{},params:{id:d.notes[0].id}};
  assert.throws(()=>handler(ctx),e=>e.status===401);
  ctx.headers.authorization='test';
  assert.deepEqual(JSON.parse(JSON.stringify(handler(ctx))),{kind:'live-course',url:item.link});
  const room=Object.values(d.liveTableRooms)[0];room.link='';
  assert.equal(handler(ctx).message,'直播未开始');
});
test('synced poster, author, chronological order and first-upgrade defaults repair old notes',()=>{
  const d=data(), rows=parseItems([item]);rows[0].cover='https://example.test/uploads/test.png';rows[0].coverRatio=.75;
  applyItems(d,rows);const n=d.notes[0];
  assert.equal(n.author.name,'THS复盘课');assert.equal(n.cover,rows[0].cover);assert.equal(n.images[0],n.cover);
  assert.equal(n.time,Date.parse('2026-11-02T08:50:00+08:00'));assert.equal(n.type,'live');
  n.liveDefaultsV2=false;n.free=false;n.baiduUrl='wrong';applyItems(d,rows);
  assert.equal(n.free,true);assert.equal(n.baiduUrl,'');
  assert.equal(available({...n,liveDate:'2026-11-03'},Date.parse('2026-11-02T23:59:59+08:00')),false);
  assert.equal(available({...n,liveDate:'2026-11-03'},Date.parse('2026-11-03T00:00:00+08:00')),true);
  assert.deepEqual(parseAnchors('<span data-anchor="张庆国"></span><span data-anchor="杨光松"></span>'),['张庆国','杨光松']);
});
test('live feed excludes tomorrow, filters teachers/today and sorts by course time',()=>{
  const d=data(), date=new Date(Date.now()+28800000).toISOString().slice(0,10);
  const future=new Date(Date.now()+28800000+86400000).toISOString().slice(0,10);
  applyItems(d,parseItems([
    {...item,start_time:date+' 09:00',anchors:['张庆国']},
    {...item,room_id:2,link:'',start_time:date+' 19:00',anchors:['杨光松']},
    {...item,room_id:3,link:'',start_time:future+' 09:00',anchors:['张庆国']}
  ]));
  const realRequire=require('node:module').createRequire(require.resolve('../src/routes/public'));
  const mod={exports:{}},routes=new Map();d.settings={};d.liveTableAnchors=['张庆国','杨光松','胡中浩'];
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/routes/public'),'utf8'),{module:mod,require:p=>p==='../db'?{get:()=>d}:p==='../auth'?{userIdFor:()=>null}:realRequire(p)});
  mod.exports({get:(p,fn)=>routes.set(p,fn)},Error);
  const call=filter=>routes.get('/api/feed')({query:{tab:'live',filter},headers:{}});
  assert.equal(call('all').total,2);assert.equal(call('today').total,2);assert.equal(call('张庆国').total,1);
  assert.equal(call('all').list[0].liveStartTime,date+' 19:00');
  assert.equal(call('all').filters.find(f=>f.key==='胡中浩').count,0);
  assert.throws(()=>routes.get('/api/notes/:id')({params:{id:d.notes.find(n=>n.liveDate===future).id},headers:{}}));
});
