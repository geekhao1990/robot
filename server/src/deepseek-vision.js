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
  output.queryDate = String((order && order.tradeDate) || '');
  output.requestedAt = Number((order && order.createdAt) || 0);
  output.requestedAtText = formatChinaTime(output.requestedAt);
  return output;
}

function displaySignedAmount(value, unit) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  const directionText = amount > 0 ? '净流入' : amount < 0 ? '净流出' : '基本持平';
  const amountText = Math.abs(amount).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  return amount === 0 ? directionText : `${directionText}${amountText}${unit}`;
}

function buildDarkFundReport(result) {
  const data = result || {};
  if (!data.validation || data.validation.passed !== true) return '';
  const date = String(data.queryDate || '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, y, m, d) => `${y}年${Number(m)}月${Number(d)}日`);
  const change = Number(data.pctChange);
  const changeText = change > 0 ? `上涨${Math.abs(change)}%` : change < 0 ? `下跌${Math.abs(change)}%` : '涨跌幅为0%';
  const hasPrice = Number.isFinite(data.price);
  let quoteLead = `${date}${data.capturedAt ? ` ${data.capturedAt}` : ''}，${data.stockName}（${data.stockCode}）`;
  if (hasPrice && data.quoteType === '收盘') quoteLead += `收盘报${data.price}元，全天${changeText}`;
  else if (hasPrice && data.capturedAt) quoteLead += `现报${data.price}元，${changeText}`;
  else if (hasPrice) quoteLead += `价格为${data.price}元，${changeText}`;
  else if (data.capturedAt) quoteLead += `截图显示，${changeText}`;
  else quoteLead += changeText;

  const quoteParts = [];
  if (Number.isFinite(data.turnoverAmount) && ['元', '万元', '亿元'].includes(data.turnoverAmountUnit)) {
    quoteParts.push(`成交额${data.turnoverAmount}${data.turnoverAmountUnit}`);
  }
  if (Number.isFinite(data.turnoverRate)) quoteParts.push(`换手率${data.turnoverRate}%`);
  const timingNote = data.quoteType === '收盘'
    ? '以上为收盘时点数据。'
    : data.quoteType === '盘中' ? '当前仍处于盘中，数据以截图时点为准。' : '';
  const processed = data.processedResult || {};
  return `${quoteLead}${quoteParts.length ? `，${quoteParts.join('，')}` : ''}。${timingNote}

从资金层面看，当日主力资金${displaySignedAmount(data.mainNet, data.unit)}，散户资金${displaySignedAmount(data.retailNet, data.unit)}；其中明盘大单资金${displaySignedAmount(data.visibleNet, data.unit)}，暗盘资金${displaySignedAmount(data.darkNet, data.unit)}，两者呈现${data.relation}。${processed.corePerformance || ''}${processed.description ? `，${processed.description}` : ''}

从当日资金结构看，本次识别结果归类为“${processed.fundSituation || data.relation}”。该结果仅客观反映截图时点的明盘与暗盘资金关系，不单独用于判断后续价格走势。

暗盘资金只看当日有局限性，建议结合连续5个交易日的暗盘数据进行判断。

风险提示：以上分析结果仅代表大模型观点，仅供参考，不作为投资建议。本文不涉及投资咨询，提及股票不视为明示或暗示推荐，也不应理解为对未来收益的预期或保证。每个指标都有局限性，请理性判断，注意风险。`;
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
    quoteType: ['盘中', '收盘'].includes(String(raw.quoteType || '').trim()) ? String(raw.quoteType).trim() : '',
    price: finiteNumber(raw.price),
    pctChange: finiteNumber(raw.pctChange),
    turnoverAmount: finiteNumber(raw.turnoverAmount),
    turnoverAmountUnit: String(raw.turnoverAmountUnit || '').trim(),
    turnoverRate: finiteNumber(raw.turnoverRate),
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
  const essentialFieldsPresent = Boolean(
    result.stockName && Number.isFinite(result.pctChange) && requiredNumbersPresent && unitPassed,
  );
  const quoteFieldsPresent = Boolean(
    result.stockName && result.capturedAt && result.quoteType
    && [result.price, result.pctChange, result.turnoverAmount, result.turnoverRate].every(Number.isFinite)
    && ['元', '万元', '亿元'].includes(result.turnoverAmountUnit),
  );

  result.validation = {
    passed: essentialFieldsPresent && fundSumPassed === true && balancePassed === true,
    essentialFieldsPresent,
    quoteFieldsPresent,
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
  result.validation.issues = [
    ...(result.stockName ? [] : ['股票名称缺失']),
    ...(Number.isFinite(result.pctChange) ? [] : ['涨跌幅缺失']),
    ...(requiredNumbersPresent ? [] : ['资金字段有缺失']),
    ...(unitPassed ? [] : ['资金单位有误']),
    ...(fundSumPassed === true ? [] : ['明盘与暗盘加总存在误差']),
    ...(balancePassed === true ? [] : ['主力与散户加总存在误差']),
  ];
  result.validation.optionalMissingFields = [
    ...(!result.capturedAt ? ['截图时间'] : []),
    ...(!result.quoteType ? ['行情类型'] : []),
    ...(!Number.isFinite(result.price) ? ['当前价/收盘价'] : []),
    ...(!(Number.isFinite(result.turnoverAmount) && ['元', '万元', '亿元'].includes(result.turnoverAmountUnit)) ? ['成交额'] : []),
    ...(!Number.isFinite(result.turnoverRate) ? ['换手率'] : []),
  ];
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
  const prompt = '这是一张手机长截图。识别图片中的股票名称、截图时间、当前价或收盘价、涨跌幅、成交额、换手率和“主力流向”区域；'
    + '股票代码由前台工单提供，不要从图片识别或推测代码。'
    + '仅输出JSON对象，必须严格使用这个结构：'
    + '{"stockName":"","capturedAt":"","quoteType":"盘中","price":null,"pctChange":null,"turnoverAmount":null,"turnoverAmountUnit":"亿元","turnoverRate":null,"unit":"亿元","mainNet":null,"visibleNet":null,"darkNet":null,"retailNet":null}。'
    + 'quoteType仅允许盘中或收盘；如图片明确显示已收盘或收盘价则填收盘，否则填盘中。'
    + 'pctChange和turnoverRate只填百分比数字，不带%；turnoverAmount保留图片数值，turnoverAmountUnit保留元、万元或亿元。'
    + 'unit是主力资金图表的单位，仅允许元、万元、亿元；资金流出为负，流入为正。'
    + '只填写图片中明确显示的数据，识别不到的字段必须填null或空字符串，不要根据颜色猜数值，不要推测。';

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

module.exports = {
  analyzeDarkFundImage,
  attachOrderContext,
  buildDarkFundReport,
  classifyDailyFunds,
  normalizeAnalysis,
  uploadedImagePath,
};
