const fs = require('node:fs');
const { run, ReplayError } = require('./replay-process');

function cliPath() { return process.env.QUARK_CLI_PATH || ''; }
function safeMessage(message) {
  return String(message || '夸克操作失败').replace(/https?:\/\/\S+/g, '[链接已隐藏]')
    .replace(/(?:token|cookie|authorization|password)\s*[:=]\s*\S+/gi, '[授权信息已隐藏]').slice(0, 240);
}
async function call(args, { signal, onEvent = () => {}, timeout = 120000 } = {}) {
  const cli = cliPath();
  if (!cli || !fs.existsSync(cli)) throw new ReplayError('尚未配置夸克工具，请设置 QUARK_CLI_PATH 并完成授权', true);
  let result, eventFailure;
  const consume = line => {
    let event; try { event = JSON.parse(line); } catch { return; }
    if (event.type === 'result') result = event;
    try { onEvent(event); } catch (error) { eventFailure = error; }
  };
  let processError;
  try { await run(process.execPath, [cli, ...args], { signal, timeout, line: consume }); }
  catch (error) { processError = error; }
  if (eventFailure) throw eventFailure;
  if (result && result.code !== 0) {
    const message = safeMessage(result.msg);
    throw new ReplayError(message, /授权|认证|登录|token|空间|容量|超限|权限/i.test(message));
  }
  if (processError) throw processError;
  if (!result || result.code !== 0) throw new ReplayError('夸克工具没有返回明确成功结果，请检查工具版本', true);
  return result;
}
async function health(signal) {
  await call(['get-user-info'], { signal, timeout: 30000 });
  return true;
}
async function upload(file, job, signal, event, beforeStart = async () => {}) {
  // After a crash, reconcile the unique file name before resubmitting anything.
  if (job.uploadStartedAt && !job.fileId) {
    const records = [];
    await call(['upload', 'list'], { signal, onEvent: e => { if (e.type === 'list') records.push(e.data); } });
    const matches = records.filter(r => r.fileName === require('node:path').basename(file));
    if (matches.length !== 1 || !matches[0].recordId) throw new ReplayError('上次上传结果待核对，请在夸克确认文件后手动回填链接，避免重复上传', true);
    job.recordId = matches[0].recordId;
  }
  const args = job.recordId ? ['upload', 'resume', '--record-id', job.recordId] : ['upload', file];
  if (!job.recordId && process.env.QUARK_PARENT_FID) args.push('--parent-fid', process.env.QUARK_PARENT_FID);
  await beforeStart();
  const result = await call(args, { signal, timeout: 4 * 3600000, onEvent: event });
  const id = job.fileId || result.data?.fids?.[0];
  if (!id || !/^[\w-]{1,200}$/.test(id)) throw new ReplayError('夸克上传成功但未返回文件标识，请人工核对', true);
  return { fileId: id, notice: result.notice?.text ? safeMessage(result.notice.text) : '' };
}
function shareUrl(value) {
  let url; try { url = new URL(value); } catch { throw new ReplayError('夸克分享链接无效', true); }
  if (url.protocol !== 'https:' || url.hostname !== 'pan.quark.cn' || !url.pathname.startsWith('/s/') || url.username || url.password) throw new ReplayError('夸克分享链接无效', true);
  return url.href;
}
async function share(fileId, title, signal) {
  if (!/^[\w-]{1,200}$/.test(fileId)) throw new ReplayError('夸克文件标识无效', true);
  const result = await call(['share', fileId, '--title', title, '--url-type', '1', '--expired-type', '1'], { signal });
  return shareUrl(result.data?.share_url);
}
module.exports = { call, health, upload, share, shareUrl, safeMessage };
