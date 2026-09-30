const test = require('node:test');
const assert = require('node:assert/strict');
const {
  activateService,
  refreshDarkFundQuota,
  setManualDarkFundQuota,
  consumeDarkFundQuota,
  refundDarkFundQuota,
} = require('../src/membership');

test('service package grants 15 uses per rolling 30-day period without stacking', () => {
  const september = Date.parse('2026-09-10T04:00:00Z');
  const october = Date.parse('2026-10-01T04:00:00Z');
  const nextPeriod = september + 30 * 86400000;
  const user = { darkFundManualRemaining: 3, darkFundRemaining: 3 };
  activateService(user, 'service_year', september);
  assert.equal(refreshDarkFundQuota(user, september).service, 15);
  const used = consumeDarkFundQuota(user, september);
  assert.equal(used.source, 'service');
  assert.equal(used.service, 14);
  assert.equal(used.manual, 3);
  activateService(user, 'service_month', september);
  assert.equal(refreshDarkFundQuota(user, september).service, 14);
  const nextMonth = refreshDarkFundQuota(user, october);
  assert.equal(nextMonth.service, 14);
  assert.equal(nextMonth.serviceExpireAt, nextPeriod);
  const reset = refreshDarkFundQuota(user, nextPeriod);
  assert.equal(reset.service, 15);
  assert.equal(reset.serviceExpireAt, nextPeriod + 30 * 86400000);
  assert.equal(reset.manual, 3);
  assert.equal(reset.total, 18);
});

test('expired service quota is void while permanent quota remains', () => {
  const now = Date.parse('2026-09-10T04:00:00Z');
  const user = {
    serviceExpire: now - 1,
    darkFundManualRemaining: 4,
    darkFundServiceRemaining: 7,
    darkFundServicePeriodStart: now - 10 * 86400000,
    darkFundServicePeriodExpire: now + 20 * 86400000,
    darkFundRemaining: 11,
  };
  const quota = refreshDarkFundQuota(user, now);
  assert.equal(quota.service, 0);
  assert.equal(quota.manual, 4);
  assert.equal(quota.total, 4);
  assert.equal(consumeDarkFundQuota(user, now).source, 'manual');
  refundDarkFundQuota(user, 'manual', now);
  assert.equal(refreshDarkFundQuota(user, now).manual, 4);
  setManualDarkFundQuota(user, 20, now);
  assert.equal(refreshDarkFundQuota(user, now + 40 * 86400000).manual, 20);
});

test('legacy VIP quota is preserved once as permanent quota', () => {
  const user = { darkFundManualRemaining: 4, darkFundVipRemaining: 7, darkFundVipMonth: '2026-09', darkFundRemaining: 11 };
  const quota = refreshDarkFundQuota(user);
  assert.equal(quota.manual, 11);
  assert.equal(user.darkFundVipRemaining, undefined);
  assert.equal(refreshDarkFundQuota(user).total, 11);
});
