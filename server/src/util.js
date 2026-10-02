// server/src/util.js —— 公共辅助

const { resourceList } = require('./resource-links');
const { refreshDarkFundQuota, serviceActiveAt, closeDarkFundActiveAt } = require('./membership');

function goldAccess(user) {
  return !!(user && (Number(user.goldExpire) > Date.now() || serviceActiveAt(user)));
}

// 对外输出的用户对象（隐藏登录标识及已停用的旧会员字段）
function pubUser(user) {
  if (!user) return user;
  const darkFundQuota = refreshDarkFundQuota(user);
  const {
    wxOpenId, wxWebOpenId, wxUnionId, phone, phoneCountryCode, phoneBoundAt,
    webPasswordHash, webPasswordSalt, webPasswordUpdatedAt,
    vip, vipPlan, vipExpire, vipPermanent, vipActivatedAt,
    darkFundVipRemaining, darkFundVipMonth,
    darkFundServiceMonth, darkFundServicePeriodStart, darkFundServicePeriodExpire,
    goldQuotaGiftMigrated,
    ...safe
  } = user;
  return {
    ...safe,
    webPasswordSet: Boolean(webPasswordHash && webPasswordSalt),
    goldActive: Number(user.goldExpire) > Date.now(),
    goldAccess: goldAccess(user),
    serviceActive: serviceActiveAt(user),
    darkFundEnabled: user.darkFundEnabled === true,
    darkFundRemaining: darkFundQuota.total,
    darkFundServiceRemaining: darkFundQuota.service,
    darkFundServiceExpireAt: darkFundQuota.serviceExpireAt,
    darkFundManualRemaining: darkFundQuota.manual,
    darkFundCloseMonthlyActive: closeDarkFundActiveAt(user),
    darkFundCloseExpire: closeDarkFundActiveAt(user) ? Number(user.darkFundCloseExpire) : 0,
  };
}

// 小程序内容接口不直接暴露网盘地址
function pubNote(note) {
  if (!note) return note;
  const { courseUrl, baiduUrl, quarkUrl, ...safe } = note;
  return {
    ...safe,
    riskDisclaimerEnabled: note.riskDisclaimerEnabled !== false,
    hasResource: resourceList(note).length > 0,
  };
}

function pubSettings(data) {
  const notes = (data && data.notes) || [];
  const raw = (data && data.settings) || {};
  const featured = notes.find((n) => n.id === raw.featuredNoteId && n.type === 'gold')
    || notes.find((n) => n.type === 'gold');
  const publicAdUnitId = (value) => {
    const id = String(value || '').trim();
    return /^adunit-[a-zA-Z0-9_-]+$/.test(id) && !/x{4,}/i.test(id) ? id : '';
  };
  return {
    rewardedAdEnabled: raw.rewardedAdEnabled === true,
    rewardedVideoAdUnitId: publicAdUnitId(raw.rewardedVideoAdUnitId),
    goldRewardedVideoAdUnitId: publicAdUnitId(raw.goldRewardedVideoAdUnitId),
    articleAdUnitId: publicAdUnitId(raw.articleAdUnitId),
    goldFingerAdUnitId: publicAdUnitId(raw.goldFingerAdUnitId),
    goldFingerInterstitialAdUnitId: publicAdUnitId(raw.goldFingerInterstitialAdUnitId),
    darkFundsQueryAdUnitId: publicAdUnitId(raw.darkFundsQueryAdUnitId),
    darkFundsHistoryAdUnitId: publicAdUnitId(raw.darkFundsHistoryAdUnitId),
    darkFundsCloseInterstitialAdUnitId: publicAdUnitId(raw.darkFundsCloseInterstitialAdUnitId),
    darkFundsCloseBannerAdUnitId: publicAdUnitId(raw.darkFundsCloseBannerAdUnitId),
    profileAdUnitId: publicAdUnitId(raw.profileAdUnitId),
    profileBottomAdUnitId: publicAdUnitId(raw.profileBottomAdUnitId),
    messageCenterAdUnitId: publicAdUnitId(raw.messageCenterAdUnitId),
    messageCenterBottomAdUnitId: publicAdUnitId(raw.messageCenterBottomAdUnitId),
    featuredNoteId: featured ? featured.id : '',
  };
}

module.exports = { goldAccess, pubUser, pubNote, pubSettings };
