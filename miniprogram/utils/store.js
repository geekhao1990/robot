// utils/store.js
// 状态层：后端为数据源，本地仅作运行时缓存 + 离线镜像。
// 登录后从 /api/me 拉取交互状态；点赞/收藏/关注/发布等写操作回传后端。
// 草稿仍只存本地（见 publish 页）。

const data = require('../mock/data');
const config = require('./config');
// 懒加载 api，避免与 api.js 形成循环依赖
function getApi() {
  return require('./api');
}

const KEY = {
  TOKEN: 'xhs_token',
  USER: 'xhs_user',
  LIKES: 'xhs_likes',
  COLLECTS: 'xhs_collects',
  FOLLOWS: 'xhs_follows',
  MY_NOTES: 'xhs_my_notes',
  READ: 'xhs_read',
};

let state = {
  token: null,
  user: null,
  likes: {},
  collects: {},
  follows: {},
  myNotes: [],
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

function init() {
  state.token = load(KEY.TOKEN, null);
  state.user = load(KEY.USER, null);
  state.likes = load(KEY.LIKES, {});
  state.collects = load(KEY.COLLECTS, {});
  state.follows = load(KEY.FOLLOWS, {});
  state.myNotes = load(KEY.MY_NOTES, []);
  state.read = load(KEY.READ, { notify: {}, conv: {} });
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
  return !!state.user;
}

// 登录：远程换取 token + 用户并同步交互状态；离线则降级为本地
function login(profile) {
  if (config.useRemote || config.wechatAuthRemote) {
    return getApi()
      .login(profile)
      .then((res) => {
        setToken(res.token);
        setUser(res.user);
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
    vip: false,
  });
  return Promise.resolve(state.user);
}

// 从后端刷新当前用户 + 交互状态
function syncMe() {
  if (!config.useRemote || !state.token) return Promise.resolve(state.user);
  return getApi()
    .getMe()
    .then((d) => {
      if (d && d.user) setUser(d.user);
      state.likes = toMap(d.likes);
      state.collects = toMap(d.collects);
      state.follows = toMap(d.follows);
      save(KEY.LIKES, state.likes);
      save(KEY.COLLECTS, state.collects);
      save(KEY.FOLLOWS, state.follows);
      return state.user;
    })
    .catch(() => state.user);
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

// ---------- 点赞 / 收藏 / 关注（乐观更新 + 回传后端） ----------
function isLiked(id) {
  return !!state.likes[id];
}
function toggleLike(id) {
  const liked = !state.likes[id];
  if (liked) state.likes[id] = Date.now();
  else delete state.likes[id];
  save(KEY.LIKES, state.likes);
  if (config.useRemote && state.token) {
    getApi().likeNote(id).catch(() => revert(state.likes, KEY.LIKES, id, liked));
  }
  return liked;
}

function isCollected(id) {
  return !!state.collects[id];
}
function toggleCollect(id) {
  const collected = !state.collects[id];
  if (collected) state.collects[id] = Date.now();
  else delete state.collects[id];
  save(KEY.COLLECTS, state.collects);
  if (config.useRemote && state.token) {
    getApi().collectNote(id).catch(() => revert(state.collects, KEY.COLLECTS, id, collected));
  }
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

// ---------- 我发布的笔记（仅本地/离线回退用；远程以 api.getMyNotes 为准） ----------
function getMyNotes() {
  return state.myNotes;
}
function addMyNote(note) {
  state.myNotes.unshift(note);
  save(KEY.MY_NOTES, state.myNotes);
}
function removeMyNote(id) {
  state.myNotes = state.myNotes.filter((n) => n.id !== id);
  save(KEY.MY_NOTES, state.myNotes);
}
function updateMyNote(note) {
  const i = state.myNotes.findIndex((n) => n.id === note.id);
  if (i > -1) {
    state.myNotes[i] = note;
    save(KEY.MY_NOTES, state.myNotes);
  }
}
function getMyNote(id) {
  return state.myNotes.find((n) => n.id === id) || null;
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
  getUser, setUser, login, syncMe, logout, isLogin,
  isLiked, toggleLike,
  isCollected, toggleCollect,
  isFollowed, toggleFollow,
  likedIds, collectedIds, followedIds,
  getMyNotes, addMyNote, removeMyNote, updateMyNote, getMyNote,
  markNotifyRead, isNotifyRead, markConvRead, isConvRead, messageUnread, refreshMessageSummary,
};
