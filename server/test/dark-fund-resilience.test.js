const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { normalizeCloseDarkFund, SAMPLE_CLOSE_PAYLOAD } = require('../src/dark-fund-close');
const { posterMetrics } = require('../../miniprogram/utils/dark-fund-poster');
const { darkFundError } = require('../../miniprogram/utils/dark-fund-error');

test('1至7日均可生成结果页与分享图；不足周期不伪造累计值', () => {
  let page;
  const filename = require.resolve('../../miniprogram/pages/dark-funds-result/dark-funds-result');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page: value => { page = value; }, require: name => require(path.resolve(path.dirname(filename), name)),
  });
  for (let count = 1; count <= 7; count++) {
    const result = normalizeCloseDarkFund({ ...SAMPLE_CLOSE_PAYLOAD, days: SAMPLE_CLOSE_PAYLOAD.days.slice(0, count) });
    page.setData = data => { page.data = { ...page.data, ...data }; };
    page.applyResult(result);
    assert.equal(page.data.rows.length, count);
    assert.equal(page.data.dayBars.length, 3);
    assert.equal(page.data.loading, false);
    page.openHistoryDay({currentTarget:{dataset:{index:0}}});
    assert.equal(page.data.historyModal,true);
    assert.equal(page.data.historySelected.index,0);
    page.stepHistoryDay({currentTarget:{dataset:{step:-1}}});
    assert.equal(page.data.historySelected.index,0);
    if(count>1) {
      page.stepHistoryDay({currentTarget:{dataset:{step:1}}});
      assert.equal(page.data.historySelected.index,1);
    }
    page.closeHistoryDay();
    assert.equal(page.data.historyModal,false);
    assert.equal(page.trends.trend3.filter(item => item.value !== null).length, Math.max(0, count - 2));
    const metrics = posterMetrics(result);
    assert.equal(metrics.day3 === null, count < 3);
    assert.equal(metrics.day5 === null, count < 5);
    if (count < 3) assert.equal(metrics.day3Text, '数据不足');
    if (count < 5) assert.equal(metrics.day5Text, '数据不足');
  }
  const historyDays = Array.from({length:30},(_,i)=>({...page.data.result.days[0],tradeDate:`2026-09-${String(i+1).padStart(2,'0')}`}));
  page.applyResult({...page.data.result,historyDays,days:historyDays.slice(-7)});
  assert.equal(page.data.detailPages,5);
  for(let i=0;i<4;i++)page.changeDetailPage({currentTarget:{dataset:{step:1}}});
  assert.equal(page.data.rows.length,2);
  assert.equal(page.data.rows[1].tradeDate,'2026-09-01');
  page.changeDetailPage({currentTarget:{dataset:{step:1}}});
  assert.equal(page.data.detailPage,5);
  page._historyWidth=300;
  page.onHistoryScroll({detail:{scrollLeft:0}});
  assert.equal(page.data.historyEarlierVisible,false);
  assert.equal(page.data.historyTodayVisible,true);
  page.onHistoryScroll({detail:{scrollLeft:780}});
  assert.equal(page.data.historyEarlierVisible,true);
  assert.equal(page.data.historyTodayVisible,false);
  page.onHistoryScroll({detail:{scrollLeft:300}});
  assert.equal(page.data.historyEarlierVisible,true);
  assert.equal(page.data.historyTodayVisible,true);
});

test('服务端具体错误优先于 request:ok；网络超时和空错误可辨识', () => {
  assert.equal(darkFundError({ errMsg: 'request:ok', data: { error: '上游账号登录失败' } }), '上游账号登录失败');
  assert.equal(darkFundError({ message: '股票未找到' }), '股票未找到');
  assert.match(darkFundError({ errMsg: 'request:fail timeout' }), /请求超时/);
  assert.match(darkFundError({ statusCode: 502 }), /HTTP 502/);
});

test('Web分享图不足周期与小程序一致', () => {
  const context = { state: {}, document: { addEventListener() {} } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../public/web/dark-funds.js'), 'utf8'), context);
  const result = normalizeCloseDarkFund({ ...SAMPLE_CLOSE_PAYLOAD, days: SAMPLE_CLOSE_PAYLOAD.days.slice(0, 1) });
  const metrics = context.wdfPosterMetrics(result);
  assert.equal(metrics.day3, null);
  assert.equal(metrics.day5Text, '数据不足');
});
