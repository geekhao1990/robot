const { spawn } = require('node:child_process');

class ReplayError extends Error {
  constructor(message, blocked = false) { super(message); this.blocked = blocked; }
}
// Never run shell commands or expose child output (which may contain credentials).
function run(command, args, { signal, timeout = 120000, line = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8');
    let buffer = '', output = '', failure;
    const stop = () => { failure = new ReplayError('任务已停止'); child.kill('SIGKILL'); };
    const timer = setTimeout(() => { failure = new ReplayError('处理超时，请检查服务器后重试'); child.kill('SIGKILL'); }, timeout);
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    child.stdout.on('data', chunk => {
      output = (output + chunk).slice(-65536);
      buffer += chunk.toString();
      if (buffer.length > 1024 * 1024) { failure = new ReplayError('工具返回内容异常', true); child.kill('SIGKILL'); return; }
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) { line(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
    });
    child.stderr.resume();
    const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); };
    child.on('error', () => { clean(); reject(new ReplayError('服务器工具未安装或无法执行', true)); });
    child.on('close', code => {
      clean(); if (buffer) line(buffer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new ReplayError('服务器工具执行失败，请检查安装和授权'));
      else resolve(output);
    });
  });
}
module.exports = { run, ReplayError };
