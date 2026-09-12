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
  const prompt = `读取图片中的股票与“主力流向”区域，只返回一个JSON对象，不要解释，不要Markdown。
字段必须为：
stockName：股票名称，识别不到返回空字符串；
stockCode：六位股票代码，识别不到返回空字符串；
capturedAt：图片显示的时间，识别不到返回空字符串；
unit：资金区域标题中的单位，只能是“元”“万元”或“亿元”；
mainNet：主力净流入；visibleNet：主力明盘；darkNet：主力暗盘；retailNet：散户流入。
所有金额保留图片原始单位和正负号，只返回数字，不带单位。流出必须为负数，流入必须为正数。不要根据颜色猜数值，不要补造图片中不存在的数据。`;

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
        response_format: { type: 'json_object' },
        max_tokens: 600,
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

module.exports = { analyzeDarkFundImage, normalizeAnalysis, uploadedImagePath };
