// server/src/routes/app.js —— 小程序端鉴权 + 写操作接口
// 交互状态（赞/藏/关注）、发布笔记均回传后端，后端为数据源。
const db = require('../db');
const { pubUser, pubNote } = require('../util');
const auth = require('../auth');
const crypto = require('crypto');
const { code2Session } = require('../wechat');

function getState(userId) {
  const d = db.get();
  if (!d.userState) d.userState = {};
  if (!d.userState[userId]) d.userState[userId] = { likes: {}, collects: {}, follows: {} };
  const s = d.userState[userId];
  s.likes = s.likes || {};
  s.collects = s.collects || {};
  s.follows = s.follows || {};
  return s;
}

const POINT_RULES = Object.freeze({ perAd: 5, dailyLimit: 40, completionBonus: 200, pointsPerYuan: 200, perInvite: 200 });

function chinaDateKey() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function chinaMonthKey(timestamp = Date.now()) {
  return new Date(timestamp + 8 * 3600 * 1000).toISOString().slice(0, 7);
}

function nextLeaderboardUpdateDate() {
  const chinaNow = new Date(Date.now() + 8 * 3600 * 1000);
  const next = new Date(Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth() + 1, 5));
  return `${next.getUTCFullYear()}年${next.getUTCMonth() + 1}月5日`;
}

function inviteCodeFor(user) {
  if (!user.inviteCode) {
    user.inviteCode = crypto.createHash('sha256').update(`invite:${user.id}`).digest('hex').slice(0, 10).toUpperCase();
  }
  return user.inviteCode;
}

function getPointAccount(userId) {
  const state = getState(userId);
  if (!state.points) state.points = { balance: 0, totalEarned: 0, transactions: [], tickets: [], daily: {} };
  const account = state.points;
  account.balance = Number(account.balance) || 0;
  account.totalEarned = Number(account.totalEarned) || 0;
  account.transactions = Array.isArray(account.transactions) ? account.transactions : [];
  account.tickets = Array.isArray(account.tickets) ? account.tickets : [];
  const date = chinaDateKey();
  if (!account.daily || account.daily.date !== date) {
    account.daily = { date, views: 0, earned: 0, bonusGranted: false };
  }
  account.tickets = account.tickets.filter((ticket) => !ticket.used && ticket.expiresAt > Date.now());
  return account;
}

function pointSummary(account) {
  return {
    balance: account.balance,
    totalEarned: account.totalEarned,
    cashValue: Number((account.balance / POINT_RULES.pointsPerYuan).toFixed(2)),
    todayViews: account.daily.views,
    todayEarned: account.daily.earned,
    bonusGranted: account.daily.bonusGranted,
    remaining: Math.max(0, POINT_RULES.dailyLimit - account.daily.views),
    rules: POINT_RULES,
    transactions: account.transactions.slice(0, 20),
  };
}

function ensureRewardedAdsEnabled(HttpError) {
  const settings = db.get().settings || {};
  if (settings.rewardedAdEnabled !== true) throw new HttpError(400, '激励广告尚未开启');
}

function applyInviteReward(user, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code || user.invitedBy) return false;
  const d = db.get();
  d.invites = Array.isArray(d.invites) ? d.invites : [];
  const inviter = d.users.find((candidate) => candidate.id !== user.id && inviteCodeFor(candidate) === code);
  if (!inviter) return false;
  if (d.invites.some((item) => item.inviteeId === user.id)) return false;
  const time = Date.now();
  user.invitedBy = inviter.id;
  user.invitedAt = time;
  user.tags = Array.from(new Set([...(user.tags || []), 'invited']));
  const account = getPointAccount(inviter.id);
  account.balance += POINT_RULES.perInvite;
  account.totalEarned += POINT_RULES.perInvite;
  account.transactions.unshift({
    id: 'pt_' + time + crypto.randomBytes(3).toString('hex'),
    type: 'invite',
    title: '成功邀请新用户',
    delta: POINT_RULES.perInvite,
    time,
  });
  account.transactions = account.transactions.slice(0, 100);
  d.invites.push({
    id: 'iv_' + time + crypto.randomBytes(3).toString('hex'),
    inviterId: inviter.id,
    inviteeId: user.id,
    points: POINT_RULES.perInvite,
    time,
    month: chinaMonthKey(time),
  });
  return true;
}

