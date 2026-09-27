const DAY_MS = 24 * 3600 * 1000;
const SERVICE_MONTHLY_QUOTA = 15;

const SERVICE_PLANS = Object.freeze({
  service_month: Object.freeze({ id: 'service_month', name: '服务包月卡', days: 30 }),
  service_year: Object.freeze({ id: 'service_year', name: '服务包年卡', days: 360 }),
});

function quotaNumber(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function chinaMonthKey(now = Date.now()) {
  const date = new Date(now + 8 * 3600 * 1000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function chinaMonthEnd(now = Date.now()) {
  const date = new Date(now + 8 * 3600 * 1000);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - 8 * 3600 * 1000;
}

function serviceActiveAt(user, now = Date.now()) {
  return !!(user && Number(user.serviceExpire) > now);
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
  const month = chinaMonthKey(now);
  if (!serviceActiveAt(user, now)) {
    service = 0;
    if (user.darkFundServiceMonth !== '') { user.darkFundServiceMonth = ''; changed = true; }
  } else if (user.darkFundServiceMonth !== month) {
    service = SERVICE_MONTHLY_QUOTA;
    user.darkFundServiceMonth = month;
    changed = true;
  }
  if (user.darkFundServiceRemaining !== service) { user.darkFundServiceRemaining = service; changed = true; }

  const total = manual + service;
  if (user.darkFundRemaining !== total) { user.darkFundRemaining = total; changed = true; }
  return {
    total,
    service,
    manual,
    serviceExpireAt: serviceActiveAt(user, now) ? Math.min(Number(user.serviceExpire), chinaMonthEnd(now)) : 0,
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
  // 服务包次数月底或服务到期即失效，优先使用有效期更近的次数。
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
    user.darkFundServiceMonth = chinaMonthKey(now);
    user.darkFundServiceRemaining = SERVICE_MONTHLY_QUOTA;
  }
  refreshDarkFundQuota(user, now);
  return user;
}

module.exports = {
  SERVICE_MONTHLY_QUOTA,
  SERVICE_PLANS,
  chinaMonthKey,
  serviceActiveAt,
  refreshDarkFundQuota,
  setManualDarkFundQuota,
  addManualDarkFundQuota,
  consumeDarkFundQuota,
  refundDarkFundQuota,
  activateService,
};
