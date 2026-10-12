const test = require('node:test');
const assert = require('node:assert/strict');
const { rollingHistory, snapshotLabel } = require('../../miniprogram/utils/dark-fund-history');
const { normalizeCloseDarkFund, SAMPLE_CLOSE_PAYLOAD } = require('../src/dark-fund-close');
const { historyChart } = require('../../miniprogram/utils/dark-fund-history');
test('30日柱状图金额与GS互不推断，缺失信号不产生切换', () => {
  const days = ['G','S',null,'G',4].map((gs,i)=>({tradeDate:`2026-09-${14+i}`,main:-240000000,grey:0,listed:-240000000,gs}));
  const chart = historyChart({days});
  assert.equal(chart[0].mainText,'-2.40亿');
  assert.equal(chart[0].height,100);
  assert.equal(chart[1].gsChanged,true);
  assert.equal(chart[3].gsChanged,false);
  assert.equal(chart[4].gsText,'—');
  assert.equal(historyChart({days:[]}).length,0);
});
test('服务端原样保留GS字符串和未知编码', () => {
  for (const gs of ['G','S',2,4]) {
    const result=normalizeCloseDarkFund({...SAMPLE_CLOSE_PAYLOAD,days:[{...SAMPLE_CLOSE_PAYLOAD.days[0],gs}]});
    assert.equal(result.historyDays[0].gs,gs);
  }
});
test('历史用于窗口预热，展示七点而非从零开始', () => {
  const historyDays = Array.from({length:30}, (_,i)=>({tradeDate:`2026-09-${String(i+1).padStart(2,'0')}`,grey:i+1}));
  const result = { historyDays, days: historyDays.slice(-7) };
  for (const size of [3,5]) {
    const points = rollingHistory(result,size);
    assert.equal(points.length,7);
    assert.equal(points[0].value, historyDays.slice(24-size,24).reduce((s,r)=>s+r.grey,0));
    assert.ok(points.every(p=>p.value!==null));
  }
  assert.equal(rollingHistory({days:historyDays.slice(-7)},7)[0].value,null);
});
test('快照版本分钟不混淆更新时间', () => {
  assert.equal(snapshotLabel({kind:'intraday',versionKey:'2026-10-12T1130',updatedAt:'2026-10-12T11:51:41+08:00'}),'盘中 11:30');
  assert.equal(snapshotLabel({kind:'intraday',versionKey:'2026-10-12T11:30:59'}),'盘中 11:30');
  assert.equal(snapshotLabel({kind:'intraday'}),'盘中（快照时间未知）');
  assert.equal(snapshotLabel({kind:'close'}),'收盘');
});
test('新增历史不改变旧版七日字段和快照类型', () => {
  const days = [...SAMPLE_CLOSE_PAYLOAD.days, {...SAMPLE_CLOSE_PAYLOAD.days[0],trade_date:'2026-09-18'}];
  const result = normalizeCloseDarkFund({...SAMPLE_CLOSE_PAYLOAD,days});
  assert.equal(result.days.length,7);
  assert.equal(result.historyDays.length,8);
  assert.equal(result.type,'close_snapshot');
  assert.deepEqual(result.days,result.historyDays.slice(-7));
});
