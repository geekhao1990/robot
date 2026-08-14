// server/src/util.js —— 公共辅助

// VIP 是否在有效期内
function vipActive(user) {
  return !!(user && user.vip && user.vipExpire && user.vipExpire > Date.now());
}

// 对外输出的用户对象（附带 vipActive）
function pubUser(user) {
  if (!user) return user;
  const { wxOpenId, ...safe } = user;
  return { ...safe, vipActive: vipActive(user) };
}

// 小程序内容接口不直接暴露网盘地址
function pubNote(note) {
  if (!note) return note;
  const { courseUrl, ...safe } = note;
  return { ...safe, hasResource: !!courseUrl };
}

module.exports = { vipActive, pubUser, pubNote };
