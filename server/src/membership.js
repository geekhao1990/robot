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
  // 月卡附赠 10 次暗盘资金查询；入口仍由后台单独人工开通。
  if (plan.id === 'month') {
    user.darkFundRemaining = Math.max(0, Number(user.darkFundRemaining) || 0) + 10;
  }
  return user;
}

module.exports = { PLANS, getPlan, activateMembership };
