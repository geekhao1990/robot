const test = require('node:test');
const assert = require('node:assert/strict');
const {
  activateMembership,
  chinaMonthKey,
  refreshDarkFundQuota,
  setManualDarkFundQuota,
  consumeDarkFundQuota,
} = require('../src/membership');

test('VIP dark-fund quota resets to 10 each China calendar month without stacking', () => {
  const september = Date.parse('2026-09-10T04:00:00Z');
  const october = Date.parse('2026-10-01T04:00:00Z');
  const user = {
    vip: true,
    vipExpire: Date.parse('2026-10-20T04:00:00Z'),
    darkFundManualRemaining: 3,
    darkFundVipRemaining: 2,
    darkFundVipMonth: chinaMonthKey(september),
    darkFundRemaining: 5,
  };

  const used = consumeDarkFundQuota(user, september);
  assert.equal(used.source, 'vip');
  assert.equal(used.vip, 1);
  assert.equal(used.manual, 3);

  activateMembership(user, 'month', september);
  assert.equal(refreshDarkFundQuota(user, september).vip, 1);

  const nextMonth = refreshDarkFundQuota(user, october);
  assert.equal(nextMonth.vip, 10);
  assert.equal(nextMonth.manual, 3);
  assert.equal(nextMonth.total, 13);
});

test('expired VIP quota is void while admin quota remains permanent', () => {
  const now = Date.parse('2026-09-10T04:00:00Z');
  const user = {
    vip: true,
    vipExpire: now - 1,
    darkFundManualRemaining: 4,
    darkFundVipRemaining: 7,
    darkFundVipMonth: chinaMonthKey(now),
    darkFundRemaining: 11,
  };

  const quota = refreshDarkFundQuota(user, now);
  assert.equal(quota.vip, 0);
  assert.equal(quota.manual, 4);
  assert.equal(quota.total, 4);
  assert.equal(consumeDarkFundQuota(user, now).source, 'manual');
  assert.equal(refreshDarkFundQuota(user, now).manual, 3);

  setManualDarkFundQuota(user, 20, now);
  assert.equal(refreshDarkFundQuota(user, now + 40 * 86400000).manual, 20);
});

test('new VIP activation grants exactly 10 current-month uses', () => {
  const now = Date.parse('2026-09-10T04:00:00Z');
  const user = { vip: false, vipExpire: 0, darkFundRemaining: 0 };
  activateMembership(user, 'month', now);
  const quota = refreshDarkFundQuota(user, now);
  assert.equal(quota.vip, 10);
  assert.equal(quota.manual, 0);
  assert.equal(quota.total, 10);
});
