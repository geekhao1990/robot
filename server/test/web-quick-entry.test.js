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
