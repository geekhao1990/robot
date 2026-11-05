const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const { courseState, isLiveCourse } = require('./live-course');
const { run, ReplayError } = require('./replay-process');
const media = require('./replay-media');
const quark = require('./replay-quark');

const LABELS = { waiting: '等待回放源', disabled: '自动处理未启用', queued: '等待处理',
  checking: '检查环境', downloading: '下载中', merging: '合并中', uploading: '上传夸克中',
  sharing: '生成分享链接', backfilling: '回填中', complete: '已回填', blocked: '需要处理', failed: '处理失败' };
const ACTIVE = new Set(['checking','downloading','merging','uploading','sharing','backfilling']);
function rootDir() { return path.resolve(process.env.LIVE_REPLAY_WORK_DIR || path.join(__dirname, '../data/live-replay')); }
function jobDir(room) {
  if (!/^\d{1,16}$/.test(String(room))) throw new ReplayError('课程标识无效', true);
  return path.join(rootDir(), String(room));
}
function eligible(room) { return !!room && Number(room.status) === 3 && room.hasReplay === true && room.future !== true && room.play === `/livetable/play?room=${room.room}`; }
function enabled(data) { return data.liveReplayConfig?.enabled === true; }
function roomFor(data, noteId) { return Object.values(data.liveTableRooms || {}).find(r => r.noteId === noteId); }
function summary(data, note) {
  if (!isLiveCourse(note)) return null;
  const room = roomFor(data, note.id), job = room && data.liveReplayJobs?.[room.room];
  const ready = courseState(note).livePlaybackAvailable;
  const state = ready ? 'complete' : job?.state || (!eligible(room) ? 'waiting' : enabled(data) ? 'queued' : 'disabled');
  return { state, label: LABELS[state] || '等待处理', progress: ACTIVE.has(state) ? job?.progress ?? null : null,
    error: ready ? '' : job?.error || '', notice: job?.notice || '', updatedAt: job?.updatedAt || null,
    nextAttemptAt: state === 'failed' && job?.attempts < 3 ? job?.nextAttemptAt || null : null,
    canRetry: !ready && eligible(room) && !ACTIVE.has(state) };
}
async function environment(signal) {
  const checks = [];
  const check = async (name, fn) => {
    try { await fn(); checks.push({ name, ok: true, message: '正常' }); }
    catch (e) { checks.push({ name, ok: false, message: quark.safeMessage(e.message) }); }
  };
  await check('课程源站配置', async () => {
    const c = media.sourceConfig();
    if (!c.baseUrl || !c.username || !c.password) throw new ReplayError('请配置课程源站账号');
  });
  await check('FFmpeg', () => run(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { signal, timeout: 10000 }));
  await check('FFprobe', () => run(process.env.FFPROBE_PATH || 'ffprobe', ['-version'], { signal, timeout: 10000 }));
  await check('工作目录', async () => {
    fs.mkdirSync(rootDir(), { recursive: true, mode: 0o700 });
    fs.accessSync(rootDir(), fs.constants.W_OK);
    const stat = fs.statfsSync(rootDir());
    if (stat.bavail * stat.bsize < 1024 ** 3) throw new ReplayError('可用磁盘不足 1GB');
  });
  await check('夸克授权', () => quark.health(signal));
  return { ok: checks.every(c => c.ok), checks, checkedAt: Date.now() };
}

