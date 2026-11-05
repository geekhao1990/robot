const test = require('node:test');
test('existing monthly periods with stored 49 limit immediately use 99 without renewal', () => {
  const { closeDarkFundDailyLimit, assertCloseDarkFundDailyLimit } = require('../src/membership');
  const assert = require('node:assert/strict');
  const now = Date.parse('2026-11-05T12:00:00+08:00');
  for (const user of [
    { id: 'u', darkFundCloseDailyLimit: 49 },
    { id: 'u', darkFundClosePeriods: [{ until: now + 86400000, dailyLimit: 49 }] },
  ]) {
    assert.equal(closeDarkFundDailyLimit(user, now), 99);
    const orders = Array.from({ length: 98 }, () => ({ userId: 'u', createdAt: now, quotaSource: 'close_month', status: 'READY' }));
    assert.doesNotThrow(() => assertCloseDarkFundDailyLimit(user, orders, now));
    orders.push(orders[0]);
    assert.throws(() => assertCloseDarkFundDailyLimit(user, orders, now), { status: 429 });
  }
});
test('week and month renewals preserve each purchased period limit without bypass or lost benefits', () => {
  const { activateCloseDarkFund, closeDarkFundDailyLimit } = require('../src/membership');
  const assert = require('node:assert/strict');
  const now = Date.parse('2026-11-04T10:00:00+08:00'), day = 86400000;
  for (const durations of [[7,30],[30,7]]) {
    const user = {};
    activateCloseDarkFund(user, now, durations[0]);
    activateCloseDarkFund(user, now, durations[1]);
    assert.equal(user.darkFundCloseExpire, now + 37 * day);
    assert.equal(closeDarkFundDailyLimit(user, now), durations[0] === 7 ? 0 : 99);
    assert.equal(closeDarkFundDailyLimit(user, now + durations[0] * day), durations[1] === 7 ? 0 : 99);
  }
});
test('monthly limit resets at Beijing midnight and ignores failures and other users', () => {
  const { assertCloseDarkFundDailyLimit, closeDarkFundDay } = require('../src/membership');
  const assert = require('node:assert/strict');
  const now = Date.parse('2026-11-04T23:59:59+08:00');
  const user = { id: 'u1' };
  const orders = Array.from({ length: 99 }, () => ({ userId: 'u1', createdAt: now, quotaSource: 'close_month', status: 'READY' }));
  assert.throws(() => assertCloseDarkFundDailyLimit(user, orders, now), { status: 429 });
  assert.doesNotThrow(() => assertCloseDarkFundDailyLimit(user, orders, now + 1000));
  user.darkFundCloseUnlockedDate = closeDarkFundDay(now - 86400000);
  assert.throws(() => assertCloseDarkFundDailyLimit(user, orders, now), { status: 429 });
  user.darkFundCloseUnlockedDate = closeDarkFundDay(now);
  assert.doesNotThrow(() => assertCloseDarkFundDailyLimit(user, orders, now));
  delete user.darkFundCloseUnlockedDate;
  orders[0].status = 'FAILED';
  orders.push({ userId: 'u2', createdAt: now, quotaSource: 'close_month', status: 'READY' });
  assert.doesNotThrow(() => assertCloseDarkFundDailyLimit(user, orders, now));
});
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

test('service quota does not reset at a natural month boundary', () => {
  const openedAt = Date.parse('2026-01-31T04:00:00Z');
  const februaryFirst = Date.parse('2026-02-01T04:00:00Z');
  const rollingBoundary = openedAt + 30 * 86400000;
  const user = { darkFundManualRemaining: 0, darkFundRemaining: 0 };
  activateService(user, 'service_year', openedAt);
  consumeDarkFundQuota(user, openedAt);
  assert.equal(refreshDarkFundQuota(user, februaryFirst).service, 14);
  assert.equal(refreshDarkFundQuota(user, rollingBoundary).service, 15);
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
