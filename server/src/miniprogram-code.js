const TOKEN_TTL_MS = 100 * 60 * 1000;
const CODE_TTL_MS = 24 * 60 * 60 * 1000;

let tokenCache = null;
let codeCache = null;

function credentials() {
  const appid = String(process.env.WECHAT_APP_ID || '').trim();
  const secret = String(process.env.WECHAT_APP_SECRET || '').trim();
  if (!appid || !secret) throw Object.assign(new Error('小程序码尚未配置'), { status: 503 });
  return { appid, secret };
}

async function responseJson(response, fallback) {
  try { return await response.json(); } catch (error) { throw new Error(fallback); }
}

async function accessToken(fetcher = fetch) {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.value;
  const { appid, secret } = credentials();
  const endpoint = new URL('https://api.weixin.qq.com/cgi-bin/token');
  endpoint.searchParams.set('grant_type', 'client_credential');
  endpoint.searchParams.set('appid', appid);
  endpoint.searchParams.set('secret', secret);
  const response = await fetcher(endpoint);
  const data = await responseJson(response, '微信 access_token 返回异常');
  if (!response.ok || !data.access_token) throw new Error(data.errmsg || '获取微信 access_token 失败');
  tokenCache = { value: data.access_token, expiresAt: Date.now() + Math.min(TOKEN_TTL_MS, Math.max(60, Number(data.expires_in) || 7200) * 1000 - 60000) };
  return tokenCache.value;
}

async function miniProgramCode(fetcher = fetch) {
  if (codeCache && codeCache.expiresAt > Date.now()) return codeCache.value;
  const token = await accessToken(fetcher);
  const response = await fetcher(`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scene: 'share_poster',
      page: 'pages/dark-funds/dark-funds',
      width: 280,
      check_path: false,
      env_version: 'release',
    }),
  });
  const contentType = String(response.headers && response.headers.get('content-type') || '');
  if (!response.ok || contentType.includes('application/json')) {
    const data = await responseJson(response, '生成小程序码失败');
    throw new Error(data.errmsg || '生成小程序码失败');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  if (buffer.length < 100 || (!isPng && !isJpeg)) throw new Error('小程序码图片无效');
  const value = { buffer, contentType: isPng ? 'image/png' : 'image/jpeg' };
  codeCache = { value, expiresAt: Date.now() + CODE_TTL_MS };
  return value;
}

function resetCache() {
  tokenCache = null;
  codeCache = null;
}

module.exports = { miniProgramCode, resetCache };
