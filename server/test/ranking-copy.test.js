const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../public/admin/index.html'), 'utf8');
const context = {};
vm.runInNewContext(html.match(/function buildRankingCopy\(ranking\) \{[\s\S]*?\n\}/)[0], context);
test('ranking copy uses stored date, full names, absolute outflow and compact units', () => {
  const copy = context.buildRankingCopy({ tradeDate: '2026-10-08',
    inflow: [{ stockName: '先导智能', grey: 685000000 }, { stockName: '圣阳股份', grey: 550000000 }],
    outflow: [{ stockName: '京东方A', grey: -1598000000 }, { stockName: '测试股份', grey: -5670000 }] });
  assert.equal(copy, '10月8日同花顺热股暗盘流入前二名，第一名先导智能暗盘流入6.85e，第二名圣阳股份暗盘流入5.5e；\n\n10月8日同花顺热股暗盘流出前二名，第一名京东方A暗盘流出15.98e，第二名测试股份暗盘流出567万');
});
test('ranking copy never invents missing positions and caps at ten', () => {
  assert.throws(() => context.buildRankingCopy(null), /请先生成/);
  const copy = context.buildRankingCopy({ tradeDate: '2026-10-08', inflow: Array.from({ length: 12 }, () => ({ stockName: '股票', grey: 100000000 })), outflow: [] });
  assert.match(copy, /流入前十名/);
  assert.equal((copy.match(/暗盘流入1e/g) || []).length, 10);
  assert.match(copy, /流出榜：暂无有效数据/);
});
test('admin inline scripts parse', () => {
  for (const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new Function(script[1]);
});
