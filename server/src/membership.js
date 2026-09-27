// 暗盘查询次数与内容权益分离：这里只维护后台人工发放、永不过期的次数。
function quotaNumber(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function refreshDarkFundQuota(user) {
  if (!user) return { total: 0, vip: 0, manual: 0, vipExpireAt: 0, changed: false };
  let changed = false;
  let manual = Number.isFinite(Number(user.darkFundManualRemaining))
    ? quotaNumber(user.darkFundManualRemaining)
    : quotaNumber(user.darkFundRemaining);

  // 一次性保留历史会员已经获得但尚未使用的查询次数。
  const legacyVip = quotaNumber(user.darkFundVipRemaining);
  if (legacyVip > 0) manual += legacyVip;
  if (user.darkFundManualRemaining !== manual) { user.darkFundManualRemaining = manual; changed = true; }
  if (user.darkFundVipRemaining !== 0) { user.darkFundVipRemaining = 0; changed = true; }
  if (user.darkFundVipMonth !== '') { user.darkFundVipMonth = ''; changed = true; }
  if (user.darkFundRemaining !== manual) { user.darkFundRemaining = manual; changed = true; }

  return { total: manual, vip: 0, manual, vipExpireAt: 0, changed };
}

function setManualDarkFundQuota(user, remaining) {
  refreshDarkFundQuota(user);
  user.darkFundManualRemaining = quotaNumber(remaining);
  user.darkFundRemaining = user.darkFundManualRemaining;
  return refreshDarkFundQuota(user);
}

function consumeDarkFundQuota(user) {
  const quota = refreshDarkFundQuota(user);
  if (quota.total < 1) return null;
  user.darkFundManualRemaining -= 1;
  const next = refreshDarkFundQuota(user);
  return { ...next, source: 'manual' };
}

function refundDarkFundQuota(user, source) {
  if (!user || !source) return refreshDarkFundQuota(user);
  refreshDarkFundQuota(user);
  user.darkFundManualRemaining += 1;
  return refreshDarkFundQuota(user);
}

module.exports = {
  refreshDarkFundQuota,
  setManualDarkFundQuota,
  consumeDarkFundQuota,
  refundDarkFundQuota,
};
