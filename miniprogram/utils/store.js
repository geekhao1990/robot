// utils/store.js
// 本地状态管理：用户登录态、点赞/收藏/关注、已发布笔记，持久化到 Storage。

const data = require('../mock/data');

const KEY = {
  USER: 'xhs_user',
  LIKES: 'xhs_likes',
  COLLECTS: 'xhs_collects',
  FOLLOWS: 'xhs_follows',
  MY_NOTES: 'xhs_my_notes',
  READ: 'xhs_read',
};

let state = {
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
  state.user = load(KEY.USER, null);
  state.likes = load(KEY.LIKES, {});
  state.collects = load(KEY.COLLECTS, {});
  state.follows = load(KEY.FOLLOWS, {});
  state.myNotes = load(KEY.MY_NOTES, []);
  state.read = load(KEY.READ, { notify: {}, conv: {} });
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
function followedIds() {
  return Object.keys(state.follows).sort((a, b) => state.follows[b] - state.follows[a]);
}

// ---------- 我发布的笔记 ----------
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

// ---------- 消息已读状态 ----------
function markNotifyRead(type) {
  state.read.notify[type] = true;
  save(KEY.READ, state.read);
}
function isNotifyRead(type) {
  return !!state.read.notify[type];
}
function markConvRead(id) {
  state.read.conv[id] = true;
  save(KEY.READ, state.read);
}
function isConvRead(id) {
  return !!state.read.conv[id];
}

// 计算各类未读数（已读则归零）
function messageUnread() {
  if (!state.user) return { like: 0, comment: 0, follow: 0, conv: 0, total: 0 };
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
  data.conversations.forEach((c) => {
    if (!state.read.conv[c.id]) conv += c.unread || 0;
  });
  return { like, comment, follow, conv, total: like + comment + follow + conv };
}

module.exports = {
  init,
  getUser, setUser, logout, isLogin,
  isLiked, toggleLike,
  isCollected, toggleCollect,
  isFollowed, toggleFollow,
  likedIds, collectedIds, followedIds,
  getMyNotes, addMyNote, removeMyNote,
  markNotifyRead, isNotifyRead, markConvRead, isConvRead, messageUnread,
};
