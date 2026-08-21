const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const API_ORIGIN = 'https://api.mch.weixin.qq.com';

function config() {
  return {
    appId: process.env.WECHAT_APP_ID || '',
    mchId: process.env.WECHAT_PAY_MCH_ID || '',
    merchantSerial: process.env.WECHAT_PAY_CERT_SERIAL || '',
    privateKeyPath: process.env.WECHAT_PAY_PRIVATE_KEY_PATH || '',
    apiV3Key: process.env.WECHAT_PAY_API_V3_KEY || '',
    notifyUrl: process.env.WECHAT_PAY_NOTIFY_URL || '',
    platformSerial: process.env.WECHAT_PAY_PLATFORM_SERIAL || '',
    platformPublicKeyPath: process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH || '',
  };
}

function resolveSecretPath(value) {
  if (!value) return '';
  return path.isAbsolute(value) ? value : path.resolve(__dirname, '..', value);
}

function loadKey(filePath, label) {
  const resolved = resolveSecretPath(filePath);
  if (!resolved || !fs.existsSync(resolved)) {
    const err = new Error(`${label}文件不存在`);
    err.status = 503;
    throw err;
  }
  return fs.readFileSync(resolved, 'utf8');
}

function requireConfig() {
  const cfg = config();
  const missing = [];
  if (!cfg.appId) missing.push('WECHAT_APP_ID');
  if (!cfg.mchId) missing.push('WECHAT_PAY_MCH_ID');
  if (!cfg.merchantSerial) missing.push('WECHAT_PAY_CERT_SERIAL');
  if (!cfg.privateKeyPath) missing.push('WECHAT_PAY_PRIVATE_KEY_PATH');
  if (!cfg.apiV3Key || Buffer.byteLength(cfg.apiV3Key) !== 32) missing.push('WECHAT_PAY_API_V3_KEY(32字节)');
  if (!cfg.notifyUrl || !/^https:\/\//i.test(cfg.notifyUrl)) missing.push('WECHAT_PAY_NOTIFY_URL(HTTPS)');
  if (!cfg.platformSerial) missing.push('WECHAT_PAY_PLATFORM_SERIAL');
  if (!cfg.platformPublicKeyPath) missing.push('WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH');
  if (missing.length) {
    const err = new Error(`微信支付暂未开通：缺少 ${missing.join('、')}`);
    err.status = 503;
    throw err;
  }
  cfg.privateKey = loadKey(cfg.privateKeyPath, '商户私钥');
  cfg.platformPublicKey = loadKey(cfg.platformPublicKeyPath, '微信支付平台公钥');
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

function verifySignedPayload(headers, rawBody, cfg) {
  const get = (name) => typeof headers.get === 'function' ? headers.get(name) : headers[String(name).toLowerCase()];
  const serial = get('wechatpay-serial');
  const signature = get('wechatpay-signature');
  const timestamp = get('wechatpay-timestamp');
  const nonceStr = get('wechatpay-nonce');
  if (!serial || !signature || !timestamp || !nonceStr) return false;
  if (serial !== cfg.platformSerial) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const message = `${timestamp}\n${nonceStr}\n${rawBody}\n`;
  return crypto.verify('RSA-SHA256', Buffer.from(message), cfg.platformPublicKey, Buffer.from(signature, 'base64'));
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
    },
    body: body === undefined ? undefined : rawBody,
  });
  const rawResponse = await response.text();
  if (!verifySignedPayload(response.headers, rawResponse, cfg)) {
    const err = new Error('微信支付应答验签失败');
    err.status = 502;
    throw err;
  }
  let data = {};
  try { data = rawResponse ? JSON.parse(rawResponse) : {}; } catch (e) {}
  if (!response.ok) {
    const err = new Error(data.message || '微信支付接口请求失败');
    err.status = 502;
    throw err;
  }
  return data;
}

async function createJsapiPayment({ outTradeNo, description, amount, openid }) {
  const cfg = requireConfig();
  const body = {
    appid: cfg.appId,
    mchid: cfg.mchId,
    description,
    out_trade_no: outTradeNo,
    notify_url: cfg.notifyUrl,
    amount: { total: amount, currency: 'CNY' },
    payer: { openid },
  };
  const result = await requestWechat('POST', '/v3/pay/transactions/jsapi', body);
  if (!result.prepay_id) {
    const err = new Error('微信支付未返回预支付标识');
    err.status = 502;
    throw err;
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
    const err = new Error('微信支付回调验签失败');
    err.status = 401;
    throw err;
  }
  const notification = JSON.parse(rawBody || '{}');
  if (notification.event_type !== 'TRANSACTION.SUCCESS') return null;
  const resource = notification.resource || {};
  if (resource.algorithm !== 'AEAD_AES_256_GCM') {
    const err = new Error('不支持的微信支付回调加密算法');
    err.status = 400;
    throw err;
  }
  const encrypted = Buffer.from(resource.ciphertext || '', 'base64');
  const authTag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(cfg.apiV3Key), Buffer.from(resource.nonce || ''));
  decipher.setAAD(Buffer.from(resource.associated_data || ''));
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
}

module.exports = { requireConfig, createJsapiPayment, queryPayment, verifyAndDecryptNotification };
