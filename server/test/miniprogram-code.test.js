const test = require('node:test');
const assert = require('node:assert/strict');

const { miniProgramCode, resetCache } = require('../src/miniprogram-code');

test('生成小程序码时获取 access_token 并缓存图片', async () => {
  const originalAppId = process.env.WECHAT_APP_ID;
  const originalSecret = process.env.WECHAT_APP_SECRET;
  process.env.WECHAT_APP_ID = 'test-app';
  process.env.WECHAT_APP_SECRET = 'test-secret';
  resetCache();
  const calls = [];
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(120)]);
  const fetcher = async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return { ok: true, json: async () => ({ access_token: 'token', expires_in: 7200 }) };
    return {
      ok: true,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => png,
    };
  };
  try {
    const first = await miniProgramCode(fetcher);
    const second = await miniProgramCode(fetcher);
    assert.equal(first.contentType, 'image/png');
    assert.equal(first.buffer.length, 124);
    assert.equal(second, first);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /cgi-bin\/token/);
    assert.match(calls[1].url, /getwxacodeunlimit/);
    assert.equal(JSON.parse(calls[1].options.body).page, 'pages/dark-funds/dark-funds');
  } finally {
    if (originalAppId === undefined) delete process.env.WECHAT_APP_ID; else process.env.WECHAT_APP_ID = originalAppId;
    if (originalSecret === undefined) delete process.env.WECHAT_APP_SECRET; else process.env.WECHAT_APP_SECRET = originalSecret;
    resetCache();
  }
});
