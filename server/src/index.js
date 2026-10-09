// server/src/index.js  —— 零依赖（仅用 Node 内置模块）
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const db = require('./db');
const { createRouter, HttpError } = require('./router');
const { handleUpload } = require('./upload');
const audit = require('./audit');
const goldFingerSync = require('./gold-finger-sync');
const darkFundRankingSync = require('./dark-fund-ranking-sync');
const webWechatLogin = require('./web-wechat-login');
const { reviewModeApplies } = require('./util');

const router = createRouter();
require('./routes/public')(router, HttpError);
require('./routes/ladder')(router, HttpError);
require('./routes/app')(router, HttpError);
require('./routes/message')(router, HttpError);
require('./routes/payment')(router, HttpError);
require('./routes/dark-fund-payment')(router, HttpError);
require('./routes/stocks')(router, HttpError);
require('./routes/saas-auth')(router, HttpError);
require('./routes/admin')(router, HttpError);
require('./routes/gift-cards')(router, HttpError);

const STATIC_DIR = path.join(__dirname, '../public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// 安全地从 STATIC_DIR/<sub> 下读取文件
function serveFile(res, sub, rel) {
  if (rel === '/' || rel === '') rel = '/index.html';
  const baseDir = path.join(STATIC_DIR, sub);
  const file = path.join(baseDir, rel);
  if (!file.startsWith(baseDir)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const hostname = String(req.headers.host || '').split(':')[0].toLowerCase();

  if (pathname === '/api/web/wechat/start' && req.method === 'GET') {
    try {
      res.writeHead(302, { Location: webWechatLogin.loginUrl() });
      return res.end();
    } catch (error) {
      return sendJson(res, error.status || 500, { error: error.message || '微信登录启动失败' });
    }
  }
  if (pathname === '/api/web/wechat/callback' && req.method === 'GET') {
    return webWechatLogin.complete(parsed.query)
      .then((token) => {
        res.writeHead(302, { Location: `/web?wechat_token=${encodeURIComponent(token)}` });
        res.end();
      })
      .catch((error) => sendJson(res, error.status || 500, { error: error.message || '微信登录失败' }));
  }
  // Web 前台；管理后台继续使用 /admin。
  if (pathname === '/' && hostname === 'm.nankaitechschool.com') return serveFile(res, 'saas', '/index.html');
  if (pathname === '/') { res.writeHead(302, { Location: '/web' }); return res.end(); }
  if (pathname === '/saas' || pathname.startsWith('/saas/')) return serveFile(res, 'saas', pathname.replace(/^\/saas/, ''));
  if (pathname === '/web' || pathname.startsWith('/web/')) return serveFile(res, 'web', pathname.replace(/^\/web/, ''));
  // 静态后台
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return serveFile(res, 'admin', pathname.replace(/^\/admin/, ''));
  // 上传的图片
  if (pathname.startsWith('/uploads/')) return serveFile(res, 'uploads', pathname.replace(/^\/uploads/, ''));
  // 管理后台与小程序公用图片
  if (pathname.startsWith('/assets/')) return serveFile(res, 'assets', pathname.replace(/^\/assets/, ''));
  // 图片上传（multipart，需单独读取原始字节）
  if (pathname === '/api/upload' && req.method === 'POST') return handleUpload(req, res, sendJson);

  // API 路由
  const m = router.match(req.method, pathname);
  if (!m) return sendJson(res, 404, { error: 'not found' });

  const chunks = [];
  let ladderBytes = 0;
  let ladderTooLarge = false;
  req.on('data', (chunk) => {
    if (pathname.startsWith('/api/admin/ladder/')) {
      ladderBytes += chunk.length;
      if (ladderBytes > 1200000) { ladderTooLarge = true; chunks.length = 0; return; }
    }
    if (!ladderTooLarge) chunks.push(Buffer.from(chunk));
  });
  req.on('end', () => {
    if (ladderTooLarge) return sendJson(res, 413, { error: '图片或JSON过大，请缩小后重试' });
    const body = Buffer.concat(chunks).toString('utf8');
    let parsedBody = {};
    if (body) { try { parsedBody = JSON.parse(body); } catch (e) { parsedBody = {}; } }
    const ctx = {
      params: m.params,
      query: parsed.query,
      body: parsedBody,
      rawBody: body,
      headers: req.headers,
      remoteAddress: req.socket.remoteAddress,
    };
    const auditAction = { method: req.method, path: pathname };
    Promise.resolve()
      .then(() => {
        const protectedFeature = pathname === '/api/dark-funds'
          || pathname.startsWith('/api/dark-funds/')
          || pathname === '/api/gold-finger'
          || pathname.startsWith('/api/gold-finger/')
          || pathname.startsWith('/api/gold/');
        if (protectedFeature && reviewModeApplies(ctx, db.get())) {
          throw new HttpError(403, '功能暂未开放');
        }
      })
      .then(() => m.handler(ctx))
      .then(async (result) => {
        if (pathname.startsWith('/api/admin/') && pathname !== '/api/admin/login' && req.method !== 'GET') {
          audit.record(ctx, auditAction, 'SUCCESS');
        }
        await db.flush();
        sendJson(res, 200, result === undefined ? { ok: true } : result);
      })
      .catch(async (err) => {
        try {
          if (pathname.startsWith('/api/admin/') && pathname !== '/api/admin/login' && req.method !== 'GET') {
            audit.record(ctx, auditAction, 'FAILED', err.message);
          }
          await db.flush();
        } catch (saveError) {
          console.error('数据库写入失败', saveError);
        }
        sendJson(res, err.status || 500, { error: err.message || 'server error' });
      });
  });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
db.load()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`API & 管理后台运行中： http://${HOST}:${PORT}/admin`);
      goldFingerSync.start();
      darkFundRankingSync.start();
    });
  })
  .catch((error) => {
    console.error('数据库初始化失败', error);
    process.exit(1);
  });

async function shutdown() {
  goldFingerSync.stop();
  darkFundRankingSync.stop();
  server.close(async () => {
    try { await db.close(); } finally { process.exit(0); }
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
