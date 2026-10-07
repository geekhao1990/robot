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
