const PLANS = Object.freeze({
  month: Object.freeze({ id: 'month', name: '月卡', amount: 990, days: 30 }),
  year: Object.freeze({ id: 'year', name: '年卡', amount: 9900, days: 365 }),
  lifetime: Object.freeze({ id: 'lifetime', name: '永久卡', amount: 18800, permanent: true }),
});

const DAY_MS = 24 * 3600 * 1000;
const MONTHLY_DARK_FUND_QUOTA = 10;

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

function vipActiveAt(user, now = Date.now()) {
  return !!(user && user.vip && (user.vipPermanent || Number(user.vipExpire) > now));
}

// 查询次数分为按自然月失效的 VIP 次数和永不过期的后台次数。
// darkFundRemaining 保留为两类次数的合计，兼容现有小程序字段。
function refreshDarkFundQuota(user, now = Date.now()) {
  if (!user) return { total: 0, vip: 0, manual: 0, vipExpireAt: 0, changed: false };
  let changed = false;
  const month = chinaMonthKey(now);
  if (!Number.isFinite(Number(user.darkFundManualRemaining))) {
    user.darkFundManualRemaining = quotaNumber(user.darkFundRemaining);
    changed = true;
  } else {
    const manual = quotaNumber(user.darkFundManualRemaining);
    if (manual !== user.darkFundManualRemaining) { user.darkFundManualRemaining = manual; changed = true; }
  }
  if (!Number.isFinite(Number(user.darkFundVipRemaining))) {
    user.darkFundVipRemaining = 0;
    changed = true;
  } else {
    const vip = quotaNumber(user.darkFundVipRemaining);
    if (vip !== user.darkFundVipRemaining) { user.darkFundVipRemaining = vip; changed = true; }
  }
  if (typeof user.darkFundVipMonth !== 'string') {
    user.darkFundVipMonth = '';
    changed = true;
  }

  const active = vipActiveAt(user, now);
  if (!active) {
    if (user.darkFundVipRemaining !== 0) { user.darkFundVipRemaining = 0; changed = true; }
    if (user.darkFundVipMonth !== month) { user.darkFundVipMonth = month; changed = true; }
  } else if (user.darkFundVipMonth !== month) {
    user.darkFundVipRemaining = MONTHLY_DARK_FUND_QUOTA;
    user.darkFundVipMonth = month;
    changed = true;
  }

  const total = quotaNumber(user.darkFundVipRemaining) + quotaNumber(user.darkFundManualRemaining);
  if (user.darkFundRemaining !== total) { user.darkFundRemaining = total; changed = true; }
  const vipExpireAt = active
    ? Math.min(user.vipPermanent ? Number.MAX_SAFE_INTEGER : Number(user.vipExpire), chinaMonthEnd(now))
    : 0;
  return {
    total,
    vip: quotaNumber(user.darkFundVipRemaining),
    manual: quotaNumber(user.darkFundManualRemaining),
    vipExpireAt,
    changed,
  };
}

function setManualDarkFundQuota(user, remaining, now = Date.now()) {
  refreshDarkFundQuota(user, now);
  user.darkFundManualRemaining = quotaNumber(remaining);
  return refreshDarkFundQuota(user, now);
}

function consumeDarkFundQuota(user, now = Date.now()) {
  const quota = refreshDarkFundQuota(user, now);
  if (quota.total < 1) return null;
  let source;
  if (quota.vip > 0 && vipActiveAt(user, now)) {
    user.darkFundVipRemaining -= 1;
    source = 'vip';
  } else {
    user.darkFundManualRemaining -= 1;
    source = 'manual';
  }
  return { source, ...refreshDarkFundQuota(user, now) };
}

function getPlan(id) {
  return Object.prototype.hasOwnProperty.call(PLANS, id) ? PLANS[id] : null;
}

function activateMembership(user, planId, now = Date.now()) {
  const plan = getPlan(planId);
  if (!user || !plan) throw new Error('无效会员套餐');
  const wasActive = vipActiveAt(user, now);
  refreshDarkFundQuota(user, now);
  user.vip = true;
  user.vipPlan = plan.id;
  user.vipActivatedAt = now;
  if (plan.permanent) {
    user.vipPermanent = true;
    user.vipExpire = 0;
  } else if (!user.vipPermanent) {
    const base = user.vipExpire > now ? user.vipExpire : now;
    user.vipExpire = base + plan.days * DAY_MS;
  }
  user.tags = (user.tags || []).filter((tag) => tag !== 'new');
  // 新开通的 VIP 当月获得10次；续费不叠加，当月用完后等待下月重置。
  if (!wasActive) {
    user.darkFundVipMonth = chinaMonthKey(now);
    user.darkFundVipRemaining = MONTHLY_DARK_FUND_QUOTA;
  }
  refreshDarkFundQuota(user, now);
  return user;
}

module.exports = {
  PLANS,
  MONTHLY_DARK_FUND_QUOTA,
  getPlan,
  activateMembership,
  chinaMonthKey,
  vipActiveAt,
  refreshDarkFundQuota,
  setManualDarkFundQuota,
  consumeDarkFundQuota,
};
