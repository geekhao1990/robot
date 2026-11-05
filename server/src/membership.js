const DAY_MS = 24 * 3600 * 1000;
const SERVICE_MONTHLY_QUOTA = 15;
const CLOSE_MONTHLY_DAILY_LIMIT = 99;
const SERVICE_QUOTA_PERIOD_MS = 30 * DAY_MS;

const SERVICE_PLANS = Object.freeze({
  service_month: Object.freeze({ id: 'service_month', name: '服务包月卡', days: 30 }),
  service_year: Object.freeze({ id: 'service_year', name: '服务包年卡', days: 360 }),
});

function quotaNumber(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function serviceActiveAt(user, now = Date.now()) {
  return !!(user && Number(user.serviceExpire) > now);
}

function closeDarkFundActiveAt(user, now = Date.now()) {
  return !!(user && Number(user.darkFundCloseExpire) > now);
}

function activateCloseDarkFund(user, now = Date.now(), days = 30) {
  if (!user) throw new Error('用户不存在');
  if (![7, 30].includes(days)) throw new Error('普通查询有效期无效');
  const base = closeDarkFundActiveAt(user, now) ? Number(user.darkFundCloseExpire) : now;
  const periods = (Array.isArray(user.darkFundClosePeriods) ? user.darkFundClosePeriods : [])
    .filter(period => Number(period.until) > now && Number(period.until) <= base)
    .map(period => ({ until: Number(period.until), dailyLimit: period.dailyLimit === 0 ? 0 : CLOSE_MONTHLY_DAILY_LIMIT }));
  if (base > now && (!periods.length || periods[periods.length - 1].until < base)) {
    periods.push({ until: base, dailyLimit: user.darkFundCloseDailyLimit === 0 ? 0 : CLOSE_MONTHLY_DAILY_LIMIT });
  }
  periods.push({ until: base + days * DAY_MS, dailyLimit: days === 30 ? CLOSE_MONTHLY_DAILY_LIMIT : 0 });
  user.darkFundClosePeriods = periods;
  user.darkFundCloseDailyLimit = periods[0].dailyLimit;
  user.darkFundCloseExpire = base + days * DAY_MS;
  user.darkFundEnabled = true;
  return user;
}

function closeDarkFundDay(now = Date.now()) {
  return new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function closeDarkFundDailyLimit(user, now = Date.now()) {
  const period = (user && Array.isArray(user.darkFundClosePeriods) ? user.darkFundClosePeriods : [])
    .find(item => Number(item.until) > now);
  return (period ? period.dailyLimit : user && user.darkFundCloseDailyLimit) === 0 ? 0 : CLOSE_MONTHLY_DAILY_LIMIT;
}

function assertCloseDarkFundDailyLimit(user, orders, now = Date.now()) {
  const day = closeDarkFundDay(now);
  if (closeDarkFundDailyLimit(user, now) === 0 || user.darkFundCloseUnlockedDate === day) return;
  const used = (orders || []).filter(order => order.userId === user.id
    && order.quotaSource === 'close_month' && !order.quotaRefundedAt
    && !['FAILED', 'DISPATCH_FAILED', 'CANCELLED'].includes(order.status)
    && closeDarkFundDay(Number(order.createdAt) || 0) === day).length;
  if (used >= CLOSE_MONTHLY_DAILY_LIMIT) throw Object.assign(new Error('查询过于频繁，请稍后再试'), { status: 429 });
}

function refreshDarkFundQuota(user, now = Date.now()) {
  if (!user) return { total: 0, service: 0, manual: 0, serviceExpireAt: 0, changed: false };
  let changed = false;
  let manual = Number.isFinite(Number(user.darkFundManualRemaining))
    ? quotaNumber(user.darkFundManualRemaining)
    : quotaNumber(user.darkFundRemaining);

  // 一次性保留旧会员系统已经发放但尚未使用的查询次数。
  const legacyVip = quotaNumber(user.darkFundVipRemaining);
  if (legacyVip > 0) manual += legacyVip;
  if (user.darkFundManualRemaining !== manual) { user.darkFundManualRemaining = manual; changed = true; }
  if (Object.prototype.hasOwnProperty.call(user, 'darkFundVipRemaining')) { delete user.darkFundVipRemaining; changed = true; }
  if (Object.prototype.hasOwnProperty.call(user, 'darkFundVipMonth')) { delete user.darkFundVipMonth; changed = true; }

  let service = quotaNumber(user.darkFundServiceRemaining);
  if (!serviceActiveAt(user, now)) {
    service = 0;
    if (Number(user.darkFundServicePeriodStart) !== 0) { user.darkFundServicePeriodStart = 0; changed = true; }
    if (Number(user.darkFundServicePeriodExpire) !== 0) { user.darkFundServicePeriodExpire = 0; changed = true; }
  } else {
    const serviceExpire = Number(user.serviceExpire);
    let periodStart = Number(user.darkFundServicePeriodStart);
    let periodExpire = Number(user.darkFundServicePeriodExpire);
    if (!Number.isFinite(periodStart) || !Number.isFinite(periodExpire) || periodStart <= 0 || periodExpire <= periodStart) {
      // 旧周期数据无法还原准确充值时刻：迁移当天起保留现有次数30天。
      periodStart = now;
      periodExpire = Math.min(serviceExpire, now + SERVICE_QUOTA_PERIOD_MS);
      changed = true;
    } else if (now >= periodExpire) {
      const elapsedPeriods = Math.max(1, Math.floor((now - periodStart) / SERVICE_QUOTA_PERIOD_MS));
      periodStart += elapsedPeriods * SERVICE_QUOTA_PERIOD_MS;
      periodExpire = Math.min(serviceExpire, periodStart + SERVICE_QUOTA_PERIOD_MS);
      service = SERVICE_MONTHLY_QUOTA;
      changed = true;
    } else if (periodExpire > serviceExpire) {
      periodExpire = serviceExpire;
      changed = true;
    }
    if (user.darkFundServicePeriodStart !== periodStart) { user.darkFundServicePeriodStart = periodStart; changed = true; }
    if (user.darkFundServicePeriodExpire !== periodExpire) { user.darkFundServicePeriodExpire = periodExpire; changed = true; }
  }
  if (Object.prototype.hasOwnProperty.call(user, 'darkFundServiceMonth')) { delete user.darkFundServiceMonth; changed = true; }
  if (user.darkFundServiceRemaining !== service) { user.darkFundServiceRemaining = service; changed = true; }

  const total = manual + service;
  if (user.darkFundRemaining !== total) { user.darkFundRemaining = total; changed = true; }
  return {
    total,
    service,
    manual,
    serviceExpireAt: serviceActiveAt(user, now) ? Number(user.darkFundServicePeriodExpire) || 0 : 0,
    changed,
  };
}

function setManualDarkFundQuota(user, remaining, now = Date.now()) {
  refreshDarkFundQuota(user, now);
  user.darkFundManualRemaining = quotaNumber(remaining);
  return refreshDarkFundQuota(user, now);
}

function addManualDarkFundQuota(user, count, now = Date.now()) {
  refreshDarkFundQuota(user, now);
  user.darkFundManualRemaining += quotaNumber(count);
  return refreshDarkFundQuota(user, now);
}

function consumeDarkFundQuota(user, now = Date.now()) {
  const quota = refreshDarkFundQuota(user, now);
  if (quota.total < 1) return null;
  let source = 'manual';
  // 服务包次数在当前30天周期末或服务到期时失效，优先使用有效期更近的次数。
  if (quota.service > 0 && serviceActiveAt(user, now)) {
    user.darkFundServiceRemaining -= 1;
    source = 'service';
  } else {
    user.darkFundManualRemaining -= 1;
  }
  return { ...refreshDarkFundQuota(user, now), source };
}

function refundDarkFundQuota(user, source, now = Date.now()) {
  if (!user || !source) return refreshDarkFundQuota(user, now);
  if (source === 'ordinary_trial') {
    user.darkFundTrialRemaining = 1;
    return refreshDarkFundQuota(user, now);
  }
  refreshDarkFundQuota(user, now);
  if (source === 'service' && serviceActiveAt(user, now)) {
    user.darkFundServiceRemaining = Math.min(SERVICE_MONTHLY_QUOTA, quotaNumber(user.darkFundServiceRemaining) + 1);
  } else {
    user.darkFundManualRemaining = quotaNumber(user.darkFundManualRemaining) + 1;
  }
  return refreshDarkFundQuota(user, now);
}

function activateService(user, planId, now = Date.now()) {
  const plan = SERVICE_PLANS[planId];
  if (!user || !plan) throw new Error('无效服务包');
  const wasActive = serviceActiveAt(user, now);
  const base = wasActive ? Number(user.serviceExpire) : now;
  user.serviceExpire = base + plan.days * DAY_MS;
  user.servicePlan = wasActive && user.servicePlan === 'service_year' ? 'service_year' : plan.id;
  if (!wasActive) {
    user.darkFundServicePeriodStart = now;
    user.darkFundServicePeriodExpire = Math.min(user.serviceExpire, now + SERVICE_QUOTA_PERIOD_MS);
    user.darkFundServiceRemaining = SERVICE_MONTHLY_QUOTA;
  }
  refreshDarkFundQuota(user, now);
  return user;
}

module.exports = {
  closeDarkFundDay,
  closeDarkFundDailyLimit,
  assertCloseDarkFundDailyLimit,
  SERVICE_MONTHLY_QUOTA,
  SERVICE_QUOTA_PERIOD_MS,
  SERVICE_PLANS,
  serviceActiveAt,
  closeDarkFundActiveAt,
  activateCloseDarkFund,
  refreshDarkFundQuota,
  setManualDarkFundQuota,
  addManualDarkFundQuota,
  consumeDarkFundQuota,
  refundDarkFundQuota,
  activateService,
};
