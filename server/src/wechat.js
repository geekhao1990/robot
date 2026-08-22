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

let tokenCache = { value: '', expiresAt: 0 };

async function getAccessToken() {
  const appid = process.env.WECHAT_APP_ID;
  const secret = process.env.WECHAT_APP_SECRET;
  if (!appid || !secret) {
    const err = new Error('邀请二维码待配置微信 AppID 和 AppSecret');
    err.status = 503;
    throw err;
  }
  if (tokenCache.value && tokenCache.expiresAt > Date.now() + 60 * 1000) return tokenCache.value;
  const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
  url.searchParams.set('grant_type', 'client_credential');
  url.searchParams.set('appid', appid);
  url.searchParams.set('secret', secret);
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.errcode || !data.access_token) {
    const err = new Error(data.errmsg || '获取微信接口凭证失败');
    err.status = 502;
    throw err;
  }
  tokenCache = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(300, Number(data.expires_in) || 7200) * 1000,
  };
  return tokenCache.value;
}

async function getUnlimitedCode(scene, page) {
  const accessToken = await getAccessToken();
  const response = await fetch(`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(accessToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scene, page, check_path: false, env_version: process.env.WECHAT_ENV_VERSION || 'trial', width: 430 }),
  });
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await response.json();
    const err = new Error(data.errmsg || '生成邀请二维码失败');
    err.status = 502;
    throw err;
  }
  if (!response.ok) {
    const err = new Error('生成邀请二维码失败');
    err.status = 502;
    throw err;
  }
  return { buffer: Buffer.from(await response.arrayBuffer()), mimeType: contentType || 'image/png' };
}

module.exports = { code2Session, getUnlimitedCode };
