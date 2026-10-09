const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('both posters render ten rows and one expanded chart without leaking codes', () => {
  for (const side of ['inflow', 'outflow']) {
    const texts = [];
    const ctx = { fillText: (t) => texts.push(t), fillRect() {}, measureText: (t) => ({ width: t.length * 30 }) };
    const canvas = { getContext: () => ctx };
    const context = { document: { createElement: () => canvas } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin/ranking-poster.js'),'utf8'),context);
    const ranking = { tradeDate: '2026-10-08', [side]: Array.from({length:10},(_,i)=>({stockName:`测试股票${i}`,stockCode:'600001',grey:-685000000,listed:50000000,main:-635000000,retail:635000000,changePercent:null})) };
    const result = context.drawRankingPoster(ranking,side);
    assert.equal(result.width,1080);
    assert.equal(texts.filter(t=>t.startsWith('主力流向')).length,1);
    assert.equal(texts.filter(t=>t.startsWith('测试股票')).length,10);
    assert(texts.includes('-6.85亿'));
    assert(texts.includes('+0.50亿'));
    assert(texts.includes('—'));
    assert(!texts.includes('600001'));
    assert.throws(()=>context.drawRankingPoster(null,side),/请先生成/);
  }
});
