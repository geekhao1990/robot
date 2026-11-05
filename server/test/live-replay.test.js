const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createWorker, summary, eligible } = require('../src/live-replay');
const { checkedUrl, mediaUrl, playlist } = require('../src/replay-media');
const { ReplayError } = require('../src/replay-process');
const quark = require('../src/replay-quark');

function setup(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-test-'));
  const previous = process.env.LIVE_REPLAY_WORK_DIR; process.env.LIVE_REPLAY_WORK_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.LIVE_REPLAY_WORK_DIR; else process.env.LIVE_REPLAY_WORK_DIR = previous; fs.rmSync(dir, { recursive: true, force: true }); });
  const data = { notes: [{ id: 'n1', type: 'live', title: '测试课', liveStartTime: '2026-11-05 09:00' }],
    liveTableRooms: { 123: { room: '123', noteId: 'n1', status: 3, hasReplay: true, future: false, play: '/livetable/play?room=123' } }, liveReplayConfig: { enabled: true } };
  const calls = { download: 0, merge: 0, upload: 0, share: 0, saves: 0 };
  const store = { get: () => data, save: async () => { calls.saves++; } };
  const adapters = {
    environment: async () => ({ ok: true, checks: [] }),
    media: { download: async (_room, _dir, _signal, progress) => { calls.download++; await progress({ percent: 100, current: 1, total: 1 }); return 20; },
      merge: async (_dir, file) => { calls.merge++; fs.writeFileSync(file, 'test-video'); } },
    quark: { upload: async (_file, _job, _signal, event, beforeStart) => { calls.upload++; await beforeStart(); event({ type: 'list', code: 0, data: { fileId: 'fid123', recordId: 'rec123' } }); return { fileId: 'fid123' }; },
      share: async () => { calls.share++; return 'https://pan.quark.cn/s/abc'; } },
    ...overrides,
  };
  return { dir, data, calls, adapters, worker: createWorker({ store, adapters }), store };
}

