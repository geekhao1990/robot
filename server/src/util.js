// server/src/util.js —— 公共辅助

const { resourceList } = require('./resource-links');

// VIP 是否在有效期内
function vipActive(user) {
  return !!(user && user.vip && (user.vipPermanent || (user.vipExpire && user.vipExpire > Date.now())));
}

// 对外输出的用户对象（附带 vipActive）
function pubUser(user) {
  if (!user) return user;
  const { wxOpenId, phone, phoneCountryCode, phoneBoundAt, ...safe } = user;
  return { ...safe, vipActive: vipActive(user) };
}

// 小程序内容接口不直接暴露网盘地址
function pubNote(note) {
  if (!note) return note;
  const { courseUrl, baiduUrl, quarkUrl, ...safe } = note;
  return { ...safe, hasResource: resourceList(note).length > 0 };
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

module.exports = { vipActive, pubUser, pubNote, pubSettings };
