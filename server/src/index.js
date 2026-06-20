// server/src/index.js  —— 零依赖（仅用 Node 内置模块）
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const db = require('./db');
const { createRouter, HttpError } = require('./router');

db.load();

const router = createRouter();
require('./routes/public')(router);
require('./routes/app')(router, HttpError);
require('./routes/admin')(router, HttpError);

const STATIC_DIR = path.join(__dirname, '../public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function serveStatic(res, pathname) {
  let rel = pathname.replace(/^\/admin/, '') || '/';
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(STATIC_DIR, 'admin', rel);
  if (!file.startsWith(path.join(STATIC_DIR, 'admin'))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // 首页跳转到后台
  if (pathname === '/') { res.writeHead(302, { Location: '/admin' }); return res.end(); }
  // 静态后台
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return serveStatic(res, pathname);

  // API 路由
  const m = router.match(req.method, pathname);
  if (!m) return sendJson(res, 404, { error: 'not found' });

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let parsedBody = {};
    if (body) { try { parsedBody = JSON.parse(body); } catch (e) { parsedBody = {}; } }
    const ctx = { params: m.params, query: parsed.query, body: parsedBody, headers: req.headers };
    Promise.resolve()
      .then(() => m.handler(ctx))
      .then((result) => sendJson(res, 200, result === undefined ? { ok: true } : result))
      .catch((err) => sendJson(res, err.status || 500, { error: err.message || 'server error' }));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`API & 管理后台运行中： http://localhost:${PORT}/admin`));
