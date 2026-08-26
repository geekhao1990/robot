// 用 wx.login 的临时 code 换取 openid/session_key。
// AppSecret 只能保存在服务器环境变量中。
async function code2Session(code) {
  const appid = process.env.WECHAT_APP_ID;
  const secret = process.env.WECHAT_APP_SECRET;
  if (!appid || !secret) {
    const err = new Error('微信登录未配置：请设置 WECHAT_APP_ID 和 WECHAT_APP_SECRET');
    err.status = 503;
    throw err;
  }
  if (!code) {
    const err = new Error('缺少微信登录 code');
    err.status = 400;
    throw err;
  }

  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', appid);
  url.searchParams.set('secret', secret);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.errcode || !data.openid) {
    const err = new Error(data.errmsg || '微信登录凭证校验失败');
    err.status = 401;
    throw err;
  }
  return data;
}

let accessTokenCache = { value: '', expiresAt: 0 };

function config() {
  const appid = process.env.WECHAT_APP_ID;
  const secret = process.env.WECHAT_APP_SECRET;
  if (!appid || !secret) {
    const err = new Error('微信能力未配置：请设置 WECHAT_APP_ID 和 WECHAT_APP_SECRET');
    err.status = 503;
    throw err;
  }
  return { appid, secret };
}

async function getAccessToken(forceRefresh = false) {
  if (!forceRefresh && accessTokenCache.value && accessTokenCache.expiresAt > Date.now() + 60 * 1000) {
    return accessTokenCache.value;
  }
  const { appid, secret } = config();
  const response = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credential', appid, secret, force_refresh: forceRefresh }),
  });
  const data = await response.json();
  if (!response.ok || data.errcode || !data.access_token) {
    const err = new Error(data.errmsg || '获取微信接口凭证失败');
    err.status = 502;
    throw err;
  }
  accessTokenCache = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(300, Number(data.expires_in) || 7200) * 1000,
  };
  return accessTokenCache.value;
}

async function requestPhoneNumber(code, forceRefresh = false) {
  const token = await getAccessToken(forceRefresh);
  const response = await fetch(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = await response.json();
  if (!forceRefresh && (data.errcode === 40001 || data.errcode === 40014 || data.errcode === 42001)) {
    accessTokenCache = { value: '', expiresAt: 0 };
    return requestPhoneNumber(code, true);
  }
  if (!response.ok || data.errcode || !data.phone_info) {
    const err = new Error(data.errmsg || '微信手机号授权失败');
    err.status = 400;
    throw err;
  }
  return data.phone_info;
}

async function getPhoneNumber(code) {
  if (!code) {
    const err = new Error('缺少微信手机号授权凭证');
    err.status = 400;
    throw err;
  }
  return requestPhoneNumber(code);
}

module.exports = { code2Session, getPhoneNumber };
