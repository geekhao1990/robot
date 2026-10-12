const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('one batch produces two originals and two independent three-line covers',()=>{
  const canvases=[];
  const context={document:{createElement(){
    const texts=[],draws=[];
    const ctx={save(){},restore(){},translate(){},rotate(){},fillText:t=>texts.push(t),strokeText(){},drawImage:source=>draws.push(source),fillRect(){},beginPath(){},roundRect(){},fill(){},stroke(){},measureText:t=>({width:t.length*120})};
    const canvas={texts,draws,getContext:()=>ctx};canvases.push(canvas);return canvas;
  }}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin/vendor/pinyin-pro.js'),'utf8'),context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/admin/ranking-poster.js'),'utf8'),context);
  const rows=Array.from({length:10},()=>({stockName:'长鑫科技',grey:100000,listed:200000,main:300000,retail:-300000}));
  const ranking={tradeDate:'2026-09-30',inflow:rows,outflow:rows};const before=JSON.stringify(ranking);
  const posters=context.buildRankingPosters(ranking);
  assert.equal(posters.length,4);assert.equal(new Set(posters.map(p=>p.canvas)).size,4);
  for(let i=0;i<2;i++){
    const cover=posters[i+2].canvas,original=posters[i].canvas;
    assert.equal(cover.draws[0],original);
    assert.deepEqual(cover.texts,['9月30日','同花顺热榜暗盘',i?'流出前十名':'流入前十名']);
    assert.equal(cover.width,original.width);assert.equal(cover.height,original.height);
    assert.equal(original.texts.filter(t=>t.startsWith('主力流向')).length,1);
  }
  assert.equal(JSON.stringify(ranking),before);
  const ui=fs.readFileSync(path.join(__dirname,'../public/admin/ladder.js'),'utf8');
  assert.match(ui,/generateRankingPosters\(this\)/);assert.doesNotMatch(ui,/generateRankingPoster\('/);
});
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
    assert(texts.filter(t=>t==='指标仓库').length>3);
    assert(!texts.includes('小程序指标仓库'));
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
