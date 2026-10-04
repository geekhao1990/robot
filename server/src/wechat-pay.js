const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const API_ORIGIN = 'https://api.mch.weixin.qq.com';

function resolveSecretPath(value) {
  if (!value) return '';
  return path.isAbsolute(value) ? value : path.resolve(__dirname, '..', value);
}

function loadKey(filePath, label) {
  const resolved = resolveSecretPath(filePath);
  if (!resolved || !fs.existsSync(resolved)) {
    const error = new Error(`${label}文件不存在`);
    error.status = 503;
    throw error;
  }
  return fs.readFileSync(resolved, 'utf8');
}

function config() {
  return {
    appId: String(process.env.WECHAT_APP_ID || '').trim(),
    mchId: String(process.env.WECHAT_PAY_MCH_ID || '').trim(),
    merchantSerial: String(process.env.WECHAT_PAY_CERT_SERIAL || '').trim(),
    privateKeyPath: String(process.env.WECHAT_PAY_PRIVATE_KEY_PATH || '').trim(),
    apiV3Key: String(process.env.WECHAT_PAY_API_V3_KEY || ''),
    notifyUrl: String(process.env.WECHAT_PAY_NOTIFY_URL || '').trim(),
    payPublicKeyId: String(process.env.WECHAT_PAY_PUBLIC_KEY_ID || process.env.WECHAT_PAY_PLATFORM_SERIAL || '').trim(),
    payPublicKeyPath: String(process.env.WECHAT_PAY_PUBLIC_KEY_PATH || process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH || '').trim(),
  };
}

function requireConfig() {
  const cfg = config();
  const missing = [];
  if (!cfg.appId) missing.push('WECHAT_APP_ID');
  if (!cfg.mchId) missing.push('WECHAT_PAY_MCH_ID');
  if (!cfg.merchantSerial) missing.push('WECHAT_PAY_CERT_SERIAL');
  if (!cfg.privateKeyPath) missing.push('WECHAT_PAY_PRIVATE_KEY_PATH');
  if (Buffer.byteLength(cfg.apiV3Key) !== 32) missing.push('WECHAT_PAY_API_V3_KEY(32字节)');
  if (!/^https:\/\//i.test(cfg.notifyUrl)) missing.push('WECHAT_PAY_NOTIFY_URL(HTTPS)');
  if (!/^PUB_KEY_ID_/i.test(cfg.payPublicKeyId)) missing.push('WECHAT_PAY_PUBLIC_KEY_ID');
  if (!cfg.payPublicKeyPath) missing.push('WECHAT_PAY_PUBLIC_KEY_PATH');
  if (missing.length) {
    const error = new Error(`微信支付暂未配置完整：缺少 ${missing.join('、')}`);
    error.status = 503;
    throw error;
  }
  cfg.privateKey = loadKey(cfg.privateKeyPath, '商户API私钥');
  cfg.payPublicKey = loadKey(cfg.payPublicKeyPath, '微信支付公钥');
  return cfg;
}

function nonce() {
  return crypto.randomBytes(16).toString('hex');
}

function rsaSign(message, privateKey) {
  return crypto.sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64');
}

function authorization(method, canonicalUrl, rawBody, cfg) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = nonce();
  const message = `${method}\n${canonicalUrl}\n${timestamp}\n${nonceStr}\n${rawBody}\n`;
  const signature = rsaSign(message, cfg.privateKey);
  return `WECHATPAY2-SHA256-RSA2048 mchid="${cfg.mchId}",nonce_str="${nonceStr}",timestamp="${timestamp}",serial_no="${cfg.merchantSerial}",signature="${signature}"`;
}

function headerValue(headers, name) {
  return typeof headers.get === 'function' ? headers.get(name) : headers[String(name).toLowerCase()];
}

function verifySignedPayload(headers, rawBody, cfg) {
  const serial = headerValue(headers, 'wechatpay-serial');
  const signature = headerValue(headers, 'wechatpay-signature');
  const timestamp = headerValue(headers, 'wechatpay-timestamp');
  const nonceStr = headerValue(headers, 'wechatpay-nonce');
  if (!serial || !signature || !timestamp || !nonceStr || serial !== cfg.payPublicKeyId) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const message = `${timestamp}\n${nonceStr}\n${rawBody}\n`;
  return crypto.verify('RSA-SHA256', Buffer.from(message), cfg.payPublicKey, Buffer.from(signature, 'base64'));
}

async function requestWechat(method, canonicalUrl, body) {
  const cfg = requireConfig();
  const rawBody = body === undefined ? '' : JSON.stringify(body);
  const response = await fetch(API_ORIGIN + canonicalUrl, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: authorization(method, canonicalUrl, rawBody, cfg),
      'Wechatpay-Serial': cfg.payPublicKeyId,
    },
    body: body === undefined ? undefined : rawBody,
  });
  const rawResponse = await response.text();
  if (!verifySignedPayload(response.headers, rawResponse, cfg)) {
    const error = new Error('微信支付应答验签失败');
    error.status = 502;
    throw error;
  }
  let data = {};
  try { data = rawResponse ? JSON.parse(rawResponse) : {}; } catch (_) {}
  if (!response.ok) {
    const error = new Error(data.message || '微信支付接口请求失败');
    error.status = 502;
    throw error;
  }
  return data;
}

async function createJsapiPayment({ outTradeNo, description, amount, openid }) {
  const cfg = requireConfig();
  const result = await requestWechat('POST', '/v3/pay/transactions/jsapi', {
    appid: cfg.appId,
    mchid: cfg.mchId,
    description,
    out_trade_no: outTradeNo,
    notify_url: cfg.notifyUrl,
    amount: { total: amount, currency: 'CNY' },
    payer: { openid },
  });
  if (!result.prepay_id) {
    const error = new Error('微信支付未返回预支付标识');
    error.status = 502;
    throw error;
  }
  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = nonce();
  const packageValue = `prepay_id=${result.prepay_id}`;
  const paySign = rsaSign(`${cfg.appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`, cfg.privateKey);
  return {
    prepayId: result.prepay_id,
    payment: { timeStamp, nonceStr, package: packageValue, signType: 'RSA', paySign },
  };
}

function queryPayment(outTradeNo) {
  const cfg = requireConfig();
  const canonicalUrl = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(cfg.mchId)}`;
  return requestWechat('GET', canonicalUrl);
}

function verifyAndDecryptNotification(headers, rawBody) {
  const cfg = requireConfig();
  if (!verifySignedPayload(headers, rawBody, cfg)) {
    const error = new Error('微信支付回调验签失败');
    error.status = 401;
    throw error;
  }
  const notification = JSON.parse(rawBody || '{}');
  if (notification.event_type !== 'TRANSACTION.SUCCESS') return null;
  const resource = notification.resource || {};
  if (resource.algorithm !== 'AEAD_AES_256_GCM') {
    const error = new Error('不支持的微信支付回调加密算法');
    error.status = 400;
    throw error;
  }
  const encrypted = Buffer.from(resource.ciphertext || '', 'base64');
  if (encrypted.length < 17) throw Object.assign(new Error('微信支付回调密文无效'), { status: 400 });
  const authTag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(cfg.apiV3Key), Buffer.from(resource.nonce || ''));
  decipher.setAAD(Buffer.from(resource.associated_data || ''));
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
}

module.exports = { requireConfig, createJsapiPayment, queryPayment, verifyAndDecryptNotification };