test('complete replay pipeline checkpoints file ID and backfills only after sharing', async t => {
  const s = setup(t);
  await s.worker.tick();
  assert.equal(s.data.notes[0].quarkUrl, 'https://pan.quark.cn/s/abc');
  assert.equal(s.data.liveReplayJobs['123'].state, 'complete');
  assert.equal(summary(s.data, s.data.notes[0]).label, '已回填');
  await s.worker.tick();
  assert.deepEqual([s.calls.download, s.calls.merge, s.calls.upload, s.calls.share], [1,1,1,1]);
  assert.equal(fs.existsSync(path.join(s.dir, '123', 'course-123.mp4')), false);
  assert.equal(fs.existsSync(path.join(s.dir, '123', 'checkpoint.json')), true);
});
test('source eligibility is independent of user-facing recording label', async t => {
  const s = setup(t); s.data.liveTableRooms[123].status = 1;
  await s.worker.tick(); assert.equal(s.calls.download, 0);
  assert.equal(summary(s.data, s.data.notes[0]).state, 'waiting');
  s.data.liveTableRooms[123].status = 3; s.data.liveTableRooms[123].hasReplay = false;
  assert.equal(eligible(s.data.liveTableRooms[123]), false);
  await assert.rejects(s.worker.retry('n1'), /已结束和可回放/);
});
test('disabled queue does not start, manual single-course trial is supported', async t => {
  const s = setup(t); s.data.liveReplayConfig.enabled = false;
  await s.worker.tick(); assert.equal(s.calls.download, 0);
  assert.equal(summary(s.data, s.data.notes[0]).label, '自动处理未启用');
  await s.worker.retry('n1'); await s.worker.tick(); assert.equal(s.calls.upload, 1);
});
test('missing Quark authorization blocks before downloading and enabling', async t => {
  const s = setup(t, { environment: async () => ({ ok: false, checks: [{ name: '夸克授权', ok: false, message: '未授权' }] }) });
  await s.worker.tick(); assert.equal(s.calls.download, 0);
  assert.equal(s.data.liveReplayJobs[123].state, 'blocked');
  assert.match(s.data.liveReplayJobs[123].error, /未授权/);
  await s.worker.tick(); assert.equal(s.data.liveReplayJobs[123].attempts, 1);
  await assert.rejects(s.worker.setEnabled(true), /未授权/);
});
test('sharing failure retries from saved FID, without reuploading', async t => {
  const s = setup(t); let failed = false;
  s.adapters.quark.share = async () => { s.calls.share++; if (!failed) { failed = true; throw new ReplayError('分享暂时失败'); } return 'https://pan.quark.cn/s/retry'; };
  await s.worker.tick(); assert.equal(s.data.notes[0].quarkUrl, undefined);
  assert.equal(s.data.liveReplayJobs[123].fileId, 'fid123');
  await s.worker.retry('n1'); await s.worker.tick();
  assert.equal(s.calls.upload, 1); assert.equal(s.calls.share, 2);
  assert.equal(s.data.notes[0].quarkUrl, 'https://pan.quark.cn/s/retry');
});
test('restart recovers upload checkpoint even if database save was lost', async t => {
  const s = setup(t);
  fs.mkdirSync(path.join(s.dir, '123'));
  fs.writeFileSync(path.join(s.dir, '123', 'checkpoint.json'), JSON.stringify({ room: '123', noteId: 'n1', state: 'uploading', fileId: 'saved-fid', updatedAt: Date.now() }));
  await s.worker.tick(); assert.equal(s.calls.upload, 0); assert.equal(s.calls.download, 0);
  assert.equal(s.calls.share, 1); assert.equal(s.data.notes[0].quarkUrl, 'https://pan.quark.cn/s/abc');
});
test('manual backfill and deletion during download prevent upload and overwrite', async t => {
  const s = setup(t);
  s.adapters.media.merge = async () => { s.data.notes[0].quarkUrl = 'https://pan.quark.cn/s/manual'; };
  await s.worker.tick(); assert.equal(s.calls.upload, 0);
  assert.equal(s.data.notes[0].quarkUrl, 'https://pan.quark.cn/s/manual');
});
test('concurrent ticks do not duplicate work', async t => {
  const s = setup(t);
  await Promise.all([s.worker.tick(), s.worker.tick(), s.worker.tick()]);
  assert.equal(s.calls.upload, 1);
});
test('retries stop automatically after three transient failures', async t => {
  const s = setup(t); s.adapters.media.download = async () => { throw new ReplayError('网络超时'); };
  for (let i = 0; i < 3; i++) {
    await s.worker.tick();
    const job = s.data.liveReplayJobs[123];
    job.nextAttemptAt = 0; job.updatedAt += 100;
  }
  await s.worker.tick(); assert.equal(s.data.liveReplayJobs[123].attempts, 3);
});
test('HLS parser rejects protected, incomplete, unknown-origin and unsupported streams', () => {
  const base = 'https://media.example/a/index.m3u8', allowed = new Set(['https://media.example']);
  const vod = '#EXTM3U\n#EXTINF:12,\n1.ts\n#EXT-X-ENDLIST';
  assert.equal(playlist(vod, base, allowed).duration, 12);
  assert.equal(playlist(vod, base, allowed).segments[0], 'https://media.example/a/1.ts');
  assert.throws(() => playlist(vod.replace('#EXT-X-ENDLIST',''), base, allowed), /尚未完整/);
  assert.throws(() => playlist(vod.replace('#EXTINF', '#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF'), base, allowed), /加密/);
  assert.throws(() => playlist(vod.replace('1.ts','http://127.0.0.1/private'), base, allowed), /允许/);
  assert.throws(() => checkedUrl('file:///etc/passwd', base, allowed), /允许/);
  assert.throws(() => playlist(vod.replace('#EXTINF','#EXT-X-MAP:URI="init"\n#EXTINF'), base, allowed), /暂不支持/);
  assert.equal(mediaUrl('const SRC = "https://media.example/a/index.m3u8?x=1&amp;y=2";', base), base + '?x=1&y=2');
  assert.throws(() => mediaUrl('<html>登录</html>', base), /未提供唯一/);
  assert.throws(() => quark.shareUrl('https://evil.example/s/abc'), /无效/);
});
test('admin script parses and renders actual replay state in its own column', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/admin/index.html'), 'utf8');
  for (const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
  assert.match(html, /<th>回放处理<\/th>/);
  assert.match(html, /检查回放接入/);
  assert.match(html, /data-replay-retry/);
  assert.match(html, /setTimeout\(refreshReplayStatus, 5000\)/);
});

function cliFixture(t) {
  const keys = ['QUARK_CLI_PATH','REPLAY_TEST_AUTH_FAIL','REPLAY_TEST_NO_RECORD'];
  const old = Object.fromEntries(keys.map(k => [k,process.env[k]]));
  t.after(() => { for (const k of keys) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } });
  process.env.QUARK_CLI_PATH = path.join(__dirname, 'fixtures/replay-quark.cjs');
}
test('Quark adapter reads real NDJSON framing and persists successful file IDs', async t => {
  cliFixture(t); const events = [], job = {}; let started = false;
  assert.equal(await quark.health(), true);
  const result = await quark.upload('course-123.mp4', job, undefined, e => events.push(e), async () => { started = true; });
  assert.equal(started, true); assert.equal(result.fileId, 'fixture-fid');
  assert(events.some(e => e.type === 'progress' && e.data.percent === 65));
  assert.equal(await quark.share('fixture-fid', '中文课程标题'), 'https://pan.quark.cn/s/fixture');
});
test('uncertain upload is reconciled by exact unique file name and resumed', async t => {
  cliFixture(t); const job = { uploadStartedAt: 123 }, events = [];
  await quark.upload('course-123.mp4', job, undefined, e => events.push(e));
  assert.equal(job.recordId, 'saved-record');
  assert.deepEqual(events.find(e => e.type === 'result').data.args, ['upload','resume','--record-id','saved-record']);
  process.env.REPLAY_TEST_NO_RECORD = '1';
  await assert.rejects(quark.upload('course-123.mp4', { uploadStartedAt: 123 }, undefined, () => {}), /待核对/);
});
test('expired Quark authorization is a blocking error, not a successful upload', async t => {
  cliFixture(t); process.env.REPLAY_TEST_AUTH_FAIL = '1';
  await assert.rejects(quark.health(), e => e.blocked && /未完成授权/.test(e.message));
});