function inviteSummary(user) {
  const d = db.get();
  d.invites = Array.isArray(d.invites) ? d.invites : [];
  const month = chinaMonthKey();
  const current = d.invites.filter((item) => item.month === month || chinaMonthKey(item.time) === month);
  const grouped = {};
  current.forEach((item) => {
    if (!grouped[item.inviterId]) grouped[item.inviterId] = { count: 0, points: 0, lastTime: 0 };
    grouped[item.inviterId].count += 1;
    grouped[item.inviterId].points += Number(item.points) || POINT_RULES.perInvite;
    grouped[item.inviterId].lastTime = Math.max(grouped[item.inviterId].lastTime, Number(item.time) || 0);
  });
  const ranking = Object.keys(grouped)
    .map((userId) => {
      const rankedUser = d.users.find((candidate) => candidate.id === userId) || {};
      return { userId, name: rankedUser.name || '微信用户', avatar: rankedUser.avatar || '', ...grouped[userId] };
    })
    .sort((a, b) => b.points - a.points || b.count - a.count || a.lastTime - b.lastTime)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const mine = grouped[user.id] || { count: 0, points: 0 };
  const myRanking = ranking.find((item) => item.userId === user.id);
  const inviteCode = inviteCodeFor(user);
  return {
    inviteCode,
    inviteLink: `/pages/points/points?invite=${inviteCode}`,
    month,
    nextUpdateDate: nextLeaderboardUpdateDate(),
    invitedCount: mine.count,
    invitePoints: mine.points,
    rank: myRanking ? myRanking.rank : 0,
    perInvite: POINT_RULES.perInvite,
    ranking: ranking.slice(0, 20),
  };
}

function previewLoginAllowed(ctx) {
  if (process.env.NODE_ENV === 'production') return false;
  if (process.env.DEV_PREVIEW_LOGIN === 'false') return false;
  const host = String((ctx.headers && ctx.headers.host) || '').replace(/:\d+$/, '');
  const address = String(ctx.remoteAddress || '');
  const localHost = host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  const localAddress = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
  return localHost && localAddress;
}

