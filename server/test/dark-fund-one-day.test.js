const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPage() {
  const filename = require.resolve('../../miniprogram/pages/dark-funds-result/dark-funds-result');
  let page;
  const context = {
    Page: value => { page = value; },
    require: name => require(path.resolve(path.dirname(filename), name)),
    wx: { nextTick: callback => callback(), showModal: options => { context.modal = options; } },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context);
  page.setData = data => Object.assign(page.data, data);
  return { page, context };
}

function result(row) {
  return { stockCode: '600000', stockName: '测试股票', kind: 'close', days: [{ tradeDate: '2026-11-04', ...row }] };
}

test('1日复刻图：左侧明暗盘共用刻度，散户居右，金额与原图一致', () => {
  const { page } = loadPage();
  page.applyResult(result({ main: -84623000, listed: -74076000, grey: -10547000 }));
  assert.equal(page.data.unitLabel, '万元');
  assert.deepEqual(Array.from(page.data.summary, item => item.text), ['-8462.3', '8462.3']);
  const [listed, grey, retail] = page.data.dayBars;
  assert.deepEqual(Array.from(page.data.dayBars, item => item.text), ['-7407.6', '-1054.7', '8462.3']);
  assert.deepEqual(Array.from(page.data.dayBars, item => item.center), [15.25, 34.75, 75]);
  assert.equal(listed.height, 26.4);
  assert.equal(retail.height, 26.4);
  assert.ok(Math.abs(grey.height / listed.height - 1054.7 / 7407.6) < 1e-10);
  assert.equal(listed.positive, false);
  assert.equal(grey.positive, false);
  assert.equal(retail.positive, true);
});

test('正负反转、相互抵消和全零均不制造非零柱', () => {
  const { page } = loadPage();
  for (const [listed, grey] of [[74076000, 10547000], [40000000, -20000000], [-40000000, 40000000], [0, 0]]) {
    page.applyResult(result({ listed, grey, main: listed + grey }));
    assert.deepEqual(Array.from(page.data.dayBars, item => item.value), [listed, grey, -(listed + grey)]);
    for (const bar of page.data.dayBars) {
      assert.equal(bar.positive, bar.value >= 0);
      assert.ok(Number.isFinite(bar.height) && bar.height >= 0 && bar.height <= 26.4);
      if (bar.value === 0) assert.equal(bar.height, 0);
      assert.ok(bar.labelOffset < 80);
    }
  }
});

test('亿元自动换算仍一致，数值本身不重复添加单位', () => {
  const { page } = loadPage();
  page.applyResult(result({ main: 330000000, listed: 210000000, grey: 120000000 }));
  assert.equal(page.data.unitLabel, '亿元');
  assert.deepEqual(Array.from(page.data.summary, item => item.text), ['3.30', '-3.30']);
  assert.deepEqual(Array.from(page.data.dayBars, item => item.text), ['2.10', '1.20', '-3.30']);
});

test('3日和5日趋势数据、指标和绘图入口保持原样', () => {
  const { page } = loadPage();
  const days = Array.from({ length: 7 }, (_, i) => ({ tradeDate: `2026-10-${24 + i}`, main: (i + 1) * 20000, listed: (i + 1) * 10000, grey: (i + 1) * 10000 }));
  page.applyResult({ ...result({}), days });
  const bars = JSON.stringify(page.data.dayBars);
  page.setData = (data, callback) => { Object.assign(page.data, data); if (callback) callback(); };
  const drawn = [];
  page.drawTrend = series => drawn.push(series);
  for (const [view, expected] of [['trend3', '18.0万'], ['trend5', '25.0万']]) {
    page.switchFundView({ currentTarget: { dataset: { view } } });
    assert.equal(page.data.trendMetricText, expected);
    assert.equal(page.data.trendHasData, true);
    assert.equal(drawn.at(-1), page.trends[view]);
  }
  page.switchFundView({ currentTarget: { dataset: { view: 'main' } } });
  assert.equal(JSON.stringify(page.data.dayBars), bars);
  assert.equal(drawn.length, 2);
});

test('历史日弹窗不套用新的一日分区比例', () => {
  const { page } = loadPage();
  page.applyResult(result({ main: -84623000, listed: -74076000, grey: -10547000 }));
  const bars = page.data.historySelected.flowBars;
  assert.equal(bars[2].height, 120);
  assert.ok(bars.every(bar => !Object.hasOwn(bar, 'center')));
  assert.equal(bars[0].text, '-7407.6');
});

test('说明解释左右分区刻度；新样式只挂在一日分支', () => {
  const { page, context } = loadPage();
  page.showDayFlowInfo();
  assert.match(context.modal.content, /左侧两柱共用刻度/);
  assert.equal(context.modal.showCancel, false);
  const markup = fs.readFileSync(require.resolve('../../miniprogram/pages/dark-funds-result/dark-funds-result.wxml'), 'utf8');
  assert.match(markup, /wx:if="\{\{fundView === 'main'\}\}" class="one-day-flow"/);
  assert.match(markup, /<block wx:else>\s*<view class="trend-summary">/);
  assert.match(markup, /one-day-zero main/);
  assert.match(markup, /one-day-zero retail/);
});
