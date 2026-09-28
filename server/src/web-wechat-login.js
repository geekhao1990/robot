const crypto = require('crypto');
const db = require('./db');
const auth = require('./auth');

const states = new Map();
const STATE_TTL = 10 * 60 * 1000;

function config() {
  return {
    appid: String(process.env.WECHAT_WEB_APP_ID || '').trim(),
    secret: String(process.env.WECHAT_WEB_APP_SECRET || '').trim(),
    origin: String(process.env.WEB_ORIGIN || 'https://app.nankaitechschool.com').replace(/\/$/, ''),
  };
}

function configured() {
  const value = config();
  return !!(value.appid && value.secret);
}

function cleanupStates() {
  const now = Date.now();
  states.forEach((expiresAt, state) => { if (expiresAt <= now) states.delete(state); });
}

function loginUrl() {
  const value = config();
  if (!configured()) {
    const error = new Error('微信网页登录尚未配置网站应用 AppID 和 Secret');
    error.status = 503;
    throw error;
  }
  cleanupStates();
  const state = crypto.randomBytes(24).toString('hex');
  states.set(state, Date.now() + STATE_TTL);
  const callback = `${value.origin}/api/web/wechat/callback`;
  const url = new URL('https://open.weixin.qq.com/connect/qrconnect');
  url.searchParams.set('appid', value.appid);
  url.searchParams.set('redirect_uri', callback);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'snsapi_login');
  url.searchParams.set('state', state);
  return `${url.toString()}#wechat_redirect`;
}

async function wechatJson(url) {
  const response = await fetch(url);
  const result = await response.json();
  if (!response.ok || result.errcode) {
    const error = new Error(result.errmsg || '微信授权请求失败');
    error.status = 401;
    throw error;
  }
  return result;
}

function createUser(unionid, profile) {
  return {
    id: 'wx_' + crypto.createHash('sha256').update(`union:${unionid}`).digest('hex').slice(0, 16),
    wxUnionId: unionid,
    wxWebOpenId: profile.openid || '',
    name: profile.nickname || '微信用户',
    avatar: profile.headimgurl || 'https://app.nankaitechschool.com/assets/avatars/author-68.jpg',
    desc: '这个人很懒，什么都没留下', fans: 0, follows: 0, likes: 0,
    goldExpire: 0, goldQuotaGiftMigrated: true,
    serviceExpire: 0, servicePlan: '', courseAccessPermanent: false,
    official: false, darkFundEnabled: false, darkFundRemaining: 0,
    darkFundManualRemaining: 0, darkFundServiceRemaining: 0, darkFundServiceMonth: '',
    createdAt: Date.now(), tags: ['new', 'web-wechat'],
  };
}

async function complete(query) {
  cleanupStates();
  const state = String(query.state || '');
  if (!state || !states.has(state)) {
    const error = new Error('微信登录状态已过期，请重新扫码');
    error.status = 400;
    throw error;
  }
  states.delete(state);
  if (!query.code) {
    const error = new Error('微信登录未获授权');
    error.status = 400;
    throw error;
  }
  const value = config();
  const tokenUrl = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
  tokenUrl.searchParams.set('appid', value.appid);
  tokenUrl.searchParams.set('secret', value.secret);
  tokenUrl.searchParams.set('code', String(query.code));
  tokenUrl.searchParams.set('grant_type', 'authorization_code');
  const access = await wechatJson(tokenUrl);
  const profileUrl = new URL('https://api.weixin.qq.com/sns/userinfo');
  profileUrl.searchParams.set('access_token', access.access_token);
  profileUrl.searchParams.set('openid', access.openid);
  profileUrl.searchParams.set('lang', 'zh_CN');
  const profile = await wechatJson(profileUrl);
  const unionid = String(profile.unionid || access.unionid || '').trim();
  if (!unionid) {
    const error = new Error('未取得微信 UnionID，请先将网站应用和小程序绑定到同一开放平台');
    error.status = 409;
    throw error;
  }
  const data = db.get();
  let user = data.users.find((item) => item.wxUnionId === unionid);
  if (!user) {
    user = createUser(unionid, profile);
    data.users.push(user);
  } else {
    user.wxWebOpenId = profile.openid || user.wxWebOpenId || '';
    if (profile.nickname) user.name = profile.nickname;
    if (profile.headimgurl) user.avatar = profile.headimgurl;
  }
  await db.save();
  return auth.issue(user.id);
}

module.exports = { configured, loginUrl, complete };
