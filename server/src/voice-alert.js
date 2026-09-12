const crypto = require('crypto');

const ENDPOINT = 'https://dyvmsapi.aliyuncs.com/';

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function voiceConfig() {
  const config = {
    accessKeyId: String(process.env.ALIYUN_VOICE_ACCESS_KEY_ID || '').trim(),
    accessKeySecret: String(process.env.ALIYUN_VOICE_ACCESS_KEY_SECRET || '').trim(),
    calledNumber: String(process.env.AI_ALERT_PHONE || '').replace(/[\s-]/g, ''),
    ttsCode: String(process.env.ALIYUN_VOICE_TTS_CODE || '').trim(),
    calledShowNumber: String(process.env.ALIYUN_VOICE_CALLED_SHOW_NUMBER || '').replace(/[\s-]/g, ''),
  };
  config.ready = Boolean(config.accessKeyId && config.accessKeySecret && config.calledNumber && config.ttsCode);
  return config;
}

function signedParams(config, orderId) {
  const params = {
    AccessKeyId: config.accessKeyId,
    Action: 'SingleCallByTts',
    CalledNumber: config.calledNumber,
    Format: 'JSON',
    OutId: String(orderId || '').slice(-15),
    PlayTimes: '2',
    RegionId: 'cn-hangzhou',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: '1.0',
    Speed: '0',
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    TtsCode: config.ttsCode,
    TtsParam: JSON.stringify({ orderId: String(orderId || '') }),
    Version: '2017-05-25',
    Volume: '100',
  };
  if (config.calledShowNumber) params.CalledShowNumber = config.calledShowNumber;
  const canonical = Object.keys(params).sort().map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`).join('&');
  const stringToSign = `POST&${percentEncode('/')}&${percentEncode(canonical)}`;
  params.Signature = crypto.createHmac('sha1', `${config.accessKeySecret}&`).update(stringToSign).digest('base64');
  return params;
}

async function notifyQuestionableOrder(orderId) {
  const config = voiceConfig();
  if (!config.ready) return { sent: false, configured: false, message: '座机语音通知尚未配置' };
  const params = signedParams(config, orderId);
  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(15000),
    });
  } catch (_) {
    return { sent: false, configured: true, message: '座机语音通知连接失败' };
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.Code !== 'OK') {
    return { sent: false, configured: true, message: payload.Message || '座机语音通知发送失败', code: payload.Code || '' };
  }
  return { sent: true, configured: true, callId: payload.CallId || '', message: `工单号是${orderId}的工单有疑问，请及时核对` };
}

module.exports = { notifyQuestionableOrder, percentEncode, signedParams, voiceConfig };
