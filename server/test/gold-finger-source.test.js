const test = require('node:test');
const assert = require('node:assert/strict');
const { chartRecords } = require('../src/gold-finger-source');
const { applySourceRecords, fetchSourceData } = require('../src/gold-finger-sync');
const a = Date.parse('2026-10-30T00:00:00+08:00'), b = Date.parse('2026-11-02T00:00:00+08:00');
function fixture() {
  return { date: '2026-11-02', gold: {
    market: [[b, 3614.31], [a, 3605.65]], goldPoint: [[a, 87.33], [b, -76.52]],
    position: [[b, 30], [a, 70]], gold: [b], silver: [a],
    trendweek: [{ from: a, to: b, color: 'rgba(221, 70, 60, 0.18)' }, { from: b, to: b, color: 'rgba(4,194,4,0.18)' }]
  } };
}
test('chart timestamps join independently; signals follow goldPoint, not event arrays', () => {
  const rows = chartRecords(fixture());
  assert.deepEqual(rows[1], { date:'2026-11-02',yang:23,yin:77,finger:'silver',position:30,trend:'down' });
  assert.equal(rows[0].yang,87); assert.equal(rows[0].finger,'gold'); assert.equal(rows[0].trend,'up');
  const db = {}; applySourceRecords(db,rows,123);
  assert.equal(db.goldFingerRecords[1].yin,77);
});
test('zero and boundary values match dashboard conversion', () => {
  for (const [value,yang,finger] of [[0,100,'silver'],[-100,0,'silver'],[100,100,'gold'],[-76.36,24,'silver']]) {
    const p=fixture();p.gold.goldPoint[1][1]=value;
    const r=chartRecords(p)[1];assert.equal(r.yang,yang);assert.equal(r.finger,finger);
  }
});
test('invalid or missing data never becomes fabricated zero or trend', () => {
  for (const mutate of [
    p=>p.gold.position.pop(),p=>p.gold.goldPoint.pop(),p=>p.gold.goldPoint.push(p.gold.goldPoint[0]),
    p=>p.gold.goldPoint[1][1]=null,p=>p.gold.goldPoint[1][1]=101,p=>p.gold.position[0][1]=-1,
    p=>p.gold.trendweek=[],p=>p.gold.trendweek[1].color='blue',p=>p.date='2026-11-03'
  ]) { const p=fixture();mutate(p);assert.throws(()=>chartRecords(p)); }
});
test('authenticated fetch adapts chart response without writing database', async () => {
  const old=global.fetch;let calls=0;
  try {
    global.fetch=async(url,opts)=>{
      if(++calls===1)return new Response(null,{status:302,headers:{'set-cookie':'session=test'}});
      assert.equal(url,'http://example.test/api/gold/data');assert.equal(opts.headers.Cookie,'session=test');
      return new Response(JSON.stringify(fixture()));
    };
    const rows=await fetchSourceData({baseUrl:'http://example.test',username:'test',password:'test'});
    assert.equal(rows.at(-1).yang,23);
  } finally { global.fetch=old; }
});
