state.profileTab = 'collects';
state.messageUnread = 0;
state.darkPollTimer = null;

function requireWebLogin() {
  if (state.user) return true;
  showLoginModal();
  return false;
}

function interactionButton(action, active, icon, activeIcon, count) {
  return `<button class="small-action ${active ? 'active' : ''}" data-web-action="${action}"><b>${active ? activeIcon : icon}</b><span>${Number(count) || 0}</span></button>`;
}

renderNote = async function renderInteractiveNote(id) {
  setChrome();
  loading();
  try {
    const [note, mine] = await Promise.all([
      api(`/api/notes/${encodeURIComponent(id)}`),
      state.user ? api('/api/me').catch(() => null) : Promise.resolve(null),
    ]);
    if (mine && mine.user) state.user = mine.user;
    const liked = Boolean(mine && (mine.likes || []).includes(note.id));
    const collected = Boolean(mine && (mine.collects || []).includes(note.id));
    const authorId = String(note.authorId || note.author && note.author.id || '');
    const followed = Boolean(mine && (mine.follows || []).includes(authorId));
    const ownNote = Boolean(state.user && authorId && state.user.id === authorId);
    const images = note.images || [];
    const paragraphs = String(note.content || '').split(/\n\s*\n/).filter(Boolean);
    const dark = String(note.id || '').startsWith('dark_') || (note.tags || []).includes('暗盘资金');
    const media = dark
      ? images.map((src, index) => `${paragraphs[index] ? `<p class="paragraph">${escapeHtml(paragraphs[index])}</p>` : ''}<div class="detail-image-stage"><img class="detail-bg" src="${escapeHtml(imageUrl(src))}" alt=""><img class="detail-image" src="${escapeHtml(imageUrl(src))}" alt=""></div>`).join('')
        + paragraphs.slice(images.length).map((item) => `<p class="paragraph">${escapeHtml(item)}</p>`).join('')
      : `<div class="article-images">${images.map((src) => `<div class="detail-image-stage"><img class="detail-bg" src="${escapeHtml(imageUrl(src))}" alt=""><img class="detail-image" src="${escapeHtml(imageUrl(src))}" alt=""></div>`).join('')}</div>`;
    state.currentNote = { id: note.id, authorId };
    app.innerHTML = `<header class="page-nav"><button class="back" data-action="back">‹</button><div class="nav-author"><img src="${escapeHtml(imageUrl(note.author && note.author.avatar))}" alt=""><strong>${escapeHtml(note.author && note.author.name || '作者')}</strong>${ownNote ? '' : `<button class="follow ${followed ? 'followed' : ''}" data-web-action="follow" data-author-id="${escapeHtml(authorId)}">${followed ? '已关注' : '+ 关注'}</button>`}</div></header>${dark ? '' : media}<article class="article"><h1>${escapeHtml(note.title)}</h1>${dark ? media : paragraphs.map((item) => `<p class="paragraph">${escapeHtml(item)}</p>`).join('')}<div class="tags">${(note.tags || []).map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join('')}</div><div class="article-meta">${new Date(note.time || Date.now()).toLocaleDateString()}</div><div class="actionbar"><button class="primary" data-resource="${escapeHtml(note.id)}" data-free="${note.free === true}">${dark ? '查询暗盘' : '获取资料'}</button>${interactionButton('like', liked, '♡', '♥', note.likes)}${interactionButton('collect', collected, '☆', '★', note.collects)}</div><div id="resourceLinks" class="resource-links"></div></article>`;
  } catch (error) {
    app.innerHTML = `<div class="notice"><strong>笔记无法打开</strong>${escapeHtml(error.message)}</div>`;
  }
};

