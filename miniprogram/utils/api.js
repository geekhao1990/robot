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

// 简单 GET 请求封装
function http(path, query) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.baseUrl + path,
      data: query || {},
      method: 'GET',
      success: (r) => {
        if (r.statusCode >= 200 && r.statusCode < 300) resolve(r.data);
        else reject(r);
      },
      fail: reject,
    });
  });
}

// 合并用户交互状态到笔记：若用户已点赞/收藏，则在基础数上 +1 并标记状态
function decorate(note) {
  if (!note) return note;
  const liked = store.isLiked(note.id);
  const collected = store.isCollected(note.id);
  return {
    ...note,
    liked,
    collected,
    likes: note.likes + (liked ? 1 : 0),
    collects: note.collects + (collected ? 1 : 0),
  };
}

// 所有笔记（mock + 用户发布）
function allNotes() {
  return [...store.getMyNotes(), ...data.notes];
}

// 首页 feed（按顶部 tab 筛选 + 简单分页）
// tab: 'discover' 发现(推荐) | 'home' 首页(最新) | 'follow' 关注
function getFeed({ tab = 'discover', page = 1, size = 10 } = {}) {
  if (remote()) {
    return http('/api/feed', { tab, page, size })
      .then((r) => ({ list: (r.list || []).map(decorate), hasMore: r.hasMore, total: r.total }))
      .catch(() => mockFeed({ tab, page, size }));
  }
  return mockFeed({ tab, page, size });
}

function mockFeed({ tab = 'discover', page = 1, size = 10 } = {}) {
  let list = allNotes();
  if (tab === 'home') {
    list = list.slice().sort((a, b) => b.time - a.time);
  } else if (tab === 'follow') {
    list = list.filter((n) => store.isFollowed(n.authorId));
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
    return http('/api/notes/' + id)
      .then((n) => decorate(n))
      .catch(() => delay(decorate(allNotes().find((n) => n.id === id))));
  }
  const note = allNotes().find((n) => n.id === id);
  return delay(decorate(note));
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

// ---------------- 消息 ----------------
function getNotifications(type) {
  let list = data.notifications;
  if (type && type !== 'all') {
    list = list.filter((n) => n.type === type);
  }
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
  const list = data.conversations.map((c) => ({
    ...c,
    user: data.userMap[c.userId],
    lastMsg: c.messages[c.messages.length - 1],
  }));
  return delay(list);
}

function getConversation(id) {
  const c = data.conversations.find((x) => x.id === id);
  if (!c) return delay(null);
  return delay({ ...c, user: data.userMap[c.userId] });
}

// ---------------- 关注 / 粉丝 ----------------
function getFollowing() {
  const list = store.followedIds().map((id) => data.userMap[id]).filter(Boolean);
  return delay(list);
}

function getFans() {
  // 演示数据：以 mock 用户作为粉丝
  return delay(data.users.slice());
}

function getFriends() {
  // 演示数据：以 mock 用户作为可分享的好友
  return delay(data.users.slice());
}

module.exports = {
  getFeed,
  getNoteById,
  getCategories,
  getHotSearch,
  search,
  getUserById,
  getNotesByAuthor,
  getNotesByIds,
  getNotifications,
  getConversations,
  getConversation,
  getFollowing,
  getFans,
  getFriends,
};
