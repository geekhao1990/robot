const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const tick = () => new Promise(resolve => setImmediate(resolve));
function adHarness(options = {}) {
  const callbacks = {}, timers = new Map(), counts = { show: 0, destroy: 0 };
  let timerId = 0;
  const ad = {
    onClose: fn => { callbacks.close = fn; }, onError: fn => { callbacks.error = fn; },
    offClose: () => { counts.offClose = (counts.offClose || 0) + 1; }, offError: () => {},
    destroy: () => { counts.destroy++; },
    load: () => options.failLoad ? Promise.reject(new Error('load')) : Promise.resolve(),
    show: () => { counts.show++; return options.failShow ? Promise.reject(new Error('show')) : Promise.resolve(); },
  };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../miniprogram/utils/rewarded-preview'), 'utf8'), {
    module: mod, setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
  });
  const run = mod.exports.showRewardedPreview(options.noSdk ? {} : { createRewardedVideoAd: () => ad }, options.id || 'adunit-test');
  return { run, callbacks, counts, timers };
}

test('金手指预览：必须明确完整播放；提前关闭、缺失结果不放行', async () => {
  for (const [result, expected] of [[{ isEnded: true }, 'completed'], [{ isEnded: false }, 'skipped'], [undefined, 'skipped'], [{}, 'skipped']]) {
    const { run, callbacks, counts, timers } = adHarness();
    await tick();
    assert.equal(counts.show, 1);
    assert.equal(timers.size, 0);
    callbacks.close(result);
    assert.equal(await run.promise, expected);
    callbacks.close({ isEnded: true });
    assert.equal(counts.destroy, 1);
    assert.equal(counts.offClose, 1);
  }
});

test('广告不可用、加载失败、展示失败和超时均不放行；离开页取消', async () => {
  for (const options of [{ noSdk: true }, { id: 'adunit-xxxxxxxx' }, { failLoad: true }, { failShow: true }]) {
    assert.equal(await adHarness(options).run.promise, 'unavailable');
  }
  const timed = adHarness();
  [...timed.timers.values()][0]();
  assert.equal(await timed.run.promise, 'unavailable');
  await tick();
  assert.equal(timed.counts.show, 0);
  const cancelled = adHarness();
  cancelled.run.cancel();
  assert.equal(await cancelled.run.promise, 'cancelled');
  await tick();
  assert.equal(cancelled.counts.show, 0);
});

function pageHarness(options = {}) {
  const filename = require.resolve('../../miniprogram/pages/dark-funds-result/dark-funds-result');
  const calls = { settings: 0, preview: 0, ad: 0, toast: [] };
  let page, resolveAd, cancelAd;
  const api = {
    getAppSettings: async () => { calls.settings++; return { goldAccess: false, goldRewardedVideoAdUnitId: 'adunit-test', ...options.settings }; },
    getGoldFingerPreview: async () => {
      calls.preview++;
      if (options.error) throw options.error;
      return { record: options.empty ? null : { date: '2026-11-04', yang: 13, finger: 'silver', trend: 'down', position: 30 }, isToday: true };
    },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page: p => { page = p; }, wx: { showToast: value => calls.toast.push(value.title) },
    require: name => name === '../../utils/api' ? api : name === '../../utils/rewarded-preview' ? {
      showRewardedPreview: () => {
        calls.ad++;
        const promise = new Promise(resolve => { resolveAd = resolve; });
        cancelAd = () => resolveAd('cancelled');
        return { promise, cancel: cancelAd };
      },
    } : require(path.resolve(path.dirname(filename), name)),
  });
  page.setData = data => Object.assign(page.data, data);
  return { page, calls, complete: status => resolveAd(status) };
}

test('非会员看完广告后才能请求最新一期和打开弹窗，不跳页不请求会员历史', async () => {
  const { page, calls, complete } = pageHarness();
  const pending = page.openGoldPreview();
  await page.openGoldPreview(); // repeated tap is ignored
  await tick();
  assert.equal(calls.ad, 1);
  assert.equal(calls.preview, 0);
  assert.equal(page.data.goldPreviewModal, false);
  complete('completed');
  await pending;
  assert.equal(calls.preview, 1);
  assert.equal(page.data.goldPreviewModal, true);
  assert.equal(page.data.goldPreviewLoading, false);
  assert.equal(page.data.goldPreviewRecords.length, 1);
  const record = page.data.goldPreviewRecords[0];
  assert.equal(record.yang, 13);
  assert.equal(record.yin, 87);
  assert.equal(record.finger, 'silver');
  assert.match(record.fingerIcon, /up_1787930384616/);
  assert.equal(record.trendIcon, '/images/trend-down.png');
  assert.equal(record.position, 30);
  page.closeGoldPreview();
  assert.equal(page.data.goldPreviewModal, false);
});

test('中途关闭或失败不请求接口，返回页面不晚弹；空数据和网络错误可重试', async () => {
  for (const status of ['skipped', 'unavailable']) {
    const { page, calls, complete } = pageHarness();
    const pending = page.openGoldPreview();
    await tick(); complete(status); await pending;
    assert.equal(calls.preview, 0);
    assert.equal(page.data.goldPreviewModal, false);
    assert.equal(page.data.goldPreviewLoading, false);
  }
  const unloading = pageHarness();
  const pending = unloading.page.openGoldPreview();
  await tick(); unloading.page.onUnload(); await pending;
  assert.equal(unloading.calls.preview, 0);
  assert.equal(unloading.page.data.goldPreviewModal, false);
  for (const options of [{ empty: true }, { error: { statusCode: 500 } }]) {
    const { page, complete } = pageHarness(options);
    const pending = page.openGoldPreview();
    await tick(); complete('completed'); await pending;
    assert.equal(page.data.goldPreviewModal, false);
    assert.equal(page.data.goldPreviewLoading, false);
  }
  const disabled = pageHarness({ settings: { goldFingerEntryEnabled: false } });
  await disabled.page.openGoldPreview();
  assert.equal(disabled.calls.ad, 0);
});

test('弹窗和原详情共用同一张点金表、图标和字号，不再单独绘制UI', () => {
  const root = path.join(__dirname, '../../miniprogram');
  const table = fs.readFileSync(path.join(root, 'templates/gold-finger-table.wxml'), 'utf8');
  for (const label of ['日期', '阳谱', '阴谱', '点金', '趋势', '建议仓位']) assert.ok(table.includes(label));
  for (const page of ['dark-funds-result', 'gold-finger']) {
    const markup = fs.readFileSync(path.join(root, `pages/${page}/${page}.wxml`), 'utf8');
    assert.match(markup, /import src="..\/..\/templates\/gold-finger-table.wxml"/);
    assert.match(markup, /template is="gold-finger-table"/);
    assert.doesNotMatch(markup, /gold-preview-number|gold-preview-meter/);
    assert.match(fs.readFileSync(path.join(root, `pages/${page}/${page}.wxss`), 'utf8'), /@import "..\/..\/styles\/gold-finger-table.wxss"/);
  }
});
