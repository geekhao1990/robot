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

module.exports = { code2Session };
