const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('both posters render ten rows and one expanded chart without leaking codes', () => {
  for (const side of ['inflow', 'outflow']) {
    const texts = [];
    const ctx = { save() {}, restore() {}, translate() {}, rotate() {}, fillText: (t) => texts.push(t), fillRect() {}, beginPath() {}, roundRect() {}, fill() {}, stroke() {}, measureText: (t) => ({ width: t.length * 30 }) };
    const canvas = { getContext: () => ctx };
    const context = { document: { createElement: () => canvas } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin/vendor/pinyin-pro.js'),'utf8'),context);
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin/ranking-poster.js'),'utf8'),context);
    const ranking = { tradeDate: '2026-10-08', [side]: Array.from({length:10},(_,i)=>({stockName:i===0?'长鑫科技':`测试${i}科技`,stockCode:'600001',grey:-685000000,listed:50000000,main:-635000000,retail:635000000,changePercent:null})) };
    const before=JSON.stringify(ranking);
    const result = context.drawRankingPoster(ranking,side);
    assert.equal(result.width,1080);
    assert.equal(texts.filter(t=>t.startsWith('主力流向')).length,1);
    assert.equal(texts.filter(t=>/^(长鑫|测试\d)KJ$/.test(t)).length,10);
    assert(!texts.includes('长鑫科技'));assert.equal(JSON.stringify(ranking),before);
    assert(texts.includes('-6.85亿'));
    assert(texts.includes('+0.50亿'));
    assert(texts.includes('—'));
    assert(!texts.includes('600001'));
    assert(!texts.includes('数据来源【指标仓库】小程序'));
    assert(texts.filter(t=>t==='小程序指标仓库').length>3);
    assert.throws(()=>context.drawRankingPoster(null,side),/请先生成/);
  }
});
test('only the last two name positions become uppercase initials; ASCII suffixes stay intact',()=>{
  const context={};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin/vendor/pinyin-pro.js'),'utf8'),context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin/ranking-poster.js'),'utf8'),context);
  for(const [name,expected] of [['长鑫科技','长鑫KJ'],['工商银行','工商YH'],['重庆银行','重庆YH'],['圣阳股份','圣阳GF'],['中芯国际','中芯GJ'],['京东方A','京东FA'],['*ST联光','*STLG'],['会稽山','会JS'],['A1','A1'],['','未知股票']])assert.equal(context.rankingPosterStockName(name),expected);
  const index=fs.readFileSync(path.join(__dirname,'../public/admin/index.html'),'utf8');
  assert(index.indexOf('/admin/vendor/pinyin-pro.js')<index.indexOf('/admin/ranking-poster.js'));
});
