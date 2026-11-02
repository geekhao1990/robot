function grantNewUserGold(user, now = Date.now()) {
  // Called only while creating a brand-new account. Past expiry also means opened before.
  if (!user || user.newUserGoldGiftAt || Number(user.goldExpire)>0 || user.goldOpenedAt || user.goldActivatedAt) return false;
  user.goldExpire=now+30*86400000;
  user.newUserGoldGiftAt=now;
  user.goldOpenedAt=now;
  return true;
}
module.exports={grantNewUserGold};
