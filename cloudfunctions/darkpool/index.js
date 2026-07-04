// cloudfunctions/darkpool/index.js
// 暗盘截图云函数（收盘后模式）：
//   1) 先查云数据库当天缓存（darkpool_cache：日期+代码 -> fileID），命中直接秒回；
//   2) 未到当日生成时间（默认 15:30，收盘 15:00 后跑批）则提示客户稍后再来；
//   3) 未命中则调设备端智能体截图（设备端也有当天缓存），上传云存储并写入缓存。
//
// 环境变量（云函数「配置 - 环境变量」中设置）：
//   DARKPOOL_AGENT_URL    设备端服务地址，如 https://xxx.frp.example.com
//   DARKPOOL_AGENT_TOKEN  与设备端 AGENT_TOKEN 一致
//   DARKPOOL_READY_AT     当日截图生成时间（北京时间 HH:MM），默认 15:30；设为空串关闭拦截
//
// 注意：首次截图需真机操作 20~50 秒，请把本云函数超时时间调到 60 秒。

const cloud = require('wx-server-sdk');
const https = require('https');
const http = require('http');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COLLECTION = 'darkpool_cache';

const CODE_RE = /^\d{1,6}$/;
const READY_AT = process.env.DARKPOOL_READY_AT === undefined ? '15:30' : process.env.DARKPOOL_READY_AT;

// 北京时间（云函数运行在 UTC，手动 +8 小时后取 UTC 字段）
function bj() {
  return new Date(Date.now() + 8 * 3600 * 1000);
}
function bjDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
}
function bjHM(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

async function getCache(date, code) {
  try {
    const r = await db.collection(COLLECTION).where({ date, code }).limit(1).get();
    return r.data && r.data[0] ? r.data[0].fileID : null;
  } catch (e) {
    // 集合不存在时自动创建
    try {
      await db.createCollection(COLLECTION);
    } catch (e2) {
      /* 已存在或无权限，忽略 */
    }
    return null;
  }
}

async function putCache(date, code, fileID) {
  try {
    await db.collection(COLLECTION).add({ data: { date, code, fileID, createdAt: Date.now() } });
  } catch (e) {
    /* 写缓存失败不影响本次返回 */
  }
}

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
        timeout: 55000, // 首次截图需真机操作，耗时较长；命中设备端缓存则秒回
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

  const now = bj();
  const today = bjDate(now);

  // 1) 当天缓存命中：同一天同一股票直接返回，不再打设备
  const hit = await getCache(today, code);
  if (hit) {
    return { ok: true, code, fileID: hit, cached: true };
  }

  // 2) 收盘后模式：未到当日生成时间不做实时截图
  if (READY_AT && bjHM(now) < READY_AT) {
    return {
      ok: false,
      message: `暗盘截图在每天收盘后 ${READY_AT} 统一生成，当前时间还未生成 ${code} 的截图，请 ${READY_AT} 之后再来获取～`,
    };
  }

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

  // 3) 调设备端智能体（设备端有当天本地缓存，跑批后命中则秒回）
  let res;
  try {
    res = await callAgent(baseUrl, process.env.DARKPOOL_AGENT_TOKEN, code);
  } catch (e) {
    return { ok: false, message: `截图服务暂时不可用（${e.message}），请稍后再试` };
  }

  if (!res || !res.ok || !res.image_base64) {
    return { ok: false, message: (res && res.message) || '未能获取到该股票的暗盘截图' };
  }

  // 上传到云存储并写入当天缓存
  const upload = await cloud.uploadFile({
    cloudPath: `darkpool/${today}/${code}.png`,
    fileContent: Buffer.from(res.image_base64, 'base64'),
  });
  await putCache(today, code, upload.fileID);

  return { ok: true, code, fileID: upload.fileID, cached: !!res.cached };
};
