// utils/store.js
// 状态层：后端为数据源，本地仅作运行时缓存 + 离线镜像。
// 登录后从 /api/me 拉取交互状态；点赞/收藏/关注/发布等写操作回传后端。

const data = require('../mock/data');
const config = require('./config');
// 懒加载 api，避免与 api.js 形成循环依赖
function getApi() {
  return require('./api');
}

function authRemote() {
  return !!(config.useRemote || config.previewAuthRemote || config.wechatAuthRemote);
}

const KEY = {
  TOKEN: 'xhs_token',
  USER: 'xhs_user',
  LIKES: 'xhs_likes',
  COLLECTS: 'xhs_collects',
  FOLLOWS: 'xhs_follows',
  READ: 'xhs_read',
  PENDING_INVITE: 'xhs_pending_invite',
};

const REACTION_BATCH_MS = 60 * 60 * 1000;
let reactionFlushPromise = null;
let reactionSyncTimer = null;

let state = {
  token: null,
  user: null,
  likes: {},
  collects: {},
  follows: {},
  read: { notify: {}, conv: {} },
};

function load(key, fallback) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function save(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (e) {}
}

function reactionQueueKey(user = state.user) {
  return user && user.id ? `xhs_reaction_queue_${user.id}` : '';
}

function reactionQueue() {
  const key = reactionQueueKey();
  return key ? load(key, {}) : {};
}

function saveReactionQueue(queue) {
  const key = reactionQueueKey();
  if (key) save(key, queue || {});
}

function overlayPendingReactions() {
  const queue = reactionQueue();
  Object.keys(queue).forEach((id) => {
    const item = queue[id];
    if (item.liked) state.likes[id] = item.updatedAt;
    else delete state.likes[id];
    if (item.collected) state.collects[id] = item.updatedAt;
    else delete state.collects[id];
  });
}

function queueReaction(id, previous) {
  const queue = reactionQueue();
  const old = queue[id];
  const now = Date.now();
  queue[id] = {
    noteId: id,
    liked: !!state.likes[id],
    collected: !!state.collects[id],
    baseLiked: old ? old.baseLiked : !!previous.liked,
    baseCollected: old ? old.baseCollected : !!previous.collected,
    queuedAt: old ? old.queuedAt : now,
    updatedAt: now,
  };
  // 用户又切回服务端原状态时无需产生写入。
  if (queue[id].liked === queue[id].baseLiked && queue[id].collected === queue[id].baseCollected) {
    delete queue[id];
  }
  saveReactionQueue(queue);
}

function pendingReactionDelta(id) {
  const item = reactionQueue()[id];
  if (!item) return { likes: 0, collects: 0 };
  return {
    likes: Number(item.liked) - Number(item.baseLiked),
    collects: Number(item.collected) - Number(item.baseCollected),
  };
}

function flushReactions(force = false) {
  if (!config.useRemote || !state.token || !state.user) return Promise.resolve({ skipped: true });
  if (reactionFlushPromise) return reactionFlushPromise;
  const queue = reactionQueue();
  const items = Object.values(queue);
  if (!items.length) return Promise.resolve({ skipped: true });
  const oldest = Math.min(...items.map((item) => Number(item.queuedAt) || Date.now()));
  if (!force && Date.now() - oldest < REACTION_BATCH_MS) return Promise.resolve({ pending: items.length });

  const submitted = items.map((item) => ({
    noteId: item.noteId,
    liked: item.liked,
    collected: item.collected,
    updatedAt: item.updatedAt,
  }));
  reactionFlushPromise = getApi().batchReactions(submitted).then((result) => {
    const latest = reactionQueue();
    const accepted = new Set(((result && result.items) || [])
      .filter((item) => item && item.ok === true)
      .map((item) => item.noteId));
    submitted.forEach((item) => {
      if (accepted.has(item.noteId) && latest[item.noteId] && latest[item.noteId].updatedAt === item.updatedAt) {
        delete latest[item.noteId];
      }
    });
    saveReactionQueue(latest);
    return result;
  }).catch(() => ({ pending: submitted.length })).then((result) => {
    reactionFlushPromise = null;
    return result;
  });
  return reactionFlushPromise;
}

function startReactionSync() {
  if (reactionSyncTimer) return;
  reactionSyncTimer = setInterval(() => flushReactions(false), 60 * 1000);
}

