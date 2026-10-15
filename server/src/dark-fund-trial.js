// A separate ordinary-query credit: never usable by decision or member queries.
function trialRemaining(user) {
  return user && user.darkFundTrialRemaining === 1 ? 1 : 0;
}

function ensureTrial(data, user) {
  if (!user || user.darkFundTrialChecked === true) return false;
  const used = Boolean(user.goldDarkFundLastUsedDate) || (data.darkFundOrders || []).some(order => order.userId === user.id);
  user.darkFundTrialChecked = true;
  user.darkFundTrialRemaining = used ? 0 : 1;
  return true;
}

function consumeTrial(user) {
  if (!trialRemaining(user)) return false;
  user.darkFundTrialRemaining = 0;
  return true;
}

module.exports = { trialRemaining, ensureTrial, consumeTrial };
