// utils/store.js
// 本地状态管理：用户登录态、点赞/收藏/关注、已发布笔记，持久化到 Storage。

const KEY = {
  USER: 'xhs_user',
  LIKES: 'xhs_likes',
  COLLECTS: 'xhs_collects',
  FOLLOWS: 'xhs_follows',
  MY_NOTES: 'xhs_my_notes',
};

let state = {
  user: null,
  likes: {},
  collects: {},
  follows: {},
  myNotes: [],
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
  state.user = load(KEY.USER, null);
  state.likes = load(KEY.LIKES, {});
  state.collects = load(KEY.COLLECTS, {});
  state.follows = load(KEY.FOLLOWS, {});
  state.myNotes = load(KEY.MY_NOTES, []);
}

// ---------- 用户 ----------
function getUser() {
  return state.user;
}
function setUser(user) {
  state.user = user;
  save(KEY.USER, user);
  const app = getApp();
  if (app) app.globalData.userInfo = user;
}
function logout() {
  setUser(null);
}
function isLogin() {
  return !!state.user;
}

// ---------- 点赞 / 收藏 / 关注 ----------
function isLiked(id) {
  return !!state.likes[id];
}
function toggleLike(id) {
  if (state.likes[id]) delete state.likes[id];
  else state.likes[id] = Date.now();
  save(KEY.LIKES, state.likes);
  return !!state.likes[id];
}

function isCollected(id) {
  return !!state.collects[id];
}
function toggleCollect(id) {
  if (state.collects[id]) delete state.collects[id];
  else state.collects[id] = Date.now();
  save(KEY.COLLECTS, state.collects);
  return !!state.collects[id];
}

function isFollowed(uid) {
  return !!state.follows[uid];
}
function toggleFollow(uid) {
  if (state.follows[uid]) delete state.follows[uid];
  else state.follows[uid] = Date.now();
  save(KEY.FOLLOWS, state.follows);
  return !!state.follows[uid];
}

// 返回按时间排序的 id 列表
function likedIds() {
  return Object.keys(state.likes).sort((a, b) => state.likes[b] - state.likes[a]);
}
function collectedIds() {
  return Object.keys(state.collects).sort((a, b) => state.collects[b] - state.collects[a]);
}

// ---------- 我发布的笔记 ----------
function getMyNotes() {
  return state.myNotes;
}
function addMyNote(note) {
  state.myNotes.unshift(note);
  save(KEY.MY_NOTES, state.myNotes);
}

module.exports = {
  init,
  getUser, setUser, logout, isLogin,
  isLiked, toggleLike,
  isCollected, toggleCollect,
  isFollowed, toggleFollow,
  likedIds, collectedIds,
  getMyNotes, addMyNote,
};
