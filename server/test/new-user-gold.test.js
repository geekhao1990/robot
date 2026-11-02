const test=require('node:test');
const assert=require('node:assert/strict');
const {grantNewUserGold}=require('../src/new-user-gold');
test('new registration receives 30 days exactly once; expired activations do not qualify',()=>{
  const u={goldExpire:0};assert.equal(grantNewUserGold(u,1000),true);assert.equal(u.goldExpire,1000+30*86400000);
  assert.equal(grantNewUserGold(u,2000),false);
  for(const old of [{goldExpire:1},{goldOpenedAt:1},{goldActivatedAt:1},{newUserGoldGiftAt:1}]) assert.equal(grantNewUserGold(old,1000),false);
});