async function toggleNoteInteraction(action, button) {
  if (!requireWebLogin()) return;
  const noteId = state.currentNote && state.currentNote.id;
  if (!noteId) return;
  button.disabled = true;
  try {
    const result = await api(`/${action === 'like' ? 'api/like' : 'api/collect'}/${encodeURIComponent(noteId)}`, { method: 'POST' });
    const active = action === 'like' ? result.liked : result.collected;
    const count = action === 'like' ? result.likes : result.collects;
    button.classList.toggle('active', active);
    button.querySelector('b').textContent = action === 'like' ? (active ? '♥' : '♡') : (active ? '★' : '☆');
    button.querySelector('span').textContent = Number(count) || 0;
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function toggleAuthorFollow(button) {
  if (!requireWebLogin()) return;
  const authorId = String(button.dataset.authorId || '');
  if (!authorId) return;
  button.disabled = true;
  try {
    const result = await api(`/api/follow/${encodeURIComponent(authorId)}`, { method: 'POST' });
    button.classList.toggle('followed', result.followed);
    button.textContent = result.followed ? '已关注' : '+ 关注';
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

function profileLibraryHtml(tab, notes) {
  return `<section class="profile-library"><div class="profile-tabs"><button class="${tab === 'collects' ? 'active' : ''}" data-profile-tab="collects">收藏</button><button class="${tab === 'likes' ? 'active' : ''}" data-profile-tab="likes">赞过</button></div><div id="profileNotes" class="profile-notes">${notes.length ? waterfall(notes) : `<div class="empty">${tab === 'collects' ? '还没有收藏的笔记' : '还没有赞过的笔记'}</div>`}</div></section>`;
}

const WEB_SEARCH_HISTORY_KEY = 'nl_search_history';

function readSearchHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(WEB_SEARCH_HISTORY_KEY) || '[]');
    return Array.isArray(value) ? value.filter(Boolean).slice(0, 10) : [];
  } catch (_) {
    return [];
  }
}

function writeSearchHistory(history) {
  try { localStorage.setItem(WEB_SEARCH_HISTORY_KEY, JSON.stringify(history)); } catch (_) {}
}

function searchWordsHtml(words, hot = false) {
  return words.map((word) => `<button type="button" class="web-search-word ${hot ? 'hot' : ''}" data-search-word="${escapeHtml(word)}">${escapeHtml(word)}</button>`).join('');
}

function searchBodyHtml() {
  if (!state.searchSearched) {
    const historyBlock = state.searchHistory.length
      ? `<section class="web-search-block"><div class="web-search-block-head"><strong>搜索历史</strong><button type="button" data-action="search-clear-history" aria-label="清空搜索历史">⌫</button></div><div class="web-search-words">${searchWordsHtml(state.searchHistory)}</div></section>`
      : '';
    return `${historyBlock}<section class="web-search-block"><div class="web-search-block-head"><strong>🔥 热门搜索</strong></div><div class="web-search-words">${searchWordsHtml(state.searchHot, true)}</div></section>`;
  }
  if (state.searchLoading) return '<div class="web-search-placeholder">搜索中...</div>';
  if (!state.searchResults.length) return `<div class="web-search-placeholder">没有找到「${escapeHtml(state.searchKeyword)}」相关内容</div>`;
  return `<section class="web-search-results">${waterfall(state.searchResults)}</section>`;
}

function drawSearch({ focus = false, restoreScroll = false } = {}) {
  state.route = 'search';
  tabs.classList.add('hidden');
  app.innerHTML = `<div class="web-search-page"><header class="web-search-header"><form id="webSearchForm" class="web-search-bar"><div class="web-search-input-wrap"><i class="search-icon"></i><input id="webSearchInput" value="${escapeHtml(state.searchKeyword)}" placeholder="搜索" autocomplete="off" enterkeyhint="search" aria-label="搜索"><button type="button" class="web-search-clear ${state.searchKeyword ? '' : 'hidden'}" data-action="search-clear-input" aria-label="清空">×</button></div><button type="button" class="web-search-cancel" data-action="search-cancel">取消</button></form></header><main class="web-search-content">${searchBodyHtml()}</main></div>`;
  if (focus) requestAnimationFrame(() => document.querySelector('#webSearchInput')?.focus());
  if (restoreScroll) requestAnimationFrame(() => window.scrollTo(0, Number(state.searchScrollY) || 0));
}

async function renderSearch() {
  stopDarkPolling();
  const firstVisit = !state.searchInitialized;
  if (firstVisit) {
    state.searchInitialized = true;
    state.searchKeyword = '';
    state.searchSearched = false;
    state.searchLoading = false;
    state.searchResults = [];
    state.searchHistory = readSearchHistory();
    state.searchHot = [];
    state.searchScrollY = 0;
  }
  drawSearch({ focus: firstVisit, restoreScroll: !firstVisit });
  if (state.searchHot.length || state.searchHotLoading) return;
  state.searchHotLoading = true;
  try {
    const hot = await api('/api/hotSearch');
    state.searchHot = Array.isArray(hot) ? hot : [];
    if (state.route === 'search' && !state.searchSearched) drawSearch();
  } catch (_) {
    state.searchHot = [];
  } finally {
    state.searchHotLoading = false;
  }
}

async function executeWebSearch(keyword = state.searchKeyword) {
  const value = String(keyword || '').trim();
  if (!value) return;
  state.searchKeyword = value;
  state.searchHistory = [value, ...state.searchHistory.filter((item) => item !== value)].slice(0, 10);
  writeSearchHistory(state.searchHistory);
  state.searchSearched = true;
  state.searchLoading = true;
  state.searchResults = [];
  state.searchScrollY = 0;
  const requestId = (state.searchRequestId || 0) + 1;
  state.searchRequestId = requestId;
  drawSearch();
  try {
    const results = await api(`/api/search?kw=${encodeURIComponent(value)}`);
    if (requestId !== state.searchRequestId) return;
    state.searchResults = Array.isArray(results) ? results : [];
  } catch (error) {
    if (requestId !== state.searchRequestId) return;
    state.searchResults = [];
    toast('搜索失败，请稍后重试');
  } finally {
    if (requestId === state.searchRequestId) {
      state.searchLoading = false;
      if (state.route === 'search') drawSearch();
    }
  }
}

function profileContactHtml() {
  return `<section class="profile-service-actions"><button type="button" class="profile-service-button" data-action="enterprise-contact"><span class="profile-service-icon">企</span><span><strong>咨询人工</strong><small>售前咨询及售后服务</small></span></button><button type="button" class="profile-service-button" data-action="wechat-payment-code"><span class="profile-service-icon payment">收</span><span><strong>老客扫码复购</strong><small>微信二维码</small></span></button></section>`;
}

function closeEnterpriseWechatModal() {
  const host = document.querySelector('#enterpriseWechatModalHost');
  if (host) host.remove();
}

function showEnterpriseWechatModal() {
  closeEnterpriseWechatModal();
  const host = document.createElement('div');
  host.id = 'enterpriseWechatModalHost';
  host.innerHTML = `<div class="wechat-modal-mask"><section class="wechat-sheet"><div class="wechat-sheet-handle"></div><h2>咨询人工</h2><p>长按或扫码添加企业微信，进行售前咨询及售后服务</p><img src="/web/assets/enterprise-wechat.jpg" alt="咨询人工二维码"><button type="button" class="wechat-sheet-close">关闭</button></section></div>`;
  document.body.appendChild(host);
  const mask = host.querySelector('.wechat-modal-mask');
  const close = host.querySelector('.wechat-sheet-close');
  mask.addEventListener('click', (event) => {
    if (event.target === mask) closeEnterpriseWechatModal();
  });
  close.addEventListener('click', closeEnterpriseWechatModal);
}
window.showEnterpriseWechatModal = showEnterpriseWechatModal;

function showWechatPaymentCodeModal() {
  closeEnterpriseWechatModal();
  const host = document.createElement('div');
  host.id = 'enterpriseWechatModalHost';
  host.innerHTML = `<div class="wechat-modal-mask"><section class="wechat-sheet"><div class="wechat-sheet-handle"></div><h2>老客扫码复购</h2><p>长按保存或使用微信扫描二维码</p><img src="/web/assets/wechat-payment.jpg" alt="微信二维码"><button type="button" class="wechat-sheet-close">关闭</button></section></div>`;
  document.body.appendChild(host);
  const mask = host.querySelector('.wechat-modal-mask');
  mask.addEventListener('click', (event) => {
    if (event.target === mask) closeEnterpriseWechatModal();
  });
  host.querySelector('.wechat-sheet-close').addEventListener('click', closeEnterpriseWechatModal);
}

const renderProfileBase = renderProfile;
renderProfile = async function renderInteractiveProfile() {
  await renderProfileBase();
  if (!state.user) return;
  try {
    const [summary, notes] = await Promise.all([
      api('/api/system-notifications/summary'),
      api(`/api/me/${state.profileTab}`),
    ]);
    state.messageUnread = Number(summary && summary.unread) || 0;
    const messageItem = document.querySelector('[data-action="messages"]');
    if (messageItem && state.messageUnread) messageItem.insertAdjacentHTML('beforeend', `<span class="web-menu-badge">${Math.min(99, state.messageUnread)}</span>`);
    const gift = document.querySelector('#giftPanel');
    if (gift) gift.insertAdjacentHTML('beforebegin', profileContactHtml() + profileLibraryHtml(state.profileTab, notes || []));
  } catch (error) {
    toast(error.message);
  }
};

async function loadProfileTab(tab) {
  state.profileTab = tab;
  const container = document.querySelector('#profileNotes');
  if (container) container.innerHTML = '<div class="empty">加载中...</div>';
  try {
    const notes = await api(`/api/me/${tab}`);
    document.querySelectorAll('[data-profile-tab]').forEach((item) => item.classList.toggle('active', item.dataset.profileTab === tab));
    if (container) container.innerHTML = notes.length ? waterfall(notes) : `<div class="empty">${tab === 'collects' ? '还没有收藏的笔记' : '还没有赞过的笔记'}</div>`;
  } catch (error) {
    if (container) container.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

function messageTime(value) {
  const timestamp = Number(value) || 0;
  const diff = Math.max(0, Date.now() - timestamp);
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return new Date(timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

const messageIcons = { followed_note: '文', dark_recharge: '充', dark_ready: '暗', gold_changed: '金' };

async function renderMessages() {
  if (!requireWebLogin()) return;
  stopDarkPolling();
  state.route = 'profile';
  setChrome();
  loading();
  try {
    const result = await api('/api/system-notifications');
    state.messageUnread = Number(result.unread) || 0;
    const list = result.list || [];
    app.innerHTML = `<div class="messages-page"><header class="page-nav"><button class="back" data-action="back">‹</button><div class="nav-title">全部消息</div></header>${list.length ? `<div class="message-list">${list.map((item) => `<article class="message-item ${Number(item.readAt) ? '' : 'unread'}" data-message-id="${escapeHtml(item.id)}" data-target-type="${escapeHtml(item.targetType)}" data-target-id="${escapeHtml(item.targetId)}"><span class="message-icon ${escapeHtml(item.type)}">${messageIcons[item.type] || '信'}</span><div class="message-body"><div class="message-title-row"><strong>${escapeHtml(item.title)}</strong><time>${messageTime(item.createdAt)}</time></div><p>${escapeHtml(item.content)}</p></div>${Number(item.readAt) ? '' : '<i class="unread-dot"></i>'}<b class="message-arrow">›</b></article>`).join('')}</div>` : '<div class="empty">暂时没有消息</div>'}</div>`;
  } catch (error) {
    app.innerHTML = `<div class="notice"><strong>消息加载失败</strong>${escapeHtml(error.message)}</div>`;
  }
}

async function openSystemMessage(item) {
  try {
    if (item.classList.contains('unread')) await api('/api/system-notifications/read', { method: 'POST', body: JSON.stringify({ id: item.dataset.messageId }) });
  } catch (_) {}
  const type = item.dataset.targetType;
  const id = item.dataset.targetId;
  if (type === 'note' && id) return openNote(id);
  if (type === 'dark_history') {
    history.pushState({ route: 'dark' }, '', '#dark');
    return renderDark('orders');
  }
  if (type === 'dark_home') return navigate('dark');
  if (type === 'gold') return navigate('gold');
  item.classList.remove('unread');
  const dot = item.querySelector('.unread-dot');
  if (dot) dot.remove();
}

function darkOrdersHtml(orders) {
  if (!orders.length) return '<div class="empty">暂无查询记录</div>';
  return orders.map((order) => {
    const ready = order.ready === true || order.status === 'READY' || order.status === 'SUCCESS';
    const failed = String(order.status).includes('FAILED');
    return `<article class="order" data-order="${escapeHtml(order.id)}" data-ready="${ready}"><div><strong>${escapeHtml(order.stockCode)}</strong><small>${formatTime(order.createdAt)}</small></div><span class="status ${ready ? 'ready' : ''}">${ready ? '点击查看' : (failed ? '查询失败' : '等待结果')}</span></article>`;
  }).join('');
}

function updateDarkBadge(orders) {
  const button = document.querySelector('[data-dark-tab="orders"]');
  if (!button) return;
  button.querySelector('.web-tab-badge')?.remove();
  const unread = orders.filter((item) => item.unread).length;
  if (unread) button.insertAdjacentHTML('beforeend', `<span class="web-tab-badge">${Math.min(99, unread)}</span>`);
}

function stopDarkPolling() {
  if (state.darkPollTimer) clearInterval(state.darkPollTimer);
  state.darkPollTimer = null;
}

async function refreshDarkOrders(mode) {
  if (state.route !== 'dark' || !state.user || !document.querySelector('.dark-page')) {
    stopDarkPolling();
    return false;
  }
  try {
    const orders = await api('/api/dark-funds/orders');
    updateDarkBadge(orders);
    if (mode === 'orders') {
      const list = document.querySelector('.order-list');
      if (list) list.innerHTML = darkOrdersHtml(orders);
    }
    const pending = orders.some((item) => !item.ready && !String(item.status).includes('FAILED'));
    if (!pending) stopDarkPolling();
    return pending;
  } catch (_) {
    stopDarkPolling();
    return false;
  }
}

const renderDarkBase = renderDark;
renderDark = async function renderEventDrivenDark(mode = 'query') {
  stopDarkPolling();
  await renderDarkBase(mode);
  if (!state.user || !document.querySelector('.dark-page')) return;
  await refreshDarkOrders(mode);
};

const openNoteBase = openNote;
openNote = function openNoteWithoutPolling(id) {
  stopDarkPolling();
  return openNoteBase(id);
};

const renderRouteBase = renderRoute;
renderRoute = function renderFeatureRoute(name) {
  if (name !== 'dark') stopDarkPolling();
  if (name === 'messages') return renderMessages();
  if (name === 'search') return renderSearch();
  return renderRouteBase(name);
};

document.addEventListener('submit', (event) => {
  if (event.target.id !== 'webSearchForm') return;
  event.preventDefault();
  const input = document.querySelector('#webSearchInput');
  executeWebSearch(input ? input.value : '');
});

document.addEventListener('input', (event) => {
  if (event.target.id !== 'webSearchInput') return;
  state.searchRequestId = (state.searchRequestId || 0) + 1;
  state.searchKeyword = event.target.value;
  state.searchSearched = false;
  state.searchLoading = false;
  state.searchResults = [];
  document.querySelector('.web-search-clear')?.classList.toggle('hidden', !state.searchKeyword);
  const content = document.querySelector('.web-search-content');
  if (content) content.innerHTML = searchBodyHtml();
});

document.addEventListener('click', (event) => {
  if (state.route === 'search' && event.target.closest('[data-note]')) state.searchScrollY = window.scrollY;
}, true);

document.addEventListener('click', (event) => {
  const interaction = event.target.closest('[data-web-action]');
  if (interaction) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (interaction.dataset.webAction === 'follow') return toggleAuthorFollow(interaction);
    return toggleNoteInteraction(interaction.dataset.webAction, interaction);
  }
  const profileTab = event.target.closest('[data-profile-tab]');
  if (profileTab) return loadProfileTab(profileTab.dataset.profileTab);
  const message = event.target.closest('[data-message-id]');
  if (message) return openSystemMessage(message);
  const searchWord = event.target.closest('[data-search-word]');
  if (searchWord) return executeWebSearch(searchWord.dataset.searchWord);
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'search-clear-history') {
    state.searchHistory = [];
    writeSearchHistory([]);
    return drawSearch();
  }
  if (action === 'search-clear-input') {
    state.searchRequestId = (state.searchRequestId || 0) + 1;
    state.searchKeyword = '';
    state.searchSearched = false;
    state.searchLoading = false;
    state.searchResults = [];
    return drawSearch({ focus: true });
  }
  if (action === 'search-cancel') return history.length > 1 ? history.back() : navigate('home');
  if (action === 'enterprise-contact') {
    event.preventDefault();
    event.stopImmediatePropagation();
    return showEnterpriseWechatModal();
  }
  if (action === 'wechat-payment-code') {
    event.preventDefault();
    event.stopImmediatePropagation();
    return showWechatPaymentCodeModal();
  }
  if (action === 'messages') {
    event.preventDefault();
    event.stopImmediatePropagation();
    history.pushState({ route: 'messages' }, '', '#messages');
    return renderMessages();
  }
});
