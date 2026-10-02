const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('PC SaaS entry is served and uses the shared business APIs', () => {
  const server = fs.readFileSync(path.join(root, 'src', 'index.js'), 'utf8');
  const payment = fs.readFileSync(path.join(root, 'src', 'routes', 'payment.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public', 'saas', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public', 'saas', 'app.js'), 'utf8');

  assert.match(server, /pathname === '\/saas'/);
  assert.match(html, /数据工作台/);
  assert.match(app, /\/api\/web\/login/);
  assert.match(app, /mode==='decision'\?'intraday':'close'/);
  assert.match(payment, /\/api\/dark-funds\/orders\/close/);
  assert.match(payment, /\/api\/dark-funds\/orders\/intraday/);
  assert.match(app, /\/api\/gold-finger\/latest/);
  assert.match(app, /nl_web_token/);
});
