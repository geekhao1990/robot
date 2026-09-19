const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { UPLOAD_DIR, detectedImageType, imageDimensions } = require('./upload');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DIMENSION = 12000;
const MAX_PIXELS = 40000000;
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

function decodeImage(image, label) {
  if (!image || typeof image !== 'object') throw new Error(`${label}缺失`);
  const mimeType = String(image.mime_type || '').toLowerCase().trim();
  const encoded = String(image.data_base64 || '').replace(/\s+/g, '');
  if (!EXT[mimeType] || !encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error(`${label}格式不正确`);
  }
  const data = Buffer.from(encoded, 'base64');
  if (!data.length || data.length > MAX_IMAGE_BYTES ||
      data.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
    throw new Error(`${label}内容无效或过大`);
  }
  const detectedType = detectedImageType(data);
  if (detectedType !== mimeType) throw new Error(`${label}文件类型不匹配`);
  const dimensions = imageDimensions(data, detectedType);
  if (!dimensions || dimensions.width > MAX_DIMENSION || dimensions.height > MAX_DIMENSION ||
      dimensions.width * dimensions.height > MAX_PIXELS) {
    throw new Error(`${label}图片尺寸无效`);
  }
  return { data, mimeType, ext: EXT[mimeType] };
}

function persistCollectorImages(images, orderId) {
  const prepared = [
    { suffix: 'fund', ...decodeImage(images && images.fund, '资金图') },
    { suffix: 'guide', ...decodeImage(images && images.guide, '解读图') },
  ];
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const safeOrderId = String(orderId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  const baseUrl = String(process.env.PUBLIC_BASE_URL || 'https://app.nankaitechschool.com').replace(/\/$/, '');
  const written = [];
  try {
    return prepared.map((item) => {
      const name = `dark_${safeOrderId}_${item.suffix}_${crypto.randomBytes(6).toString('hex')}${item.ext}`;
      const target = path.join(UPLOAD_DIR, name);
      fs.writeFileSync(target, item.data, { mode: 0o644, flag: 'wx' });
      written.push(target);
      return `${baseUrl}/uploads/${name}`;
    });
  } catch (error) {
    written.forEach((file) => { try { fs.unlinkSync(file); } catch (_) {} });
    throw error;
  }
}

module.exports = { persistCollectorImages };
