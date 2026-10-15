const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('WeChat login requires explicit agreement; cancel never logs in', () => {
  let page, dialog, calls = 0, prompts = 0;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../miniprogram/pages/login/login.js'), 'utf8'), {
    require: () => ({ wechatAuthRemote: true }),
    Page: value => { page = value; },
    wx: { showModal: value => {
      assert.ok(value.confirmText.length <= 4, '微信确认按钮最多4字');
      assert.ok(value.cancelText.length <= 4, '微信取消按钮最多4字');
      dialog = value; prompts++;
    }, showLoading() {}, login() { calls++; } },
  });
  page.setData = (values, callback) => { Object.assign(page.data, values); if (callback) callback(); };
  page.onWechatLogin();
  page.onWechatLogin();
  assert.equal(prompts, 1);
  assert.equal(calls, 0);
  dialog.success({ confirm: false }); dialog.complete();
  assert.equal(page.data.agreementAccepted, false);
  assert.equal(calls, 0);
  page.onWechatLogin();
  dialog.success({ confirm: true }); dialog.complete();
  assert.equal(page.data.agreementAccepted, true);
  assert.equal(calls, 1);
});

test('modal failure unlocks retry without accepting or logging in', () => {
  let page, dialog, prompts = 0, toasts = 0;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../miniprogram/pages/login/login.js'), 'utf8'), {
    require: () => ({ wechatAuthRemote: true }), Page: value => { page = value; },
    console: { error() {} },
    wx: { showModal: value => { dialog = value; prompts++; }, showToast() { toasts++; }, login() { assert.fail('must not log in'); } },
  });
  page.onWechatLogin();
  dialog.fail({ errMsg: 'showModal:fail' });
  assert.equal(page.data.agreementAccepted, false);
  assert.equal(toasts, 1);
  page.onWechatLogin();
  assert.equal(prompts, 2);
});

test('gold poster entry, canvas and generators removed; dark funds poster retained', () => {
  for (const ext of ['js', 'wxml', 'wxss']) {
    const source = fs.readFileSync(path.join(__dirname, `../../miniprogram/pages/gold-finger/gold-finger.${ext}`), 'utf8');
    assert.doesNotMatch(source, /generateSharePoster|goldSharePosterCanvas|posterGenerating|history-poster|drawGoldSharePoster/);
  }
  const dark = fs.readFileSync(path.join(__dirname, '../../miniprogram/pages/dark-funds-result/dark-funds-result.wxml'), 'utf8');
  assert.match(dark, /bindtap="generateSharePoster"/);
});