function init() {
  state.token = load(KEY.TOKEN, null);
  state.user = load(KEY.USER, null);
  state.likes = load(KEY.LIKES, {});
  state.collects = load(KEY.COLLECTS, {});
  state.follows = load(KEY.FOLLOWS, {});
  state.read = load(KEY.READ, { notify: {}, conv: {} });
  // 从本地 mock 切换到真实后端时，旧缓存没有服务端 token，必须重新登录。
  if (authRemote() && !state.token) {
    state.user = null;
    save(KEY.USER, null);
  }
  if (!state.user) {
    state.likes = {};
    state.collects = {};
    state.follows = {};
    save(KEY.LIKES, {});
    save(KEY.COLLECTS, {});
    save(KEY.FOLLOWS, {});
  }
}

// 数组 -> 时间戳 map（保持顺序）
function toMap(arr) {
  const m = {};
  (arr || []).forEach((id, i) => (m[id] = Date.now() - i));
  return m;
}

// ---------- 登录态 ----------
function getToken() {
  return state.token;
}
function setToken(token) {
  state.token = token || null;
  save(KEY.TOKEN, state.token);
}
function getUser() {
  return state.user;
}
function setUser(user) {
  state.user = user;
  save(KEY.USER, user);
  const app = getApp();
  if (app) app.globalData.userInfo = user;
}
function isLogin() {
  return !!state.user && (!authRemote() || !!state.token);
}

function captureInvite(options) {
  const query = (options && options.query) || {};
  let code = query.invite || '';
  if (!code && query.scene) {
    let scene = String(query.scene);
    try { scene = decodeURIComponent(scene); } catch (e) {}
    const match = scene.match(/(?:^|&)i=([A-Za-z0-9]+)/);
    if (match) code = match[1];
  }
  code = String(code || '').trim().toUpperCase();
  if (code) save(KEY.PENDING_INVITE, code);
  return code;
}

function getPendingInvite() {
  return load(KEY.PENDING_INVITE, '');
}

// 登录：远程换取 token + 用户并同步交互状态；离线则降级为本地
function login(profile) {
  if (authRemote()) {
    const inviteCode = getPendingInvite();
    return getApi()
      .login({ ...profile, inviteCode })
      .then((res) => {
        setToken(res.token);
        setUser(res.user);
        save(KEY.PENDING_INVITE, '');
        return syncMe().then(() => state.user);
      })
      .catch((err) => Promise.reject(err));
  }
  const previous = state.user || {};
  setUser({
    id: previous.id || 'wx_local_preview',
    name: profile.name || previous.name || '微信用户',
    avatar: profile.avatar || previous.avatar || '',
    desc: previous.desc || '',
    goldExpire: Number(previous.goldExpire) || 0,
  });
  return Promise.resolve(state.user);
}

// 从后端刷新当前用户 + 交互状态
function syncMe() {
  if (!authRemote() || !state.token) return Promise.resolve(state.user);
  return getApi()
    .getMe()
    .then((d) => {
      if (d && d.user) setUser(d.user);
      state.likes = toMap(d.likes);
      state.collects = toMap(d.collects);
      state.follows = toMap(d.follows);
      overlayPendingReactions();
      save(KEY.LIKES, state.likes);
      save(KEY.COLLECTS, state.collects);
      save(KEY.FOLLOWS, state.follows);
      return state.user;
    })
    .catch(() => state.user);
}

function updateProfile(profile) {
  if (!authRemote()) {
    const { password, confirmPassword, ...safeProfile } = profile || {};
    setUser({ ...state.user, ...safeProfile });
    return Promise.resolve(state.user);
  }
  return getApi().updateMyProfile(profile).then((result) => {
    if (result && result.user) setUser(result.user);
    return state.user;
  });
}

function logout() {
  setToken(null);
  setUser(null);
  state.likes = {};
  state.collects = {};
  state.follows = {};
  save(KEY.LIKES, {});
  save(KEY.COLLECTS, {});
  save(KEY.FOLLOWS, {});
}

// ---------- 点赞 / 收藏 / 关注 ----------
// 点赞与收藏先乐观写入本地，按用户合并为最终状态，约一小时后批量回传。
function isLiked(id) {
  return !!state.likes[id];
}
function toggleLike(id) {
  const previous = { liked: !!state.likes[id], collected: !!state.collects[id] };
  const liked = !state.likes[id];
  if (liked) state.likes[id] = Date.now();
  else delete state.likes[id];
  save(KEY.LIKES, state.likes);
  if (config.useRemote && state.token) queueReaction(id, previous);
  return liked;
}

