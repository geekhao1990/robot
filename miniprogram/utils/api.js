// utils/api.js
// 模拟接口层：基于 mock 数据 + 本地交互状态，返回 Promise，模拟网络延迟。

const data = require('../mock/data');
const store = require('./store');
const config = require('./config');

function delay(result, ms = 300) {
  return new Promise((resolve) => setTimeout(() => resolve(result), ms));
}

function remote() {
  return !!config.useRemote;
}

// 通用请求封装（支持鉴权 token）
function request(method, path, { data, auth } = {}) {
  return new Promise((resolve, reject) => {
    const header = { 'Content-Type': 'application/json' };
    if (auth && store.getToken && store.getToken()) {
      header.Authorization = 'Bearer ' + store.getToken();
    }
    wx.request({
      url: config.baseUrl + path,
      method,
      data: data || {},
      header,
      success: (r) => {
        if (r.statusCode >= 200 && r.statusCode < 300) resolve(r.data);
        else reject(r);
      },
      fail: reject,
    });
  });
}

function http(path, query) {
  return request('GET', path, { data: query, auth: true });
}

// 合并用户交互状态到笔记。
// 远程模式：后端计数已包含当前用户的赞/藏，只标记状态，不再 +1，避免重复计数。
// 本地 mock：计数为静态数据，需按用户状态 +1。
function decorate(note) {
  if (!note) return note;
  const liked = store.isLiked(note.id);
  const collected = store.isCollected(note.id);
  const bump = remote() ? 0 : 1;
  return {
    ...note,
    liked,
    collected,
    likes: note.likes + (liked ? bump : 0),
    collects: note.collects + (collected ? bump : 0),
  };
}

// 所有笔记（mock + 用户发布）
function allNotes() {
  return [...store.getMyNotes(), ...data.notes];
}

// 首页 feed：home 全部 | material 资料 | course 课程
function getFeed({ tab = 'home', page = 1, size = 10 } = {}) {
  if (remote()) {
    // 带上登录态，「关注」流需按当前用户的关注关系过滤
    return request('GET', '/api/feed', { data: { tab, page, size }, auth: true })
      .then((r) => ({ list: (r.list || []).map(decorate), hasMore: r.hasMore, total: r.total }));
  }
  return mockFeed({ tab, page, size });
}

function mockFeed({ tab = 'home', page = 1, size = 10 } = {}) {
  let list = allNotes();
  if (tab === 'home') {
    list = list.slice().sort((a, b) => b.time - a.time);
  } else if (tab === 'course') {
    list = list.filter((n) => n.type === 'course').sort((a, b) => b.time - a.time);
  } else if (tab === 'material') {
    list = list.filter((n) => n.type !== 'course').sort((a, b) => b.time - a.time);
  }
  const start = (page - 1) * size;
  const slice = list.slice(start, start + size).map(decorate);
  return delay({
    list: slice,
    hasMore: start + size < list.length,
    total: list.length,
  });
}

function getNoteById(id) {
  if (remote()) {
    return http('/api/notes/' + id).then((n) => decorate(n));
  }
  const note = allNotes().find((n) => n.id === id);
  return delay(decorate(note));
}

function getResource(id) {
  return request('GET', '/api/notes/' + id + '/resource', { auth: true });
}

function getCategories() {
  if (remote()) return http('/api/categories').catch(() => delay(data.categories, 0));
  return delay(data.categories, 0);
}

function getHotSearch() {
  if (remote()) return http('/api/hotSearch').catch(() => delay(data.hotSearch, 0));
  return delay(data.hotSearch, 0);
}

function search(keyword) {
  const kw = (keyword || '').trim();
  if (!kw) return delay([]);
  if (remote()) {
    return http('/api/search', { kw })
      .then((list) => (list || []).map(decorate))
      .catch(() => mockSearch(kw));
  }
  return mockSearch(kw);
}

function mockSearch(kw) {
  const list = allNotes()
    .filter(
      (n) =>
        n.title.includes(kw) ||
        n.content.includes(kw) ||
        (n.category || '').includes(kw) ||
        (n.tags || []).some((t) => t.includes(kw)) ||
        n.author.name.includes(kw)
    )
    .map(decorate);
  return delay(list);
}

function getUserById(id) {
  if (remote()) return http('/api/users/' + id).catch(() => delay(data.userMap[id] || null));
  return delay(data.userMap[id] || null);
}

function getNotesByAuthor(authorId) {
  if (remote()) {
    return http('/api/users/' + authorId + '/notes')
      .then((list) => (list || []).map(decorate))
      .catch(() => delay(allNotes().filter((n) => n.authorId === authorId).map(decorate)));
  }
  return delay(allNotes().filter((n) => n.authorId === authorId).map(decorate));
}

// 我点赞 / 收藏的笔记
function getNotesByIds(ids) {
  const map = {};
  allNotes().forEach((n) => (map[n.id] = n));
  return delay(ids.map((id) => map[id]).filter(Boolean).map(decorate));
}

// ---------------- 登录 / 当前用户 ----------------
function login(profile) {
  return request('POST', '/api/login', { data: profile });
}

function getMe() {
  return request('GET', '/api/me', { auth: true });
}

