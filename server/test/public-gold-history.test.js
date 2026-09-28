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
      { id: 'u2', goldExpire: 0 },
      { id: 'u3', goldExpire: 0, serviceExpire: now + 86400000 },
      { id: 'u4', goldExpire: 0, courseAccessPermanent: true },
    ],
    goldFingerRecords: records,
    goldFingerBanners: [],
    settings: { rewardedAdEnabled: true, featuredNoteId: 'g1' },
    userState: {},
    darkFundOrders: [{ id: 'DF001', userId: 'u1', noteId: 'dark_DF001' }],
    notes: [
      { id: 'g1', type: 'gold', visible: true, title: '金手指说明', content: '金手指内容', tags: [], author: { name: '作者' }, time: 2 },
      { id: 'n1', type: 'course', visible: true, free: false, title: '普通课程', content: '公开内容', tags: [], author: { name: '作者' }, time: 1 },
      { id: 'dark_DF001', type: 'material', visible: true, title: '私有暗盘', content: '暗盘内容', tags: ['暗盘资金'], authorId: 'dark-author', author: { name: '暗盘' }, time: 3 },
    ],
  };
  const goldAccess = (user) => !!(user && (Number(user.goldExpire) > Date.now() || Number(user.serviceExpire) > Date.now()));
  const mod = { exports: {} };
  const dependencyMap = {
    '../db': { get: () => data },
    '../auth': { userIdFor: (token) => /^Bearer u[1234]$/.test(token || '') ? token.slice(7) : '' },
    '../util': {
      goldAccess,
      pubUser: (x) => x,
      pubNote: (x) => x,
      pubSettings: (d) => ({
        rewardedAdEnabled: d.settings.rewardedAdEnabled,
        featuredNoteId: d.settings.featuredNoteId,
      }),
    },
    '../content-types': { typeLabel: () => '' },
    '../resource-links': { resourceList: (note) => note.id === 'n1' ? [{ provider: 'baidu', url: 'https://example.com' }] : [] },
    '../note-access': require('../src/note-access'),
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

test('gold notes and entry are visible to gold-card and service-package users', async () => {
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
    assert.equal((await call('/api/notes/g1', {}, token)).id, 'g1');
  }
  await assert.rejects(call('/api/notes/g1', {}, 'Bearer u4'), { status: 404 });
});

test('every registered user can fetch course resources', async () => {
  const { call } = setup();
  for (const token of ['Bearer u1', 'Bearer u2', 'Bearer u3', 'Bearer u4']) {
    assert.equal((await call('/api/notes/n1/resource', {}, token)).url, 'https://example.com');
  }
  await assert.rejects(call('/api/notes/n1/resource', {}, ''), { status: 401 });
});

test('暗盘笔记不进入公开列表且只有订单本人可直连访问', async () => {
  const { call } = setup();
  assert.equal((await call('/api/feed', {}, 'Bearer u1')).list.some((note) => note.id === 'dark_DF001'), false);
  assert.equal((await call('/api/search', { kw: '暗盘' }, 'Bearer u1')).length, 0);
  assert.equal((await call('/api/notes/dark_DF001', {}, 'Bearer u1')).id, 'dark_DF001');
  await assert.rejects(call('/api/notes/dark_DF001', {}, 'Bearer u2'), { status: 404 });
  await assert.rejects(call('/api/notes/dark_DF001', {}, ''), { status: 404 });
});