function isCollected(id) {
  return !!state.collects[id];
}
function toggleCollect(id) {
  const previous = { liked: !!state.likes[id], collected: !!state.collects[id] };
  const collected = !state.collects[id];
  if (collected) state.collects[id] = Date.now();
  else delete state.collects[id];
  save(KEY.COLLECTS, state.collects);
  if (config.useRemote && state.token) queueReaction(id, previous);
  return collected;
}

function isFollowed(uid) {
  return !!state.follows[uid];
}
function toggleFollow(uid) {
  const followed = !state.follows[uid];
  if (followed) state.follows[uid] = Date.now();
  else delete state.follows[uid];
  save(KEY.FOLLOWS, state.follows);
  if (config.useRemote && state.token) {
    getApi().followUser(uid).catch(() => revert(state.follows, KEY.FOLLOWS, uid, followed));
  }
  return followed;
}

// 回传失败时回滚本地缓存
function revert(map, key, id, applied) {
  if (applied) delete map[id];
  else map[id] = Date.now();
  save(key, map);
}

function likedIds() {
  return Object.keys(state.likes).sort((a, b) => state.likes[b] - state.likes[a]);
}
function collectedIds() {
  return Object.keys(state.collects).sort((a, b) => state.collects[b] - state.collects[a]);
}
function followedIds() {
  return Object.keys(state.follows).sort((a, b) => state.follows[b] - state.follows[a]);
}

// ---------- 消息未读 / 已读 ----------
const EMPTY_SUMMARY = { like: 0, comment: 0, follow: 0, conv: 0, total: 0 };
let msgSummary = { ...EMPTY_SUMMARY };

// 同步返回缓存的未读汇总（角标用）
function messageUnread() {
  if (!state.user) return { ...EMPTY_SUMMARY };
  if (config.useRemote) return msgSummary;
  return mockSummary();
}

// 异步从后端刷新未读汇总
function refreshMessageSummary() {
  if (!state.user) { msgSummary = { ...EMPTY_SUMMARY }; return Promise.resolve(msgSummary); }
  if (config.useRemote && state.token) {
    return getApi().getMessageSummary().then((s) => { if (s) msgSummary = s; return msgSummary; }).catch(() => msgSummary);
  }
  return Promise.resolve(mockSummary());
}

function mockSummary() {
  let like = 0, comment = 0, follow = 0;
  data.notifications.forEach((n) => {
    if (n.type === 'like' || n.type === 'collect') like++;
    else if (n.type === 'comment') comment++;
    else if (n.type === 'follow') follow++;
  });
  if (state.read.notify.like) like = 0;
  if (state.read.notify.comment) comment = 0;
  if (state.read.notify.follow) follow = 0;
  let conv = 0;
  data.conversations.forEach((c) => { if (!state.read.conv[c.id]) conv += c.unread || 0; });
  return { like, comment, follow, conv, total: like + comment + follow + conv };
}

function markNotifyRead(type) {
  if (config.useRemote && state.token) {
    getApi().readNotify(type).then((s) => { if (s) msgSummary = s; }).catch(() => {});
  } else {
    state.read.notify[type] = true;
    save(KEY.READ, state.read);
  }
}
function isNotifyRead(type) {
  return !!state.read.notify[type];
}
function markConvRead(id) {
  if (config.useRemote && state.token) {
    getApi().readConv(id).then((s) => { if (s) msgSummary = s; }).catch(() => {});
  } else {
    state.read.conv[id] = true;
    save(KEY.READ, state.read);
  }
}
function isConvRead(id) {
  if (config.useRemote) return false; // 远程：以后端返回的 unread 为准
  return !!state.read.conv[id];
}

module.exports = {
  init,
  getToken, setToken,
  getUser, setUser, login, syncMe, updateProfile, logout, isLogin,
  captureInvite, getPendingInvite,
  isLiked, toggleLike,
  isCollected, toggleCollect,
  pendingReactionDelta, flushReactions, startReactionSync,
  isFollowed, toggleFollow,
  likedIds, collectedIds, followedIds,
  markNotifyRead, isNotifyRead, markConvRead, isConvRead, messageUnread, refreshMessageSummary,
};
