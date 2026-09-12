const fs = require('fs');
const path = require('path');
const { UPLOAD_DIR } = require('./upload');

const MODEL = 'deepseek-v4-flash-vision-exp';
const API_URL = 'https://api.deepseek.com/chat/completions';
const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function uploadedImagePath(imageUrl) {
  let pathname = '';
  try {
    pathname = new URL(String(imageUrl || ''), 'https://local.invalid').pathname;
  } catch (_) {
    return null;
  }
  const match = /^\/uploads\/([A-Za-z0-9_.-]+)$/.exec(pathname);
  if (!match) return null;
  const filename = match[1];
  const resolved = path.resolve(UPLOAD_DIR, filename);
  if (path.dirname(resolved) !== path.resolve(UPLOAD_DIR)) return null;
  return resolved;
}

function cleanJsonText(value) {
  const text = String(value || '').trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  return fenced ? fenced[1].trim() : text;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function direction(value) {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

function relationFor(visibleNet, darkNet) {
  const visibleDirection = direction(visibleNet);
  const darkDirection = direction(darkNet);
  if (visibleDirection === 1 && darkDirection === 1) return '同步流入';
  if (visibleDirection === -1 && darkDirection === -1) return '同步流出';
  if (visibleDirection && darkDirection && visibleDirection !== darkDirection) return '方向背离';
  return '方向不明确';
}

function classifyDailyFunds(visibleNet, darkNet) {
  if (![visibleNet, darkNet].every(Number.isFinite)) return null;
  let rule;
  if (visibleNet > 0 && darkNet > 0) {
    rule = ['趋势流入', '明暗资金同步流入', '倾向做多', '主力持续吸筹，趋势一致。'];
  } else if (visibleNet < 0 && darkNet < 0) {
    rule = ['趋势流出', '明暗资金同步流出', '倾向做空', '主力持续出货，弱势延续。'];
  } else if (visibleNet < 0 && darkNet > 0) {
    rule = ['暗盘领跑', '暗盘强于明盘', '潜伏吸筹', '主力提前布局。'];
  } else if (visibleNet > 0 && darkNet < 0) {
    rule = ['明盘掩护', '明盘强、暗盘弱', '拉高派发', '借拉升完成出货。'];
  } else {
    rule = ['当日分歧', '当日明暗方向不一致', '短线博弈', '多空信号不一致。'];
  }
  return {
    fundSituation: rule[0],
    corePerformance: rule[1],
    interpretation: rule[2],
    description: rule[3],
    basis: '仅依据当日明盘与暗盘资金，未使用近5日资金数据。',
  };
}

function formatChinaTime(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(value)).replaceAll('/', '-');
}

function attachOrderContext(result, order) {
  const output = result || {};
  output.orderId = String((order && order.id) || '');
  output.stockCode = String((order && order.stockCode) || '');
  output.stockName = String((order && order.stockName) || '');
  output.queryDate = String((order && order.tradeDate) || '');
  output.requestedAt = Number((order && order.createdAt) || 0);
  output.requestedAtText = formatChinaTime(output.requestedAt);
  return output;
}

function closeEnough(left, right, reference) {
  if (![left, right, reference].every(Number.isFinite)) return null;
  const tolerance = Math.max(0.02, Math.abs(reference) * 0.01);
  return Math.abs(left - right) <= tolerance;
}

function normalizeAnalysis(raw) {
  const result = {
    stockName: String(raw.stockName || '').trim(),
    stockCode: String(raw.stockCode || '').trim(),
    capturedAt: String(raw.capturedAt || '').trim(),
    unit: String(raw.unit || '').trim(),
    mainNet: finiteNumber(raw.mainNet),
    visibleNet: finiteNumber(raw.visibleNet),
    darkNet: finiteNumber(raw.darkNet),
    retailNet: finiteNumber(raw.retailNet),
  };
  result.relation = relationFor(result.visibleNet, result.darkNet);
  result.processedResult = classifyDailyFunds(result.visibleNet, result.darkNet);

  const fundSumPassed = closeEnough(
    Number(result.visibleNet) + Number(result.darkNet),
    result.mainNet,
    result.mainNet,
  );
  const balancePassed = closeEnough(
    Number(result.mainNet) + Number(result.retailNet),
    0,
    Math.max(Math.abs(result.mainNet || 0), Math.abs(result.retailNet || 0)),
  );
  const requiredNumbersPresent = [result.mainNet, result.visibleNet, result.darkNet, result.retailNet]
    .every(Number.isFinite);
  const unitPassed = ['元', '万元', '亿元'].includes(result.unit);

  result.validation = {
    passed: requiredNumbersPresent && unitPassed && fundSumPassed === true && balancePassed === true,
    requiredNumbersPresent,
    unitPassed,
    fundSumPassed,
    balancePassed,
    fundSumExpression: requiredNumbersPresent
      ? `${result.visibleNet} + ${result.darkNet} = ${result.mainNet}`
      : '数值不完整，无法校验',
    balanceExpression: requiredNumbersPresent
      ? `${result.mainNet} + ${result.retailNet} = 0`
      : '数值不完整，无法校验',
  };
  return result;
}

async function analyzeDarkFundImage(imageUrl) {
  const apiKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
  if (!apiKey) {
    const error = new Error('服务器尚未配置 DeepSeek API Key');
    error.status = 503;
    throw error;
  }

  const filePath = uploadedImagePath(imageUrl);
  if (!filePath || !fs.existsSync(filePath)) {
    const error = new Error('请选择刚刚上传的图片');
    error.status = 400;
    throw error;
  }
  const mime = MIME_BY_EXT[path.extname(filePath).toLowerCase()];
  if (!mime) {
    const error = new Error('图片格式不支持');
    error.status = 415;
    throw error;
  }
  const imageData = fs.readFileSync(filePath).toString('base64');
  const prompt = '只识别图片中的截图时间和“主力流向”区域；股票名称和代码均由工单提供，不要从图片识别或推测。'
    + '仅输出JSON对象，必须严格使用这个结构：'
    + '{"capturedAt":"","unit":"亿元","mainNet":0,"visibleNet":0,"darkNet":0,"retailNet":0}。'
    + 'unit仅允许元、万元、亿元；金额使用图片标题中的原始单位，流出为负，流入为正；'
    + '不要根据颜色猜数值，不要推测图片未显示的数据。';

  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${imageData}`, detail: 'original' } },
          ],
        }],
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
        max_tokens: 1000,
      }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (cause) {
    const error = new Error(cause && cause.name === 'TimeoutError' ? 'DeepSeek 识别超时，请重试' : '无法连接 DeepSeek');
    error.status = 502;
    throw error;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error((payload.error && payload.error.message) || 'DeepSeek 识别失败');
    error.status = response.status === 401 ? 503 : 502;
    throw error;
  }

  let raw;
  try {
    raw = JSON.parse(cleanJsonText(payload.choices && payload.choices[0] && payload.choices[0].message.content));
  } catch (_) {
    const error = new Error('DeepSeek 未返回有效的结构化结果，请更换清晰图片后重试');
    error.status = 502;
    throw error;
  }
  return { model: MODEL, result: normalizeAnalysis(raw) };
}

module.exports = { analyzeDarkFundImage, attachOrderContext, classifyDailyFunds, normalizeAnalysis, uploadedImagePath };
