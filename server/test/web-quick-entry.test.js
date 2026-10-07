const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const webRoot = path.join(__dirname, '..', 'public', 'web');

test('Web middle tab matches the mini-program quick entry behavior', () => {
  const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(webRoot, 'app.js'), 'utf8');
  const style = fs.readFileSync(path.join(webRoot, 'style.css'), 'utf8');

  assert.match(html, /data-action="quick-entry"/);
  assert.match(html, /class="plus-btn">＋/);
  assert.doesNotMatch(html, /data-route="gold" class="finger-tab"/);
  assert.match(app, /查看暗盘/);
  assert.match(app, /查看金手指/);
  assert.match(app, /if\(route==='dark'\)return navigate\('dark'\)/);
  assert.match(app, /featuredNoteId/);
  assert.match(app, /return openNote\(noteId\)/);
  assert.match(style, /\.finger-tab \.plus-btn/);
  assert.match(style, /\.quick-entry-sheet/);
});

test('Web ranking only exposes the one-day snapshot and cannot bypass paid queries', () => {
  const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  const darkFunds = fs.readFileSync(path.join(webRoot, 'dark-funds.js'), 'utf8');
  const payment = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'payment.js'), 'utf8');

  assert.match(html, /dark-funds\.js\?v=2026100702/);
  assert.doesNotMatch(darkFunds, /查看完整7日数据/);
  assert.doesNotMatch(darkFunds, /data-wdf-ranking-result/);
  assert.doesNotMatch(darkFunds, /dark-ranking\//);
  assert.doesNotMatch(payment, /\/api\/dark-funds\/ranking\/:stockCode/);
});

test('Web enterprise-WeChat entry offers a free dark-fund query without the legacy repurchase block', () => {
  const html = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  const features = fs.readFileSync(path.join(webRoot, 'features.js'), 'utf8');

  assert.match(html, /features\.js\?v=2026100705/);
  assert.match(features, /加企微免费查暗盘/);
  assert.match(features, /添加企业微信，免费查询暗盘/);
  assert.doesNotMatch(features, /咨询人工/);
  assert.doesNotMatch(features, /老客扫码复购/);
  assert.doesNotMatch(features, /wechat-payment-code/);
});

test('Mini-program uses the same enterprise-WeChat copy and removes the legacy repurchase block', () => {
  const miniRoot = path.join(__dirname, '..', '..', 'miniprogram', 'pages', 'profile');
  const wxml = fs.readFileSync(path.join(miniRoot, 'profile.wxml'), 'utf8');
  const script = fs.readFileSync(path.join(miniRoot, 'profile.js'), 'utf8');
  const combined = `${wxml}\n${script}`;

  assert.match(combined, /加企微免费查暗盘/);
  assert.match(combined, /添加企业微信，免费查询暗盘/);
  assert.doesNotMatch(combined, /咨询人工/);
  assert.doesNotMatch(combined, /老客扫码复购/);
  assert.doesNotMatch(combined, /openWechatPayment/);
});