// 上传图片，返回可访问 URL（用 wx.uploadFile）
function uploadImage(filePath) {
  return new Promise((resolve, reject) => {
    const header = {};
    if (store.getToken && store.getToken()) header.Authorization = 'Bearer ' + store.getToken();
    wx.uploadFile({
      url: config.baseUrl + '/api/upload',
      filePath,
      name: 'file',
      header,
      success: (r) => {
        if (r.statusCode >= 200 && r.statusCode < 300) {
          try { resolve(JSON.parse(r.data).url); } catch (e) { reject(e); }
        } else reject(r);
      },
      fail: reject,
    });
  });
}

// ---------------- 写操作（回传后端） ----------------
function likeNote(id) {
  return request('POST', '/api/like/' + id, { auth: true });
}
function collectNote(id) {
  return request('POST', '/api/collect/' + id, { auth: true });
}
function followUser(uid) {
  return request('POST', '/api/follow/' + uid, { auth: true });
}
function publishNote(payload) {
  return request('POST', '/api/notes', { auth: true, data: payload });
}
function updateNote(id, payload) {
  return request('PUT', '/api/notes/' + id, { auth: true, data: payload });
}
function deleteNote(id) {
  return request('DELETE', '/api/notes/' + id, { auth: true });
}

// 我的笔记 / 收藏 / 赞过（远程优先，失败回退本地）
function getMyNotes() {
  if (remote()) {
    return request('GET', '/api/me/notes', { auth: true })
      .then((list) => (list || []).map(decorate))
      .catch(() => delay(store.getMyNotes().map(decorate)));
  }
  return delay(store.getMyNotes().map(decorate));
}
function getMyCollects() {
  if (remote()) {
    return request('GET', '/api/me/collects', { auth: true })
      .then((list) => (list || []).map(decorate))
      .catch(() => getNotesByIds(store.collectedIds()));
  }
  return getNotesByIds(store.collectedIds());
}
function getMyLikes() {
  if (remote()) {
    return request('GET', '/api/me/likes', { auth: true })
      .then((list) => (list || []).map(decorate))
      .catch(() => getNotesByIds(store.likedIds()));
  }
  return getNotesByIds(store.likedIds());
}

// ---------------- 消息 ----------------
function getNotifications(type) {
  if (remote()) {
    return request('GET', '/api/notifications', { auth: true })
      .then((list) => (type && type !== 'all' ? (list || []).filter((n) => n.type === type) : list || []))
      .catch(() => mockNotifications(type));
  }
  return mockNotifications(type);
}

function mockNotifications(type) {
  let list = data.notifications;
  if (type && type !== 'all') list = list.filter((n) => n.type === type);
  list = list.map((n) => ({
    ...n,
    user: data.userMap[n.userId],
    note: n.noteId ? noteMapOf()[n.noteId] : null,
  }));
  return delay(list);
}

function noteMapOf() {
  const map = {};
  allNotes().forEach((n) => (map[n.id] = n));
  return map;
}

function getConversations() {
  if (remote()) {
    return request('GET', '/api/conversations', { auth: true }).catch(() => mockConversations());
  }
  return mockConversations();
}

function mockConversations() {
  const list = data.conversations.map((c) => ({
    ...c,
    user: data.userMap[c.userId],
    lastMsg: c.messages[c.messages.length - 1],
  }));
  return delay(list);
}

function getConversation(id) {
  if (remote()) {
    return request('GET', '/api/conversations/' + id, { auth: true }).catch(() => mockConversation(id));
  }
  return mockConversation(id);
}

function mockConversation(id) {
  const c = data.conversations.find((x) => x.id === id);
  if (!c) return delay(null);
  return delay({ ...c, user: data.userMap[c.userId] });
}

// 消息未读汇总
function getMessageSummary() {
  return request('GET', '/api/messages/summary', { auth: true });
}
// 发送私信，返回 { added:[mine, reply] }
function sendMessage(id, text) {
  return request('POST', '/api/conversations/' + id + '/messages', { auth: true, data: { text } });
}
// 标记已读
function readNotify(type) {
  return request('POST', '/api/notifications/read', { auth: true, data: { type } });
}
function readConv(id) {
  return request('POST', '/api/conversations/' + id + '/read', { auth: true });
}

// ---------------- 关注 / 粉丝 ----------------
function getFollowing() {
  if (remote()) {
    // 以后端为准；失败返回空，避免显示陈旧的本地缓存
    return request('GET', '/api/me/following', { auth: true }).catch(() => []);
  }
  const list = store.followedIds().map((id) => data.userMap[id]).filter(Boolean);
  return delay(list);
}

function getFans() {
  if (remote()) {
    return request('GET', '/api/me/fans', { auth: true }).catch(() => []);
  }
  // 本地模式无真实粉丝数据
  return delay([]);
}

function getFriends() {
  // 演示数据：以 mock 用户作为可分享的好友
  return delay(data.users.slice());
}

module.exports = {
  getFeed,
  getNoteById,
  getResource,
  getCategories,
  getHotSearch,
  search,
  getUserById,
  getNotesByAuthor,
  getNotesByIds,
  getNotifications,
  getConversations,
  getConversation,
  getMessageSummary,
  sendMessage,
  readNotify,
  readConv,
  getFollowing,
  getFans,
  getFriends,
  // 登录 / 当前用户
  login,
  getMe,
  // 写操作
  uploadImage,
  likeNote,
  collectNote,
  followUser,
  publishNote,
  updateNote,
  deleteNote,
  // 我的内容
  getMyNotes,
  getMyCollects,
  getMyLikes,
};