module.exports = function register(router, HttpError) {
  const currentUser = (ctx) => {
    const uid = auth.userIdFor(ctx.headers.authorization);
    if (!uid) throw new HttpError(401, '未登录');
    const u = db.get().users.find((x) => x.id === uid);
    if (!u) throw new HttpError(401, '用户不存在');
    return u;
  };
  // 微信登录：后端用 code 换取 openid，再发放业务 token。
  router.post('/api/login', async (ctx) => {
    const d = db.get();
    const b = ctx.body || {};
    let openid;
    if (b.preview === true) {
      if (!previewLoginAllowed(ctx)) throw new HttpError(403, '预览登录仅限本地开发环境');
      openid = 'local-preview-user';
    } else {
      const session = await code2Session(b.code);
      openid = session.openid;
    }
    let user = d.users.find((u) => u.wxOpenId === openid);
    let created = false;
    if (!user) {
      user = {
        id: 'wx_' + crypto.createHash('sha256').update(openid).digest('hex').slice(0, 16),
        wxOpenId: openid,
        name: b.name || '微信用户',
        avatar: b.avatar || 'https://i.pravatar.cc/150?img=68',
        desc: b.desc || '这个人很懒，什么都没留下',
        fans: b.fans || 0,
        follows: b.follows || 0,
        likes: b.likes || 0,
        vip: false,
        vipPlan: '',
        vipExpire: 0,
        vipPermanent: false,
        official: false,
        createdAt: Date.now(),
        tags: ['new'],
      };
      d.users.push(user);
      created = true;
    } else {
      // 同步昵称头像
      if (b.name) user.name = b.name;
      if (b.avatar) user.avatar = b.avatar;
    }
    if (created) applyInviteReward(user, b.inviteCode);
    inviteCodeFor(user);
    db.save();
    const token = auth.issue(user.id);
    return { token, user: pubUser(user) };
  });

  // 当前用户 + 交互状态
  router.get('/api/me', (ctx) => {
    const u = currentUser(ctx);
    const s = getState(u.id);
    return {
      user: pubUser(u),
      likes: Object.keys(s.likes),
      collects: Object.keys(s.collects),
      follows: Object.keys(s.follows),
    };
  });

  router.get('/api/points', (ctx) => {
    const user = currentUser(ctx);
    return pointSummary(getPointAccount(user.id));
  });

  router.get('/api/invites', (ctx) => {
    const user = currentUser(ctx);
    const result = inviteSummary(user);
    db.save();
    return result;
  });

  router.post('/api/points/ad-ticket', (ctx) => {
    const user = currentUser(ctx);
    ensureRewardedAdsEnabled(HttpError);
    const account = getPointAccount(user.id);
    if (account.daily.views >= POINT_RULES.dailyLimit) throw new HttpError(400, '今日40次积分奖励已完成');
    const existing = account.tickets.find((ticket) => !ticket.used && ticket.expiresAt > Date.now());
    if (existing) return { ticket: existing.id, expiresAt: existing.expiresAt };
    const ticket = {
      id: crypto.randomBytes(18).toString('hex'),
      createdAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000,
      used: false,
    };
    account.tickets.push(ticket);
    db.save();
    return { ticket: ticket.id, expiresAt: ticket.expiresAt };
  });

  router.post('/api/points/ad-reward', (ctx) => {
    const user = currentUser(ctx);
    ensureRewardedAdsEnabled(HttpError);
    const account = getPointAccount(user.id);
    const ticketId = String((ctx.body || {}).ticket || '');
    const ticket = account.tickets.find((item) => item.id === ticketId);
    if (!ticket || ticket.used || ticket.expiresAt <= Date.now()) throw new HttpError(400, '广告奖励凭证无效或已过期');
    if (Date.now() - ticket.createdAt < 3000) throw new HttpError(400, '广告尚未完成');
    if (account.daily.views >= POINT_RULES.dailyLimit) throw new HttpError(400, '今日40次积分奖励已完成');
    ticket.used = true;
    account.daily.views += 1;
    let awarded = POINT_RULES.perAd;
    let completedBonus = false;
    if (account.daily.views === POINT_RULES.dailyLimit && !account.daily.bonusGranted) {
      awarded += POINT_RULES.completionBonus;
      account.daily.bonusGranted = true;
      completedBonus = true;
    }
    account.daily.earned += awarded;
    account.balance += awarded;
    account.totalEarned += awarded;
    account.transactions.unshift({
      id: 'pt_' + Date.now() + crypto.randomBytes(3).toString('hex'),
      type: completedBonus ? 'daily_complete' : 'rewarded_ad',
      title: completedBonus ? '完成今日40次广告' : '观看激励广告',
      delta: awarded,
      time: Date.now(),
    });
    account.transactions = account.transactions.slice(0, 100);
    db.save();
    return { awarded, completedBonus, summary: pointSummary(account) };
  });

  // 点赞
  router.post('/api/like/:id', (ctx) => {
    const u = currentUser(ctx);
    const s = getState(u.id);
    const note = db.get().notes.find((n) => n.id === ctx.params.id);
    if (!note) throw new HttpError(404, 'not found');
    const liked = !s.likes[ctx.params.id];
    if (liked) { s.likes[ctx.params.id] = Date.now(); note.likes += 1; }
    else { delete s.likes[ctx.params.id]; note.likes = Math.max(0, note.likes - 1); }
    db.save();
    return { liked, likes: note.likes };
  });

  // 收藏
  router.post('/api/collect/:id', (ctx) => {
    const u = currentUser(ctx);
    const s = getState(u.id);
    const note = db.get().notes.find((n) => n.id === ctx.params.id);
    if (!note) throw new HttpError(404, 'not found');
    const collected = !s.collects[ctx.params.id];
    if (collected) { s.collects[ctx.params.id] = Date.now(); note.collects += 1; }
    else { delete s.collects[ctx.params.id]; note.collects = Math.max(0, note.collects - 1); }
    db.save();
    return { collected, collects: note.collects };
  });

  // 关注 / 取消关注作者
  router.post('/api/follow/:id', (ctx) => {
    const u = currentUser(ctx);
    const target = db.get().users.find((user) => user.id === ctx.params.id);
    if (!target) throw new HttpError(404, '用户不存在');
    if (target.id === u.id) throw new HttpError(400, '不能关注自己');

    const s = getState(u.id);
    const followed = !s.follows[target.id];
    if (followed) {
      s.follows[target.id] = Date.now();
      u.follows = (u.follows || 0) + 1;
      target.fans = (target.fans || 0) + 1;
    } else {
      delete s.follows[target.id];
      u.follows = Math.max(0, (u.follows || 0) - 1);
      target.fans = Math.max(0, (target.fans || 0) - 1);
    }
    db.save();
    return { followed, fans: target.fans };
  });


  // 我关注的人
  router.get('/api/me/following', (ctx) => {
    const u = currentUser(ctx);
    const s = getState(u.id);
    const d = db.get();
    return Object.keys(s.follows).map((id) => pubUser(d.users.find((x) => x.id === id))).filter(Boolean);
  });

  // 我的粉丝（关注了我的人）
  router.get('/api/me/fans', (ctx) => {
    const u = currentUser(ctx);
    const d = db.get();
    const states = d.userState || {};
    const fanIds = Object.keys(states).filter((uid) => states[uid] && states[uid].follows && states[uid].follows[u.id]);
    return fanIds.map((id) => pubUser(d.users.find((x) => x.id === id))).filter(Boolean);
  });

  // 我赞过 / 收藏的笔记
  router.get('/api/me/likes', (ctx) => {
    const u = currentUser(ctx);
    const s = getState(u.id);
    const map = {};
    db.get().notes.forEach((n) => (map[n.id] = n));
    return Object.keys(s.likes).sort((a, b) => s.likes[b] - s.likes[a]).map((id) => map[id]).filter(Boolean).map(pubNote);
  });
  router.get('/api/me/collects', (ctx) => {
    const u = currentUser(ctx);
    const s = getState(u.id);
    const map = {};
    db.get().notes.forEach((n) => (map[n.id] = n));
    return Object.keys(s.collects).sort((a, b) => s.collects[b] - s.collects[a]).map((id) => map[id]).filter(Boolean).map(pubNote);
  });

  // 我发布的笔记
  router.get('/api/me/notes', (ctx) => {
    const u = currentUser(ctx);
    return db.get().notes.filter((n) => n.authorId === u.id).map(pubNote);
  });

};
