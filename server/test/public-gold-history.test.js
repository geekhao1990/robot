const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRouter, HttpError } = require('../src/router');

function setup() {
  const records = [];
  for (let day = 1; records.length < 23; day += 1) {
    const date = new Date(Date.UTC(2026, 8, day));
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
    records.push({
      date: date.toISOString().slice(0, 10),
      finger: 'gold',
      position: 50,
      trend: 'up',
      yang: 50,
    });
  }
  const now = Date.now();
  const data = {
    users: [
      { id: 'u1', goldExpire: now + 86400000 },
      { id: 'u2', goldExpire: 0, vip: false },
      { id: 'u3', goldExpire: 0, vip: true, vipExpire: now + 86400000 },
    ],
    goldFingerRecords: records,
    goldFingerBanners: [],
    settings: { vipEnabled: true, rewardedAdEnabled: true, featuredNoteId: 'g1' },
    userState: {},
    notes: [
      { id: 'g1', type: 'gold', visible: true, title: '金手指说明', content: '金手指内容', tags: [], author: { name: '作者' }, time: 2 },
      { id: 'n1', type: 'course', visible: true, free: false, title: '普通课程', content: '公开内容', tags: [], author: { name: '作者' }, time: 1 },
    ],
  };
  const vipActive = (user) => !!(user && user.vip && Number(user.vipExpire) > Date.now());
  const goldAccess = (user) => !!(user && (Number(user.goldExpire) > Date.now() || vipActive(user)));
  const mod = { exports: {} };
  const dependencyMap = {
    '../db': { get: () => data },
    '../auth': { userIdFor: (token) => /^Bearer u[123]$/.test(token || '') ? token.slice(7) : '' },
    '../util': {
      vipActive,
      goldAccess,
      pubUser: (x) => x,
      pubNote: (x) => x,
      pubSettings: (d) => ({
        vipEnabled: d.settings.vipEnabled,
        rewardedAdEnabled: d.settings.rewardedAdEnabled,
        featuredNoteId: d.settings.featuredNoteId,
      }),
    },
    '../content-types': { typeLabel: () => '' },
    '../resource-links': { resourceList: (note) => note.id === 'n1' ? [{ provider: 'baidu', url: 'https://example.com' }] : [] },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/routes/public.js'), 'utf8'), {
    module: mod,
    require: (id) => dependencyMap[id] || require(id),
  });
  const router = createRouter();
  mod.exports(router, HttpError);
  const call = (pathname, query = {}, token = 'Bearer u1') => {
    const route = router.match('GET', pathname);
    return Promise.resolve().then(() => route.handler({
      query,
      params: route.params,
      headers: { authorization: token },
    }));
  };
  return { records, data, call };
}

test('gold finger history returns fixed pages of 10 records', async () => {
  const { records, call } = setup();
  const first = await call('/api/gold-finger/history', { page: '1', size: '99' });
  assert.equal(first.records.length, 10);
  assert.equal(first.pageSize, 10);
  assert.equal(first.total, 23);
  assert.equal(first.totalPages, 3);
  assert.equal(first.hasPrev, false);
  assert.equal(first.hasNext, true);
  assert.equal(first.records[0].date, records[22].date);

  const last = await call('/api/gold-finger/history', { page: '3' });
  assert.equal(last.records.length, 3);
  assert.equal(last.hasPrev, true);
  assert.equal(last.hasNext, false);
  await assert.rejects(call('/api/gold-finger/history', { page: '1' }, ''), { status: 401 });
  await assert.rejects(call('/api/gold-finger/history', { page: '1' }, 'Bearer u2'), { status: 403 });
});

test('gold notes and entry are visible only to gold or VIP users', async () => {
  const { call } = setup();
  const anonymousSettings = await call('/api/settings', {}, '');
  assert.equal(anonymousSettings.goldAccess, false);
  assert.equal(anonymousSettings.featuredNoteId, '');
  assert.equal((await call('/api/feed', {}, '')).list.map((note) => note.id).join(','), 'n1');
  assert.equal((await call('/api/search', { kw: '金手指' }, 'Bearer u2')).map((note) => note.id).join(','), '');
  await assert.rejects(call('/api/notes/g1', {}, 'Bearer u2'), { status: 404 });

  for (const token of ['Bearer u1', 'Bearer u3']) {
    const settings = await call('/api/settings', {}, token);
    assert.equal(settings.goldAccess, true);
    assert.equal(settings.featuredNoteId, 'g1');
    assert.equal((await call('/api/feed', {}, token)).list.map((note) => note.id).join(','), 'g1,n1');
    assert.equal((await call('/api/notes/g1', {}, token)).id, 'g1');
  }
});

test('VIP master switch only controls paid ordinary note validation', async () => {
  const { data, call } = setup();
  await assert.rejects(call('/api/notes/n1/resource', {}, 'Bearer u2'), { status: 403 });
  data.settings.vipEnabled = false;
  const result = await call('/api/notes/n1/resource', {}, 'Bearer u2');
  assert.equal(result.url, 'https://example.com');
});
