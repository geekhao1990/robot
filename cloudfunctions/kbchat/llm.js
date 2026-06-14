// cloudfunctions/kbchat/llm.js
// 调用 Claude（Anthropic Messages API）。仅用 Node 内置 https，无需额外依赖。
// 在云函数「配置 - 环境变量」中设置 ANTHROPIC_API_KEY 后生效；
// 未设置时返回 null，由 index.js 走降级逻辑。

const https = require('https');

function callClaude(system, userText, history = []) {
  return new Promise((resolve, reject) => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return resolve(null); // 未配置 Key -> 降级

    const messages = [];
    history.forEach((h) => {
      if (h && h.role && h.content) {
        messages.push({ role: h.role === 'user' ? 'user' : 'assistant', content: String(h.content) });
      }
    });
    messages.push({ role: 'user', content: userText });

    const body = JSON.stringify({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
      max_tokens: 1024,
      system,
      messages,
    });

    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-length': Buffer.byteLength(body),
        },
        timeout: 20000,
      },
      (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const text =
              json && json.content && json.content[0] && json.content[0].text;
            resolve(text || null);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('claude timeout')));
    req.write(body);
    req.end();
  });
}

module.exports = { callClaude };
