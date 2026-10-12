// wx.request 的 errMsg 可能只是 request:ok，应优先显示服务端错误。
function darkFundError(error, fallback = '接口未返回错误详情') {
  const candidates = [error && error.data && error.data.error, error && error.message, error && error.errMsg];
  const message = candidates.find(value => typeof value === 'string' && value.trim() && !/^(request|require)\s*:\s*ok$/i.test(value.trim()));
  if (message) {
    if (/timeout/i.test(message)) return '请求超时，未收到查询结果；请先检查查询记录，避免重复提交';
    return message.trim();
  }
  const status = Number(error && error.statusCode);
  return status ? `${fallback}（HTTP ${status}）` : fallback;
}
module.exports = { darkFundError };
