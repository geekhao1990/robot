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
    wx: { showModal: value => { dialog = value; prompts++; }, showLoading() {}, login() { calls++; } },
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
