// server/src/util.js —— 公共辅助

const { resourceList } = require('./resource-links');
const { refreshDarkFundQuota, serviceActiveAt } = require('./membership');

function goldAccess(user) {
  return !!(user && (Number(user.goldExpire) > Date.now() || serviceActiveAt(user)));
}

function courseAccess(user) {
  return !!(user && (user.courseAccessPermanent === true || serviceActiveAt(user)));
}

// 对外输出的用户对象（隐藏登录标识及已停用的旧会员字段）
function pubUser(user, includePrivate = false) {
  if (!user) return user;
  const darkFundQuota = refreshDarkFundQuota(user);
  const {
    wxOpenId, phone, phoneCountryCode, phoneBoundAt,
    vip, vipPlan, vipExpire, vipPermanent, vipActivatedAt,
    darkFundVipRemaining, darkFundVipMonth,
    darkFundServiceMonth,
    goldQuotaGiftMigrated,
    ...safe
  } = user;
  if (includePrivate) {
    safe.phone = phone || '';
    safe.phoneCountryCode = phoneCountryCode || '';
    safe.phoneBoundAt = phoneBoundAt || 0;
  }
  return {
    ...safe,
    goldActive: Number(user.goldExpire) > Date.now(),
    goldAccess: goldAccess(user),
    serviceActive: serviceActiveAt(user),
    courseAccess: courseAccess(user),
    darkFundEnabled: user.darkFundEnabled === true,
    darkFundRemaining: darkFundQuota.total,
    darkFundServiceRemaining: darkFundQuota.service,
    darkFundManualRemaining: darkFundQuota.manual,
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
  return {
    rewardedAdEnabled: raw.rewardedAdEnabled === true,
    featuredNoteId: featured ? featured.id : '',
  };
}

module.exports = { goldAccess, courseAccess, pubUser, pubNote, pubSettings };
