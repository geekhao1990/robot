const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

test('mini-program gold entry, refresh and course resource rules match the rebuilt entitlement flow', () => {
  const detail = read('miniprogram/pages/detail/detail.js');
  const goldPage = read('miniprogram/pages/gold-finger/gold-finger.js');
  const darkPage = read('miniprogram/pages/dark-funds/dark-funds.js');
  const darkView = read('miniprogram/pages/dark-funds/dark-funds.wxml');
  const api = read('miniprogram/utils/api.js');

  assert.match(detail, /金手指会员（360天）/);
  assert.match(detail, /¥99\.00/);
  assert.doesNotMatch(detail, /_skipGoldRewardedAdOnce/);
  assert.match(detail, /note\.type === 'course' && this\.data\.note\.free !== true/);
  assert.match(detail, /return this\.handleGetResource\(false\)/);
  assert.match(detail, /if \(this\.hasGoldAccess\(user\)\) return this\.showResource\(\)/);

  assert.match(goldPage, /this\.showGoldRewardedAd\(\)\.then/);
  assert.match(goldPage, /refreshGoldFinger\(\)[\s\S]*this\.showGoldInterstitialForRefresh\(\)/);
  assert.doesNotMatch(goldPage, /refreshGoldFinger\(\)[\s\S]*serviceActive[\s\S]*showGoldRewardedAd/);

  assert.match(darkView, /金手指查暗盘/);
  assert.match(darkPage, /prepareGoldQuery/);
  assert.match(darkPage, /goldDarkFundAvailable/);
  assert.match(api, /queryMode === 'gold'/);
});