// One API process per database is required (the existing DB is an in-memory snapshot).
// A filesystem lock also prevents accidentally starting a second local worker.
function createWorker({ store = db, adapters = { media, quark, environment }, now = Date.now } = {}) {
  let running = null, controller = null, timer = null, stopping = false;
  const data = () => store.get();
  const jobs = () => (data().liveReplayJobs ||= {});
  function checkpoint(job) {
    const dir = jobDir(job.room); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'checkpoint.tmp'), JSON.stringify(job), { mode: 0o600 });
    fs.renameSync(path.join(dir, 'checkpoint.tmp'), path.join(dir, 'checkpoint.json'));
  }
  async function update(job, fields) {
    Object.assign(job, fields, { updatedAt: now() }); checkpoint(job); await store.save();
  }
  function noteFor(job) { return data().notes.find(n => n.id === job.noteId && isLiveCourse(n)); }
  function stillNeeded(job) {
    const note = noteFor(job);
    if (!note) throw new ReplayError('笔记已删除或不再是直播课', true);
    return !courseState(note).livePlaybackAvailable;
  }
  async function execute(job, signal) {
    const dir = jobDir(job.room); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `course-${job.room}.mp4`);
    await update(job, { state: 'checking', error: '', progress: null, attempts: (job.attempts || 0) + 1 });
    const health = await adapters.environment(signal);
    if (!health.ok) throw new ReplayError(health.checks.filter(c => !c.ok).map(c => `${c.name}：${c.message}`).join('；'), true);
    if (!stillNeeded(job)) return update(job, { state: 'complete' });
    if (!job.fileId && (!job.merged || !fs.existsSync(file))) {
      if (job.uploadStartedAt) throw new ReplayError('本地视频缺失且已有上传记录，请人工核对夸克后回填', true);
      await update(job, { state: 'downloading', progress: 0 });
      let lastProgressSave = 0;
      const duration = await adapters.media.download(roomFor(data(), job.noteId), dir, signal,
        p => {
          Object.assign(job, { progress: p.percent, current: p.current, total: p.total, updatedAt: now() });
          if (now() - lastProgressSave > 5000 || p.percent === 100) { lastProgressSave = now(); return update(job, {}); }
        });
      await update(job, { state: 'merging', progress: null });
      await adapters.media.merge(dir, file, duration, signal);
      await update(job, { merged: true });
    }
    if (!stillNeeded(job)) return update(job, { state: 'complete' });
    if (!job.fileId) {
      await update(job, { state: 'uploading', progress: 0 });
      let lastSave = 0;
      const result = await adapters.quark.upload(file, job, signal, event => {
        if (event.type === 'progress') {
          job.progress = Math.max(0, Math.min(100, Number(event.data?.percent) || 0)); job.updatedAt = now();
          if (now() - lastSave > 5000) { checkpoint(job); lastSave = now(); }
        }
        if (event.type === 'list') {
          if (event.data?.recordId) job.recordId = event.data.recordId;
          if (event.code === 0 && event.data?.fileId) job.fileId = event.data.fileId;
          checkpoint(job);
        }
      }, () => update(job, { uploadStartedAt: job.uploadStartedAt || now() }));
      await update(job, { fileId: result.fileId, notice: result.notice || '', progress: 100 });
    }
    if (!stillNeeded(job)) return update(job, { state: 'complete' });
    if (!job.shareUrl) {
      await update(job, { state: 'sharing', progress: null });
      const url = await adapters.quark.share(job.fileId, noteFor(job).title, signal);
      await update(job, { shareUrl: quark.shareUrl(url) });
    }
    await update(job, { state: 'backfilling' });
    if (stillNeeded(job)) {
      const note = noteFor(job);
      note.quarkUrl = job.shareUrl;
      note.courseUrl = note.baiduUrl || note.quarkUrl;
      await store.save();
    }
    await update(job, { state: 'complete', error: '', progress: 100, completedAt: now() });
    // Remove only known, regenerable media after the link is safely persisted.
    for (const name of fs.readdirSync(dir)) {
      if (/^\d{5}\.ts$/.test(name) || name === 'segments.txt' || name === `course-${job.room}.mp4`) fs.unlinkSync(path.join(dir, name));
    }
  }
  function lock() {
    fs.mkdirSync(rootDir(), { recursive: true, mode: 0o700 });
    const file = path.join(rootDir(), 'worker.lock');
    if (fs.existsSync(file)) {
      const pid = Number(fs.readFileSync(file, 'utf8'));
      if (!Number.isInteger(pid) || pid <= 0) throw new ReplayError('工作锁异常，请管理员核对', true);
      try { process.kill(pid, 0); return null; }
      catch (e) { if (e.code !== 'ESRCH') return null; }
      fs.unlinkSync(file);
    }
    try { fs.writeFileSync(file, String(process.pid), { flag: 'wx', mode: 0o600 }); }
    catch (e) { if (e.code === 'EEXIST') return null; throw e; }
    return () => fs.unlinkSync(file);
  }
  async function processNext() {
    if (stopping) return;
    const release = lock(); if (!release) return;
    let job;
    try {
      // Restore checkpoints only after obtaining the exclusive worker lock.
      for (const room of Object.values(data().liveTableRooms || {})) {
        if (!eligible(room)) continue;
        const note = data().notes.find(n => n.id === room.noteId);
        if (!note || !isLiveCourse(note) || courseState(note).livePlaybackAvailable) continue;
        let current = jobs()[room.room];
        const saved = path.join(jobDir(room.room), 'checkpoint.json');
        if (fs.existsSync(saved)) {
          const disk = JSON.parse(fs.readFileSync(saved, 'utf8'));
          if (disk.room === room.room && disk.noteId === note.id && (!current || disk.updatedAt >= current.updatedAt)) current = jobs()[room.room] = disk;
        }
        if (!current && enabled(data())) current = jobs()[room.room] = { room: room.room, noteId: note.id, state: 'queued', attempts: 0, updatedAt: now() };
        if (current && ACTIVE.has(current.state)) { current.state = 'queued'; current.error = '服务重启，等待恢复'; }
      }
      job = Object.values(jobs()).find(j => {
        const note = noteFor(j);
        if (!note || courseState(note).livePlaybackAvailable || !eligible(roomFor(data(), j.noteId))) return false;
        if (!enabled(data()) && !j.manual) return false;
        return j.state === 'queued' || (j.state === 'failed' && j.attempts < 3 && j.nextAttemptAt <= now());
      });
      if (!job) return;
      controller = new AbortController();
      try { await execute(job, controller.signal); }
      catch (e) {
        await update(job, { state: e.blocked ? 'blocked' : 'failed', error: e instanceof ReplayError ? quark.safeMessage(e.message) : '任务执行失败，请检查网络或服务器后重试',
          progress: null, nextAttemptAt: now() + Math.min(30, 5 * (job.attempts || 1)) * 60000 });
      } finally { controller = null; }
    } finally { release(); }
  }
  function tick() {
    if (running || stopping) return running || Promise.resolve();
    running = processNext().finally(() => { running = null; }); return running;
  }
  async function retry(noteId) {
    const note = data().notes.find(n => n.id === noteId), room = roomFor(data(), noteId);
    if (!note || !isLiveCourse(note)) throw new ReplayError('课程笔记不存在', true);
    if (courseState(note).livePlaybackAvailable) throw new ReplayError('已回填夸克链接，无需重复处理', true);
    if (!eligible(room)) throw new ReplayError('上游尚未同时标记已结束和可回放，请先同步课程', true);
    let previous = jobs()[room.room];
    if (running || (previous && ACTIVE.has(previous.state))) throw new ReplayError('当前有任务正在处理，请稍后再试', true);
    const health = await adapters.environment(new AbortController().signal);
    if (!health.ok) throw new ReplayError(health.checks.filter(c => !c.ok).map(c => `${c.name}：${c.message}`).join('；'), true);
    if (running) throw new ReplayError('当前有任务正在处理，请稍后再试', true);
    const saved = path.join(jobDir(room.room), 'checkpoint.json');
    if (fs.existsSync(saved)) {
      const disk = JSON.parse(fs.readFileSync(saved, 'utf8'));
      if (disk.room === room.room && disk.noteId === noteId && (!previous || disk.updatedAt >= previous.updatedAt)) previous = disk;
    }
    const job = previous || { room: room.room, noteId, attempts: 0 };
    jobs()[room.room] = job;
    await update(job, { state: 'queued', manual: true, attempts: 0, error: '', nextAttemptAt: 0 });
    return summary(data(), note);
  }
  return { tick, retry, environment: () => adapters.environment(new AbortController().signal),
    list: () => ({ enabled: enabled(data()), running: !!running, items: data().notes.filter(isLiveCourse).map(n => ({ noteId: n.id, ...summary(data(), n) })) }),
    async setEnabled(value) {
      if (value) { const health = await this.environment(); if (!health.ok) throw new ReplayError(health.checks.filter(c => !c.ok).map(c => `${c.name}：${c.message}`).join('；'), true); }
      data().liveReplayConfig = { ...data().liveReplayConfig, enabled: value === true }; await store.save();
      return { enabled: enabled(data()) };
    },
    start() { if (timer) return; stopping = false; const check = () => tick().catch(() => console.error('[课程回放] 任务检查失败')); timer = setInterval(check, 30000); timer.unref?.(); check(); },
    async stop() { stopping = true; clearInterval(timer); timer = null; controller?.abort(); await running; } };
}
module.exports = Object.assign(createWorker(), { createWorker, summary, eligible, LABELS });
