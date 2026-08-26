const PLANS = Object.freeze({
  month: Object.freeze({ id: 'month', name: '月卡', amount: 990, days: 30 }),
  year: Object.freeze({ id: 'year', name: '年卡', amount: 9900, days: 365 }),
  lifetime: Object.freeze({ id: 'lifetime', name: '永久卡', amount: 18800, permanent: true }),
});

function getPlan(id) {
  return Object.prototype.hasOwnProperty.call(PLANS, id) ? PLANS[id] : null;
}

function activateMembership(user, planId, now = Date.now()) {
  const plan = getPlan(planId);
  if (!user || !plan) throw new Error('无效会员套餐');
  user.vip = true;
  user.vipPlan = plan.id;
  user.vipActivatedAt = now;
  if (plan.permanent) {
    user.vipPermanent = true;
    user.vipExpire = 0;
  } else if (!user.vipPermanent) {
    const base = user.vipExpire > now ? user.vipExpire : now;
    user.vipExpire = base + plan.days * 24 * 3600 * 1000;
  }
  user.tags = (user.tags || []).filter((tag) => tag !== 'new');
  return user;
}

module.exports = { PLANS, getPlan, activateMembership };
