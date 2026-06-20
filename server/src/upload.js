// server/src/upload.js —— 零依赖的图片上传（解析 multipart/form-data 单文件）
const fs = require('fs');
const path = require('path');
const auth = require('./auth');

const UPLOAD_DIR = path.join(__dirname, '../public/uploads');
const MAX = 8 * 1024 * 1024; // 8MB
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };

// 从 multipart body 中取出第一个文件字段
function parseFirstFile(buffer, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType || '');
  if (!m) return null;
  const bBuf = Buffer.from('--' + (m[1] || m[2]));
  let idx = buffer.indexOf(bBuf);
  while (idx !== -1) {
    const partStart = idx + bBuf.length;
    const next = buffer.indexOf(bBuf, partStart);
    if (next === -1) break;
    let part = buffer.slice(partStart, next);
    if (part[0] === 0x0d && part[1] === 0x0a) part = part.slice(2); // 去掉前导 CRLF
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerStr = part.slice(0, headerEnd).toString('utf8');
      if (/filename=/i.test(headerStr)) {
        const fn = /filename="?([^"\r\n]*)"?/i.exec(headerStr);
        const ct = /Content-Type:\s*([^\r\n]+)/i.exec(headerStr);
        let data = part.slice(headerEnd + 4);
        if (data.length >= 2 && data[data.length - 2] === 0x0d && data[data.length - 1] === 0x0a) {
          data = data.slice(0, data.length - 2); // 去掉尾部 CRLF
        }
        return { filename: fn ? fn[1] : '', contentType: ct ? ct[1].trim() : '', data };
      }
    }
    idx = next;
  }
  return null;
}

function handleUpload(req, res, sendJson) {
  // 小程序用户或管理后台均可上传
  const ok = auth.userIdFor(req.headers.authorization) || auth.isAdmin(req.headers.authorization);
  if (!ok) return sendJson(res, 401, { error: '未登录' });
  const chunks = [];
  let size = 0;
  let aborted = false;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX) { aborted = true; req.destroy(); return; }
    chunks.push(c);
  });
  req.on('error', () => { if (!aborted) sendJson(res, 400, { error: '上传中断' }); });
  req.on('end', () => {
    if (aborted) return sendJson(res, 413, { error: '图片过大（上限 8MB）' });
    try {
      const file = parseFirstFile(Buffer.concat(chunks), req.headers['content-type']);
      if (!file || !file.data || !file.data.length) return sendJson(res, 400, { error: '未收到文件' });
      const ext = EXT[file.contentType] || path.extname(file.filename) || '.jpg';
      const name = 'up_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext;
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      fs.writeFileSync(path.join(UPLOAD_DIR, name), file.data);
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const host = req.headers.host || 'localhost';
      sendJson(res, 200, { url: `${proto}://${host}/uploads/${name}`, name });
    } catch (e) {
      sendJson(res, 500, { error: '上传失败' });
    }
  });
}

module.exports = { handleUpload, UPLOAD_DIR };
