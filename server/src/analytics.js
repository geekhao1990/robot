const MAX_EVENTS = 50000;

function events(data) {
  data.analyticsEvents = Array.isArray(data.analyticsEvents) ? data.analyticsEvents : [];
  return data.analyticsEvents;
}

function record(data, event) {
  const list = events(data);
  list.push({ ...event, createdAt: Number(event.createdAt) || Date.now() });
  if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS);
}

function classifyFailure(error) {
  const message = String(error && error.message || error || '未知异常');
  if (/额度|次数.*用完/.test(message)) return '额度不足';
  if (/采集机|采集器|ECONNREFUSED|collector/i.test(message)) return '采集器异常';
  if (/格式|缺失|为空|重复|误差|不匹配|不是交易日|明细超过/.test(message)) return '数据校验失败';
  if (/超时|abort|timeout/i.test(message)) return '接口超时';
  if (/登录|账号|密码|配置/.test(message)) return '接口配置异常';
  return '接口异常';
}

module.exports = { classifyFailure, events, record };
