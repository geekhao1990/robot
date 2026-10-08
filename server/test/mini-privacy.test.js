const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const miniRoot = path.join(__dirname, '..', '..', 'miniprogram');

test('mini-program login requires an explicit unchecked agreement choice', () => {
  const wxml = fs.readFileSync(path.join(miniRoot, 'pages', 'login', 'login.wxml'), 'utf8');
  const script = fs.readFileSync(path.join(miniRoot, 'pages', 'login', 'login.js'), 'utf8');

  assert.doesNotMatch(wxml, /登录即代表同意/);
  assert.match(wxml, /checked="\{\{agreementAccepted\}\}"/);
  assert.match(wxml, /bindchange="onAgreementChange"/);
  assert.match(wxml, /catchtap="openUserAgreement"/);
  assert.match(wxml, /catchtap="openPrivacyPolicy"/);
  assert.match(script, /agreementAccepted:\s*false/);
  assert.match(script, /if \(!this\.data\.agreementAccepted\)/);
});

test('mini-program privacy and service terms are readable from the login page', () => {
  const app = fs.readFileSync(path.join(miniRoot, 'app.json'), 'utf8');
  const script = fs.readFileSync(path.join(miniRoot, 'pages', 'login', 'login.js'), 'utf8');
  const legal = fs.readFileSync(path.join(miniRoot, 'pages', 'legal', 'legal.js'), 'utf8');

  assert.match(app, /pages\/legal\/legal/);
  assert.match(script, /wx\.openPrivacyContract/);
  assert.match(script, /pages\/legal\/legal\?type=privacy/);
  assert.match(script, /pages\/legal\/legal\?type=terms/);
  assert.match(legal, /用户服务协议/);
  assert.match(legal, /隐私政策/);
  assert.match(legal, /相册权限/);
});
