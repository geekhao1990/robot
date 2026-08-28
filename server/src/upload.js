// server/src/upload.js —— 零依赖的图片上传（解析 multipart/form-data 单文件）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const auth = require('./auth');
const audit = require('./audit');
const db = require('./db');

const UPLOAD_DIR = path.join(__dirname, '../public/uploads');
const MAX = 5 * 1024 * 1024 + 256 * 1024; // 文件5MB，额外空间用于 multipart 头
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
const MAX_DIMENSION = 12000;
const MAX_PIXELS = 40000000;

function jpegDimensions(data) {
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) { offset += 1; continue; }
    const marker = data[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const length = data.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > data.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  return null;
}

function imageDimensions(data, type) {
  if (type === 'image/png' && data.length >= 24 && data.subarray(12, 16).toString('ascii') === 'IHDR') {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (type === 'image/gif' && data.length >= 10) return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  if (type === 'image/jpeg') return jpegDimensions(data);
  if (type === 'image/webp' && data.length >= 30) {
    const chunk = data.subarray(12, 16).toString('ascii');
    if (chunk === 'VP8X') return { width: data.readUIntLE(24, 3) + 1, height: data.readUIntLE(27, 3) + 1 };
    if (chunk === 'VP8L' && data[20] === 0x2f) {
      return {
        width: 1 + data[21] + ((data[22] & 0x3f) << 8),
        height: 1 + ((data[22] & 0xc0) >> 6) + (data[23] << 2) + ((data[24] & 0x0f) << 10),
      };
    }
    if (chunk === 'VP8 ' && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) {
      return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
    }
  }
  return null;
}

function detectedImageType(data) {
  if (!Buffer.isBuffer(data) || data.length < 12) return '';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff && data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9) return 'image/jpeg';
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && data.subarray(data.length - 8, data.length - 4).toString('ascii') === 'IEND') return 'image/png';
  const gifHeader = data.subarray(0, 6).toString('ascii');
  if ((gifHeader === 'GIF87a' || gifHeader === 'GIF89a') && data[data.length - 1] === 0x3b) return 'image/gif';
  if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') {
    const declaredSize = data.readUInt32LE(4) + 8;
    if (declaredSize === data.length) return 'image/webp';
  }
  return '';
}

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
  req.on('end', async () => {
    if (aborted) return sendJson(res, 413, { error: '图片过大（上限 8MB）' });
    try {
      const file = parseFirstFile(Buffer.concat(chunks), req.headers['content-type']);
      if (!file || !file.data || !file.data.length) return sendJson(res, 400, { error: '未收到文件' });
      if (file.data.length > 5 * 1024 * 1024) return sendJson(res, 413, { error: '图片过大（上限5MB）' });
      const detectedType = detectedImageType(file.data);
      if (!detectedType || !EXT[detectedType]) return sendJson(res, 415, { error: '仅支持真实的 JPG、PNG、GIF、WebP 图片' });
      if (file.contentType && file.contentType.toLowerCase() !== detectedType) return sendJson(res, 415, { error: '文件内容与图片类型不一致' });
      const dimensions = imageDimensions(file.data, detectedType);
      if (!dimensions || !dimensions.width || !dimensions.height) return sendJson(res, 415, { error: '图片结构无效或已损坏' });
      if (dimensions.width > MAX_DIMENSION || dimensions.height > MAX_DIMENSION || dimensions.width * dimensions.height > MAX_PIXELS) {
        return sendJson(res, 413, { error: '图片尺寸过大' });
      }
      const ext = EXT[detectedType];
      const name = 'up_' + Date.now() + '_' + crypto.randomBytes(8).toString('hex') + ext;
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      fs.writeFileSync(path.join(UPLOAD_DIR, name), file.data, { mode: 0o644, flag: 'wx' });
      const proto = req.headers['x-forwarded-proto'] || 'http';
      const host = req.headers.host || 'localhost';
      if (auth.isAdmin(req.headers.authorization)) {
        audit.record({ headers: req.headers, body: { name, type: detectedType, size: file.data.length }, remoteAddress: req.socket.remoteAddress }, { method: 'POST', path: '/api/upload' });
        await db.flush();
      }
      sendJson(res, 200, { url: `${proto}://${host}/uploads/${name}`, name });
    } catch (e) {
      sendJson(res, 500, { error: '上传失败' });
    }
  });
}

module.exports = { handleUpload, UPLOAD_DIR, detectedImageType, imageDimensions };
