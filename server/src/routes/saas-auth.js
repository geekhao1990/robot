const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const { goldAccess, pubUser } = require('../util');
const { verifyPassword } = require('../user-password');

const codes = new Map();
const sends = new Map();

function fullAccess(user) {
  return Boolean(user && user.darkFundEnabled === true && user.decisionPioneerEnabled === true && goldAccess(user));
}

function phoneOf(user) {
  const digits = String(user && user.phone || '').replace(/\D/g, '');
  return digits.length >= 11 ? digits.slice(-11) : '';
}

function smsConfig() {
  return {
    secretId: String(process.env.TENCENT_SMS_SECRET_ID || '').trim(),
    secretKey: String(process.env.TENCENT_SMS_SECRET_KEY || '').trim(),
    appId: String(process.env.TENCENT_SMS_SDK_APP_ID || '').trim(),
    signName: String(process.env.TENCENT_SMS_SIGN_NAME || '').trim(),
    templateId: String(process.env.TENCENT_SMS_TEMPLATE_ID || '').trim(),
    region: String(process.env.TENCENT_SMS_REGION || 'ap-guangzhou').trim(),
  };
}

function smsMockEnabled() {
  return /^(1|true|yes)$/i.test(String(process.env.SAAS_SMS_MOCK || ''));
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

async function sendTencentSms(phone, code) {
  const config = smsConfig();
  if (Object.values(config).slice(0, 5).some((value) => !value)) {
    const error = new Error('手机验证码登录尚未配置');
    error.status = 503;
    throw error;
  }
  const host = 'sms.tencentcloudapi.com';
  const action = 'SendSms';
  const service = 'sms';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const payload = JSON.stringify({
    PhoneNumberSet: [`+86${phone}`],
    SmsSdkAppId: config.appId,
    SignName: config.signName,
    TemplateId: config.templateId,
    TemplateParamSet: [code, '5'],
  });
  const contentType = 'application/json; charset=utf-8';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const hashedPayload = crypto.createHash('sha256').update(payload).digest('hex');
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`;
  const secretDate = hmac(`TC3${config.secretKey}`, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = hmac(secretSigning, stringToSign, 'hex');
  const authorization = `TC3-HMAC-SHA256 Credential=${config.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(`https://${host}`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': contentType,
      Host: host,
      'X-TC-Action': action,
      'X-TC-Version': '2021-01-11',
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': config.region,
    },
    body: payload,
  });
  const result = await response.json().catch(() => ({}));
  const status = result.Response && result.Response.SendStatusSet && result.Response.SendStatusSet[0];
  if (!response.ok || result.Response && result.Response.Error || !status || status.Code !== 'Ok') {
    throw new Error(status && status.Message || result.Response && result.Response.Error && result.Response.Error.Message || '验证码发送失败');
  }
}

module.exports = function register(router, HttpError) {
  router.post('/api/saas/login', (ctx) => {
    const body = ctx.body || {};
    const userId = String(body.userId || '').trim();
    const user = db.get().users.find((item) => item.id === userId);
    if (!user || !verifyPassword(user, String(body.password || ''))) throw new HttpError(401, '账号或密码错误');
    if (!fullAccess(user)) throw new HttpError(403, '当前账号未开通完整权限');
    return { token: auth.issue(user.id), user: pubUser(user) };
  });

  router.get('/api/saas/me', (ctx) => {
    const userId = auth.userIdFor(ctx.headers.authorization);
    const user = db.get().users.find((item) => item.id === userId);
    if (!user) throw new HttpError(401, '登录已失效');
    if (!fullAccess(user)) throw new HttpError(403, '当前账号完整权限已失效');
    return { user: pubUser(user) };
  });

  router.post('/api/saas/sms/send', async (ctx) => {
    const phone = String(ctx.body && ctx.body.phone || '').replace(/\D/g, '');
    if (!/^1\d{10}$/.test(phone)) throw new HttpError(400, '请输入正确的手机号');
    const users = db.get().users;
    const user = users.find((item) => phoneOf(item) === phone && fullAccess(item))
      || (smsMockEnabled() ? users.find(fullAccess) : null);
    if (!user) throw new HttpError(403, '该手机号未绑定满权限账号');
    const now = Date.now();
    const previous = sends.get(phone) || [];
    const recent = previous.filter((timestamp) => now - timestamp < 24 * 60 * 60 * 1000);
    if (recent.some((timestamp) => now - timestamp < 60 * 1000)) throw new HttpError(429, '请60秒后再获取验证码');
    if (recent.length >= 10) throw new HttpError(429, '今日验证码次数已达上限');
    const mock = smsMockEnabled();
    const code = mock ? '888888' : String(crypto.randomInt(100000, 1000000));
    if (!mock) await sendTencentSms(phone, code);
    sends.set(phone, [...recent, now]);
    codes.set(phone, { userId: user.id, hash: crypto.createHash('sha256').update(code).digest('hex'), expiresAt: now + 5 * 60 * 1000, attempts: 0 });
    return { ok: true, expiresIn: 300, mock, ...(mock ? { mockCode: code } : {}) };
  });

  router.post('/api/saas/sms/login', (ctx) => {
    const phone = String(ctx.body && ctx.body.phone || '').replace(/\D/g, '');
    const code = String(ctx.body && ctx.body.code || '').trim();
    const record = codes.get(phone);
    if (!record || record.expiresAt <= Date.now()) { codes.delete(phone); throw new HttpError(401, '验证码已失效'); }
    record.attempts += 1;
    if (record.attempts > 5) { codes.delete(phone); throw new HttpError(429, '验证码错误次数过多'); }
    if (record.hash !== crypto.createHash('sha256').update(code).digest('hex')) throw new HttpError(401, '验证码错误');
    const user = db.get().users.find((item) => item.id === record.userId);
    if (!fullAccess(user)) throw new HttpError(403, '当前账号完整权限已失效');
    codes.delete(phone);
    return { token: auth.issue(user.id), user: pubUser(user) };
  });
};
