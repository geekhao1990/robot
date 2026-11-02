const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseItems, applyItems, playback, dueSlot } = require('../src/live-table-sync');
const { pubNote } = require('../src/util');
const item = { room_id:256949, title:'课程标题', link:'https://live.myhexin.com/player/?a=live&i=256949',start_time:'2026-11-02 08:50',has_replay:1,is_future:0 };
const data = () => ({ users:[{id:'u',name:'官方',official:true}],notes:[] });
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
test('idempotent sync preserves admin free/visibility, skips empty titles and respects deletion', () => {
  const d=data();const rows=parseItems([item,{...item,room_id:1,link:'https://live.myhexin.com/player/?i=1',title:''}]);
  assert.equal(applyItems(d,rows).created,1);const note=d.notes[0];
  assert.equal(note.content,'点击下方按钮播放视频');assert.equal(note.free,false);
  note.free=true;note.visible=false;applyItems(d,rows);
  assert.equal(d.notes.length,1);assert.equal(note.free,true);assert.equal(note.visible,false);
  assert.equal(playback(d,note),item.link);
  const safe=pubNote(note);assert.equal(safe.hasResource,true);
  assert(!JSON.stringify(safe).includes('256949'));assert(!JSON.stringify(safe).includes('myhexin'));
  d.notes=[];assert.equal(applyItems(d,rows).created,0);
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
});
