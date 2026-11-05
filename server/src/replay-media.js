const fs = require('node:fs');
const path = require('node:path');
const { run, ReplayError } = require('./replay-process');

function sourceConfig() {
  return { baseUrl: process.env.LIVETABLE_SOURCE_URL || process.env.GOLD_FINGER_SOURCE_URL,
    username: process.env.LIVETABLE_SOURCE_USERNAME || process.env.GOLD_FINGER_SOURCE_USERNAME,
    password: process.env.LIVETABLE_SOURCE_PASSWORD || process.env.GOLD_FINGER_SOURCE_PASSWORD };
}
function checkedUrl(value, base, allowed) {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !allowed.has(url.origin)) {
    throw new ReplayError('视频地址不在服务器允许的来源中，请核实后配置 LIVE_REPLAY_MEDIA_ORIGINS', true);
  }
  return url;
}
function mediaUrl(html, page) {
  const values = [...String(html).matchAll(/["']([^"'<>\s]+\.m3u8(?:\?[^"'<>\s]*)?)["']/gi)]
    .map(m => m[1].replace(/\\\//g, '/').replace(/\\u0026|&amp;/g, '&'));
  const unique = [...new Set(values.map(v => new URL(v, page).href))];
  if (unique.length !== 1) throw new ReplayError('回放页未提供唯一的 M3U8 地址，需要核对源站播放器接口', true);
  return unique[0];
}
function playlist(text, base, allowed) {
  const lines = text.trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (lines[0] !== '#EXTM3U') throw new ReplayError('源站未返回有效播放列表', true);
  if (lines.some(s => /^#EXT-X-(?:SESSION-)?KEY:/.test(s) && !/METHOD=NONE(?:,|$)/.test(s))) {
    throw new ReplayError('回放存在加密保护，请使用提供方授权的下载接口', true);
  }
  if (lines.some(s => /^#EXT-X-(MAP|BYTERANGE|MEDIA):/.test(s))) throw new ReplayError('暂不支持分离音轨或分段 MP4，请使用完整 TS 回放源', true);
  if (lines.some(s => s.startsWith('#EXT-X-STREAM-INF:'))) {
    const index = lines.findIndex(s => s.startsWith('#EXT-X-STREAM-INF:'));
    if (!lines[index + 1] || lines[index + 1].startsWith('#')) throw new ReplayError('主播放列表无效', true);
    return { variant: checkedUrl(lines[index + 1], base, allowed).href };
  }
  if (!lines.includes('#EXT-X-ENDLIST')) throw new ReplayError('回放尚未完整结束，稍后重试');
  const segments = lines.filter(s => !s.startsWith('#')).map(s => checkedUrl(s, base, allowed).href);
  if (!segments.length || segments.length > 5000) throw new ReplayError('回放分片数量不在安全范围内', true);
  const duration = lines.filter(s => s.startsWith('#EXTINF:')).reduce((n, s) => n + Number(s.slice(8).split(',')[0]), 0);
  if (!Number.isFinite(duration) || duration <= 0) throw new ReplayError('回放时长无效', true);
  return { segments, duration };
}
async function textBody(response, limit = 2 * 1024 * 1024) {
  let size = 0; const parts = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new ReplayError('源站页面超过安全大小限制', true);
    parts.push(chunk);
  }
  return Buffer.concat(parts).toString('utf8');
}
async function session(signal, settings = sourceConfig()) {
  if (!settings.baseUrl || !settings.username || !settings.password) throw new ReplayError('课程源站账号配置不完整', true);
  const origin = new URL(settings.baseUrl).origin;
  const allowed = new Set([origin, ...(process.env.LIVE_REPLAY_MEDIA_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)]);
  const login = await fetch(new URL('/login', origin), { method: 'POST', redirect: 'manual',
    signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: settings.username, password: settings.password }) });
  if (![302, 303].includes(login.status)) throw new ReplayError('课程源站登录失败，请检查账号授权', true);
  const cookie = (login.headers.getSetCookie?.() || [login.headers.get('set-cookie') || '']).map(s => s.split(';')[0]).filter(Boolean).join('; ');
  await login.body?.cancel();
  if (!cookie) throw new ReplayError('课程源站未返回登录会话', true);
  const get = async value => {
    let url = checkedUrl(value, origin, allowed);
    for (let redirect = 0; redirect < 4; redirect++) {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
        headers: url.origin === origin ? { Cookie: cookie } : {} });
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location) throw new ReplayError('视频重定向无效', true);
        url = checkedUrl(location, url, allowed); continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new ReplayError(`课程源站请求失败（HTTP ${response.status}）`, [401,403].includes(response.status)); }
      return { response, url: url.href };
    }
    throw new ReplayError('视频重定向次数过多', true);
  };
  return { get, allowed, origin };
}
async function download(room, dir, signal, progress) {
  if (!/^\d{1,16}$/.test(String(room.room)) || room.play !== `/livetable/play?room=${room.room}`) throw new ReplayError('回放入口无效', true);
  const client = await session(signal);
  const page = await client.get(room.play);
  let url = mediaUrl(await textBody(page.response), page.url), parsed;
  for (let depth = 0; depth < 4; depth++) {
    const result = await client.get(url);
    parsed = playlist(await textBody(result.response), result.url, client.allowed);
    if (!parsed.variant) break;
    url = parsed.variant;
  }
  if (!parsed?.segments) throw new ReplayError('播放列表嵌套过深', true);
  const maxBytes = Number(process.env.LIVE_REPLAY_MAX_BYTES) || 8 * 1024 ** 3;
  let total = 0; const names = [];
  for (let i = 0; i < parsed.segments.length; i++) {
    signal.throwIfAborted();
    const free = fs.statfsSync(dir);
    if (free.bavail * free.bsize < 512 * 1024 ** 2 + total) throw new ReplayError('服务器磁盘空间不足，请清理后重试', true);
    const name = `${String(i).padStart(5, '0')}.ts`, file = path.join(dir, name);
    const { response } = await client.get(parsed.segments[i]);
    const handle = await fs.promises.open(file, 'w', 0o600);
    let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.length; total += chunk.length;
        if (size > 256 * 1024 ** 2 || total > maxBytes) throw new ReplayError('视频超过配置的大小限制', true);
        await handle.writeFile(chunk);
      }
    } finally { await handle.close(); }
    if (!size) throw new ReplayError('源站返回空视频分片');
    const signature = Buffer.alloc(377), input = await fs.promises.open(file, 'r');
    try {
      const { bytesRead } = await input.read(signature, 0, signature.length, 0);
      if (bytesRead < 377 || signature[0] !== 0x47 || signature[188] !== 0x47 || signature[376] !== 0x47) {
        throw new ReplayError('回放分片不是有效 TS 视频，未执行合并和上传', true);
      }
    } finally { await input.close(); }
    names.push(name);
    await progress({ percent: Math.floor((i + 1) / parsed.segments.length * 100), current: i + 1, total: parsed.segments.length });
  }
  fs.writeFileSync(path.join(dir, 'segments.txt'), names.map(n => `file '${n}'`).join('\n'));
  return parsed.duration;
}
async function merge(dir, destination, duration, signal) {
  await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-nostdin', '-v', 'error', '-y', '-protocol_whitelist', 'file,pipe',
    '-f', 'concat', '-safe', '1', '-i', path.join(dir, 'segments.txt'), '-map', '0:v:0', '-map', '0:a?',
    '-c', 'copy', '-movflags', '+faststart', destination], { signal, timeout: 1800000 });
  const result = await run(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', destination], { signal });
  let actual;
  try { actual = Number(JSON.parse(result).format.duration); } catch { /* rejected below */ }
  if (!actual || Math.abs(actual - duration) > Math.max(10, duration * 0.02)) throw new ReplayError('合并后视频时长校验失败，未上传');
}
module.exports = { checkedUrl, mediaUrl, playlist, download, merge, sourceConfig };
