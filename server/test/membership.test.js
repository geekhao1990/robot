const test = require('node:test');
const assert = require('node:assert/strict');
const {
  refreshDarkFundQuota,
  setManualDarkFundQuota,
  consumeDarkFundQuota,
  refundDarkFundQuota,
} = require('../src/membership');

test('dark-fund quota is manual-only and never resets by month', () => {
  const user = { darkFundManualRemaining: 3, darkFundRemaining: 3 };
  const used = consumeDarkFundQuota(user, Date.parse('2026-09-10T04:00:00Z'));
  assert.equal(used.source, 'manual');
  assert.equal(used.total, 2);
  assert.equal(refreshDarkFundQuota(user, Date.parse('2026-10-10T04:00:00Z')).total, 2);
  refundDarkFundQuota(user, used.source);
  assert.equal(refreshDarkFundQuota(user).total, 3);
});

test('legacy VIP quota is preserved once as permanent manual quota', () => {
  const user = { darkFundManualRemaining: 4, darkFundVipRemaining: 7, darkFundVipMonth: '2026-09', darkFundRemaining: 11 };
  const quota = refreshDarkFundQuota(user);
  assert.equal(quota.vip, 0);
  assert.equal(quota.manual, 11);
  assert.equal(user.darkFundVipRemaining, 0);
  assert.equal(refreshDarkFundQuota(user).total, 11);
});

test('admin can set the exact permanent query quota', () => {
  const user = { darkFundRemaining: 0 };
  setManualDarkFundQuota(user, 20);
  assert.equal(refreshDarkFundQuota(user).manual, 20);
  assert.equal(refreshDarkFundQuota(user).total, 20);
});
