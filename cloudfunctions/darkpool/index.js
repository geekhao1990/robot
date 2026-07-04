// cloudfunctions/darkpool/index.js
// 暗盘截图云函数：小程序传入股票代码 -> 调用设备端截图智能体(darkpool-agent)
// -> 把返回的 PNG 上传到云存储 -> 返回 fileID 给聊天页以图片消息展示。
//
// 环境变量（云函数「配置 - 环境变量」中设置）：
//   DARKPOOL_AGENT_URL   设备端服务地址，如 https://xxx.frp.example.com
//   DARKPOOL_AGENT_TOKEN 与设备端 AGENT_TOKEN 一致
//
// 注意：截图智能体单次耗时约 20~50 秒，请把本云函数超时时间调到 60 秒。

const cloud = require('wx-server-sdk');
const https = require('https');
const http = require('http');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const CODE_RE = /^\d{1,6}$/;

function callAgent(baseUrl, token, code) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/darkpool/screenshot', baseUrl);
    const body = JSON.stringify({ code });
    const mod = url.protocol === 'http:' ? http : https;
    const req = mod.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'http:' ? 80 : 443),
        path: url.pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        timeout: 55000, // 智能体要真机操作，耗时较长
      },
      (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`agent 返回异常: ${String(data).slice(0, 120)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('agent timeout')));
    req.write(body);
    req.end();
  });
}

exports.main = async (event = {}) => {
  const raw = String(event.code || '').trim().toUpperCase().replace(/^HK\.?/, '');
  if (!CODE_RE.test(raw)) {
    return { ok: false, message: '请输入正确的股票代码，如：01810 或 700' };
  }
  const code = raw.padStart(5, '0'); // 港股代码补齐 5 位

  const baseUrl = process.env.DARKPOOL_AGENT_URL;
  if (!baseUrl) {
    return {
      ok: false,
      notConfigured: true,
      message:
        '暗盘截图服务尚未接入：请部署 darkpool-agent（连接安卓设备的截图服务），' +
        '并在本云函数环境变量中配置 DARKPOOL_AGENT_URL / DARKPOOL_AGENT_TOKEN。',
    };
  }

  let res;
  try {
    res = await callAgent(baseUrl, process.env.DARKPOOL_AGENT_TOKEN, code);
  } catch (e) {
    return { ok: false, message: `截图服务暂时不可用（${e.message}），请稍后再试` };
  }

  if (!res || !res.ok || !res.image_base64) {
    return { ok: false, message: (res && res.message) || '未能获取到该股票的暗盘截图' };
  }

  // 上传到云存储，返回 fileID（image 组件可直接渲染 cloud:// 路径）
  const upload = await cloud.uploadFile({
    cloudPath: `darkpool/${code}-${Date.now()}.png`,
    fileContent: Buffer.from(res.image_base64, 'base64'),
  });

  return { ok: true, code, fileID: upload.fileID };
};
