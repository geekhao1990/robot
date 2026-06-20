// server/src/util.js —— 公共辅助

// VIP 是否在有效期内
function vipActive(user) {
  return !!(user && user.vip && user.vipExpire && user.vipExpire > Date.now());
}

// 对外输出的用户对象（附带 vipActive）
function pubUser(user) {
  if (!user) return user;
  return { ...user, vipActive: vipActive(user) };
}

module.exports = { vipActive, pubUser };
