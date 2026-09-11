// server/src/util.js —— 公共辅助

const { resourceList } = require('./resource-links');
const { refreshDarkFundQuota } = require('./membership');

// VIP 是否在有效期内
function vipActive(user) {
  return !!(user && user.vip && (user.vipPermanent || (user.vipExpire && user.vipExpire > Date.now())));
}

// 金手指权限：单独开通的金手指权益或有效 VIP，任一有效即可使用。
function goldAccess(user) {
  return !!(user && (Number(user.goldExpire) > Date.now() || vipActive(user)));
}

// 对外输出的用户对象（附带 vipActive）
function pubUser(user, includePrivate = false) {
  if (!user) return user;
  const darkFundQuota = refreshDarkFundQuota(user);
  const { wxOpenId, phone, phoneCountryCode, phoneBoundAt, ...safe } = user;
  if (includePrivate) {
    safe.phone = phone || '';
    safe.phoneCountryCode = phoneCountryCode || '';
    safe.phoneBoundAt = phoneBoundAt || 0;
  }
  return {
    ...safe,
    vipActive: vipActive(user),
    goldActive: Number(user.goldExpire) > Date.now(),
    goldAccess: goldAccess(user),
    darkFundEnabled: user.darkFundEnabled === true,
    darkFundRemaining: darkFundQuota.total,
    darkFundVipRemaining: darkFundQuota.vip,
    darkFundManualRemaining: darkFundQuota.manual,
    darkFundVipExpireAt: darkFundQuota.vipExpireAt,
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
    vipEnabled: raw.vipEnabled === true,
    featuredNoteId: featured ? featured.id : '',
  };
}

module.exports = { vipActive, goldAccess, pubUser, pubNote, pubSettings };
