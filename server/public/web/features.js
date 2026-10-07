state.profileTab = 'collects';
state.messageUnread = 0;
state.darkPollTimer = null;
state.darkHistoryPage = 1;
state.darkHistoryTotalPages = 1;
state.darkStockSuggestion = null;
state.darkStockLookupError = '';
state.messagePage = 1;
state.goldRefreshPolicy = null;

const WEB_GOLD_REFRESH_WINDOW_MS = 5 * 60 * 1000;
const WEB_GOLD_REFRESH_LIMIT = 2;

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
    toast(queryMode === 'close' ? '查询失败，请稍后再试' : (error.message || '查询失败，请稍后再试'));
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

async function renderMessages(page = state.messagePage || 1) {
  if (!requireWebLogin()) return;
  stopDarkPolling();
  state.route = 'profile';
  setChrome();
  loading();
  try {
    const result = await api(`/api/system-notifications?page=${encodeURIComponent(page)}`);
    state.messageUnread = Number(result.unread) || 0;
    state.messagePage = Number(result.page) || 1;
    const totalPages = Number(result.totalPages) || 1;
    const list = result.list || [];
    app.innerHTML = `<div class="messages-page"><header class="page-nav"><button class="back" data-action="back">‹</button><div class="nav-title">全部消息</div></header>${list.length ? `<div class="message-list">${list.map((item) => `<article class="message-item ${Number(item.readAt) ? '' : 'unread'}" data-message-id="${escapeHtml(item.id)}" data-target-type="${escapeHtml(item.targetType)}" data-target-id="${escapeHtml(item.targetId)}"><span class="message-icon ${escapeHtml(item.type)}">${messageIcons[item.type] || '信'}</span><div class="message-body"><div class="message-title-row"><strong>${escapeHtml(item.title)}</strong><time>${messageTime(item.createdAt)}</time></div><p>${escapeHtml(item.content)}</p></div>${Number(item.readAt) ? '' : '<i class="unread-dot"></i>'}<b class="message-arrow">›</b></article>`).join('')}</div><div class="web-pagination"><button data-message-page="${state.messagePage - 1}" ${state.messagePage <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${state.messagePage} / ${totalPages} 页</span><button data-message-page="${state.messagePage + 1}" ${state.messagePage >= totalPages ? 'disabled' : ''}>下一页</button></div>` : '<div class="empty">暂时没有消息</div>'}</div>`;
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
    const type = order.queryMode === 'close' ? '普通查询' : '决策查询';
    const name = order.stockDisplayName || darkQueryStockName(order.stockName);
    const marketCode = `${/^[569]/.test(String(order.stockCode || '')) ? 'sh' : 'sz'}${order.stockCode || ''}`;
    return `<article class="order" data-order="${escapeHtml(order.id)}" data-ready="${ready}"><div><div class="order-stock-name">${name ? `<strong>${escapeHtml(name)}</strong>` : ''}<span>${escapeHtml(marketCode)}</span></div><small>${escapeHtml(type)} · ${formatTime(order.createdAt)}</small></div><span class="status ${ready ? 'ready' : ''}">${ready ? '点击查看' : (failed ? '查询失败' : '等待结果')}</span></article>`;
  }).join('');
}

function webDarkPagination(page, totalPages) {
  return `<div class="web-pagination"><button data-dark-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${page} / ${totalPages} 页</span><button data-dark-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>下一页</button></div>`;
}

function drawDarkStockDropdown() {
  const host = document.querySelector('#stockLookupDropdown');
  if (!host) return;
  if (state.darkStockLookupLoading) {
    host.className = 'stock-dropdown visible';
    host.innerHTML = '<div class="stock-dropdown-row muted">正在确认股票信息…</div>';
    return;
  }
  if (state.darkStockLookupError) {
    host.className = 'stock-dropdown visible error';
    host.innerHTML = `<div class="stock-dropdown-row">${escapeHtml(state.darkStockLookupError)}</div>`;
    return;
  }
  if (state.darkStockSuggestion) {
    const item = state.darkStockSuggestion;
    host.className = 'stock-dropdown visible';
    host.innerHTML = `<div class="stock-dropdown-row"><strong>${escapeHtml(item.stockCode)}</strong><span>${escapeHtml(item.stockDisplayName || darkQueryStockName(item.stockName) || '新股或未收录，可继续提交')}</span></div>`;
    return;
  }
  host.className = 'stock-dropdown';
  host.innerHTML = '';
}

async function lookupWebStock(rawCode) {
  const stockCode = String(rawCode || '').replace(/\D/g, '').slice(0, 6);
  const sequence = (state.darkStockLookupSequence || 0) + 1;
  state.darkStockLookupSequence = sequence;
  state.darkStockSuggestion = null;
  state.darkStockLookupError = '';
  state.darkStockLookupLoading = false;
  if (!/^\d{6}$/.test(stockCode)) return drawDarkStockDropdown();
  if (/^(4|8|92)/.test(stockCode)) {
    state.darkStockLookupError = '系统繁忙';
    drawDarkStockDropdown();
    return;
  }
  state.darkStockLookupLoading = true;
  drawDarkStockDropdown();
  try {
    const result = await api(`/api/stocks/lookup?code=${encodeURIComponent(stockCode)}`);
    if (sequence !== state.darkStockLookupSequence) return;
    state.darkStockSuggestion = {
      stockCode: String(result.stockCode || stockCode),
      stockName: String(result.stockName || ''),
      stockDisplayName: String(result.stockDisplayName || ''),
    };
  } catch (error) {
    if (sequence !== state.darkStockLookupSequence) return;
    state.darkStockLookupError = error.message || '股票信息确认失败';
  } finally {
    if (sequence === state.darkStockLookupSequence) {
      state.darkStockLookupLoading = false;
      drawDarkStockDropdown();
    }
  }
}

async function loadWebDarkOrders(page = 1, showToast = false) {
  const result = await api(`/api/dark-funds/orders?page=${encodeURIComponent(page)}`);
  const orders = Array.isArray(result) ? result : (result.list || []);
  state.darkHistoryPage = Number(result.page) || 1;
  state.darkHistoryTotalPages = Number(result.totalPages) || 1;
  const list = document.querySelector('.order-list');
  if (list) list.innerHTML = darkOrdersHtml(orders);
  document.querySelector('#darkHistoryPagination')?.remove();
  if (list) list.insertAdjacentHTML('afterend', `<div id="darkHistoryPagination">${webDarkPagination(state.darkHistoryPage, state.darkHistoryTotalPages)}</div>`);
  const tab = document.querySelector('[data-dark-tab="orders"]');
  if (tab) {
    tab.querySelector('.web-tab-badge')?.remove();
    const unread = Number(result.unread) || 0;
    if (unread) tab.insertAdjacentHTML('beforeend', `<span class="web-tab-badge">${Math.min(99, unread)}</span>`);
  }
  if (showToast) toast('工单状态已刷新');
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
  // Web 中查询入口始终可见；具体通道权限仍由提交接口校验。
  const refreshMeBase = refreshMe;
  let originalDarkFundEnabled;
  let originalDarkFundRemaining;
  let syntheticAccess = false;
  refreshMe = async function refreshMeWithVisibleDarkEntries() {
    const user = await refreshMeBase();
    originalDarkFundEnabled = user.darkFundEnabled;
    originalDarkFundRemaining = user.darkFundRemaining;
    syntheticAccess = !user.darkFundEnabled || Number(user.darkFundRemaining) <= 0;
    if (syntheticAccess) {
      user.darkFundEnabled = true;
      user.darkFundRemaining = 1;
    }
    return user;
  };
  try {
    await renderDarkBase(mode);
  } finally {
    refreshMe = refreshMeBase;
    if (syntheticAccess && state.user) {
      state.user.darkFundEnabled = originalDarkFundEnabled;
      state.user.darkFundRemaining = originalDarkFundRemaining;
    }
  }
  if (!state.user || !document.querySelector('.dark-page')) return;
  if (mode === 'query') {
    const input = document.querySelector('#stockCode');
    if (input && !document.querySelector('#stockLookupDropdown')) {
      input.insertAdjacentHTML('afterend', '<div id="stockLookupDropdown" class="stock-dropdown"></div>');
    }
    state.darkStockSuggestion = null;
    state.darkStockLookupError = '';
    state.darkStockLookupLoading = false;
    await refreshDarkOrders('query');
    return;
  }
  const refresh = document.querySelector('[data-action="dark-refresh"]');
  if (refresh) {
    refresh.dataset.action = 'dark-refresh-page';
    refresh.textContent = '请手动刷新工单状态';
    refresh.classList.add('dark-refresh-primary');
  }
  try {
    await loadWebDarkOrders(state.darkHistoryPage || 1);
  } catch (error) {
    toast(error.message || '订单加载失败');
  }
};

submitDark = async function submitDarkWithLookup(requestedMode = 'close') {
  const input = document.querySelector('#stockCode');
  const code = String(input && input.value || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(code)) return toast('请输入6位代码');
  if (/^(4|8|92)/.test(code)) return toast('系统繁忙');
  if (state.darkStockLookupLoading) return toast('正在确认股票信息');
  if (!state.darkStockSuggestion || state.darkStockSuggestion.stockCode !== code) {
    return toast(state.darkStockLookupError || '请先确认股票代码');
  }
  const stockName = state.darkStockSuggestion.stockName;
  const displayName = state.darkStockSuggestion.stockDisplayName || darkQueryStockName(stockName);
  const dateText = String(state.darkTradeDate || '').trim();
  const queryMode = requestedMode === 'intraday' ? 'intraday' : 'close';
  const source = queryMode === 'intraday' ? 'collector' : 'web';
  const description = queryMode === 'intraday'
    ? `是否查询暗盘【盘中】数据：${code}${displayName ? ` ${displayName}` : ''}，查询日期${dateText}`
    : `是否进行普通查询：${code}${displayName ? ` ${displayName}` : ''}，查询近7日暗盘数据`;
  if (!confirm(description)) return;
  const requestId = `web_${Date.now()}_${queryMode}_${source}_${Math.random().toString(36).slice(2, 9)}`;
  try {
    const order = await api(`/api/dark-funds/orders/${queryMode}`, { method: 'POST', body: JSON.stringify({ stockCode: code, request_id: requestId }) });
    try { localStorage.removeItem('nl_dark_pending_request'); } catch (_) {}
    if (order.ready && order.resultType === 'close_snapshot') {
      history.pushState({ darkOrder: order.orderId }, '', `#dark-result/${encodeURIComponent(order.orderId)}`);
      return renderCloseDarkResult(order);
    }
    toast(order.ready ? '盘后数据已生成' : '工单已提交，请在订单列表查看');
    state.darkHistoryPage = 1;
    renderDark('orders');
  } catch (error) {
    toast(error.message);
  }
};

const renderDarkQueryModesBase = renderDark;
renderDark = async function renderDarkQueryModes(mode = 'query') {
  await renderDarkQueryModesBase(mode);
  const darkTabs = document.querySelectorAll('.dark-page .tabs button');
  if (darkTabs[0]) darkTabs[0].textContent = '查暗盘';
  if (darkTabs[1]) darkTabs[1].textContent = '订单列表';
  if (mode !== 'query') return;
  const card = document.querySelector('.query-card');
  const actions = card && card.querySelector('.query-actions');
  if (!actions) return;
  const input = card.querySelector('#stockCode');
  if (input) input.placeholder = '请输入6位代码';
  const tradeDate = card.querySelector('.trade-date');
  if (tradeDate) {
    state.darkTradeDate = String(tradeDate.textContent || '').replace(/^查询日期[：:]\s*/, '').trim();
    tradeDate.remove();
  }
  let queue = {};
  try {
    const tradeDateResult = await api('/api/dark-funds/trade-date');
    queue = tradeDateResult.queue || {};
  } catch (_) {}
  const queueCopy = (label, entry = {}) => {
    const ahead = Math.max(0, Number(entry.ahead) || 0);
    const seconds = Math.max(0, Number(entry.estimatedWaitSeconds) || 0);
    return `<span class="dark-query-label">${label}</span><small>前方排队${ahead}人，预计等待${seconds}秒</small>`;
  };
  actions.innerHTML = `<button class="primary dark-query-button" data-dark-query-submit="intraday">${queueCopy('决策查询', queue.intraday)}</button><button class="close-query dark-query-button" data-dark-query-submit="close">${queueCopy('普通查询', queue.close)}</button>`;
  actions.insertAdjacentHTML('afterend', profileServiceActionsHtml().replace('profile-service-actions', 'profile-service-actions dark-service-actions'));
};

const DARK_STOCK_NAME_INITIALS = { 股:'G',份:'F',科:'K',技:'J',集:'J',团:'T',银:'Y',行:'H',能:'N',源:'Y',实:'S',业:'Y',发:'F',展:'Z',电:'D',子:'Z',生:'S',物:'W',医:'Y',药:'Y',新:'X',材:'C' };
function darkQueryStockName(name) {
  const chars = Array.from(String(name || '').trim());
  if (chars.length <= 2) return chars.join('');
  return `${chars.slice(0, 2).join('')}${chars.slice(2).map((char) => DARK_STOCK_NAME_INITIALS[char] || char).join('')}`;
}

function closeMoneyUnit(days) {
  const values = days.flatMap((row) => ['main', 'grey', 'listed'].map((key) => Math.abs(Number(row[key]) || 0)));
  return Math.max(...values, 0) >= 100000000 ? { divisor: 100000000, label: '亿元' } : { divisor: 10000, label: '万元' };
}

function closeMoney(value, unit) {
  const number = (Number(value) || 0) / unit.divisor;
  return number.toFixed(2);
}

function closeBalancedMain(row, unit) {
  const round = (value) => Number(((Number(value) || 0) / unit.divisor).toFixed(2));
  const main = round(row.main);
  let listed = round(row.listed);
  let grey = round(row.grey);
  const residual = Number((main - listed - grey).toFixed(2));
  if (Math.abs(listed) >= Math.abs(grey)) listed = Number((listed + residual).toFixed(2));
  else grey = Number((grey + residual).toFixed(2));
  return { main, listed, grey };
}

function closeMarketCode(code) {
  const value = String(code || '').replace(/^(sh|sz)/i, '');
  return `${/^[569]/.test(value) ? 'sh' : 'sz'}${value}`;
}

function closeHybridStockName(name, initials) {
  const stockName = String(name || '').trim();
  const letters = String(initials || '').replace(/[^a-z]/gi, '').toUpperCase();
  if (!stockName) return letters;
  if (stockName.length <= 2 || !letters) return stockName;
  return `${stockName.slice(0, 2)}${letters.slice(2) || stockName.slice(2)}`;
}

function closeRolling(days, size) {
  return days.map((row, index) => index + 1 < size ? null : ({
    date: row.tradeDate.slice(5),
    value: days.slice(index - size + 1, index + 1).reduce((sum, item) => sum + Number(item.grey || 0), 0),
  })).filter(Boolean).slice(-7);
}

function closeChartHtml(days, size, unit) {
  const points = closeRolling(days, size);
  const max = Math.max(...points.map((item) => Math.abs(item.value)), 1);
  return `<div class="close-chart">${points.map((item) => `<div class="close-bar-column"><small class="${item.value >= 0 ? 'money-up' : 'money-down'}">${closeMoney(item.value, unit)}</small><i class="${item.value >= 0 ? 'up' : 'down'}" style="height:${Math.max(12, Math.round(Math.abs(item.value) / max * 112))}px"></i><span>${escapeHtml(item.date)}</span></div>`).join('')}</div>`;
}

function closeDayChartHtml(latest, unit) {
  const balanced = closeBalancedMain(latest, unit);
  const points = [
    { date: '主力明盘', value: Number(latest.listed) || 0, text: balanced.listed.toFixed(2) },
    { date: '主力暗盘', value: Number(latest.grey) || 0, text: balanced.grey.toFixed(2) },
    { date: '散户流入', value: -(Number(latest.main) || 0) },
  ];
  const max = Math.max(...points.map((item) => Math.abs(item.value)), 1);
  return `<div class="close-chart close-day-chart">${points.map((item) => `<div class="close-bar-column"><small class="${item.value >= 0 ? 'money-up' : 'money-down'}">${item.text || closeMoney(item.value, unit)}</small><i class="${item.value >= 0 ? 'up' : 'down'}" style="height:${Math.max(12, Math.round(Math.abs(item.value) / max * 112))}px"></i><span>${escapeHtml(item.date)}</span></div>`).join('')}</div>`;
}

function closeTableHtml(rows, unit, detail = false) {
  const columns = detail
    ? [['super_large', '超大单'], ['large', '大单'], ['middle', '中单'], ['small', '小单']]
    : [['main', '主力'], ['grey', '暗盘'], ['listed', '明盘']];
  return `<div class="close-table-scroll"><table class="close-table"><thead><tr><th>日期</th>${columns.map(([, label]) => `<th>${label}</th>`).join('')}</tr></thead><tbody>${rows.slice().reverse().slice(0, 7).map((row) => {
    const balanced = detail ? null : closeBalancedMain(row, unit);
    return `<tr><td>${escapeHtml(row.tradeDate.slice(5))}</td>${columns.map(([key]) => `<td class="${Number(row[key]) >= 0 ? 'money-up' : 'money-down'}">${balanced && Object.prototype.hasOwnProperty.call(balanced, key) ? balanced[key].toFixed(2) : closeMoney(row[key], unit)}</td>`).join('')}</tr>`;
  }).join('')}</tbody></table></div>`;
}

function renderCloseDarkResult(order) {
  const result = order && order.snapshot && order.snapshot.result;
  if (!result || result.type !== 'close_snapshot' || !Array.isArray(result.days) || !result.days.length) return toast('盘后数据不存在');
  const days = result.days.slice().sort((a, b) => String(a.tradeDate).localeCompare(String(b.tradeDate)));
  const unit = closeMoneyUnit(days);
  const latest = days[days.length - 1];
  state.route = 'dark-result';
  setChrome();
  const rolling3 = closeRolling(days, 3);
  const rolling5 = closeRolling(days, 5);
  const main = Number(latest.main) || 0;
  app.innerHTML = `<div class="close-result-page"><header class="page-nav"><button class="back" data-action="back">‹</button><div class="nav-title">盘后暗盘</div></header><section class="close-result-hero"><div><strong>${escapeHtml(closeHybridStockName(result.stockName, result.stockInitials))}</strong><span>${escapeHtml(closeMarketCode(result.stockCode))}</span></div><small>${escapeHtml(result.tradeDate)} · ${escapeHtml(result.versionLabel || '收盘')}</small></section><section class="close-result-card"><h3 class="close-flow-title"><i></i><span>主力流向(${unit.label})</span><b></b></h3><div class="close-summary"><div><span>主力净流入</span><b class="${main >= 0 ? 'money-up' : 'money-down'}">${closeMoney(main, unit)}</b></div><div><span>散户流入</span><b class="${-main >= 0 ? 'money-up' : 'money-down'}">${closeMoney(-main, unit)}</b></div></div>${closeDayChartHtml(latest, unit)}</section>${rolling3.length ? `<section class="close-result-card"><h3>3日暗盘滚动</h3>${closeChartHtml(days, 3, unit)}</section>` : ''}${rolling5.length ? `<section class="close-result-card"><h3>5日暗盘滚动</h3>${closeChartHtml(days, 5, unit)}</section>` : ''}<section class="close-result-card"><h3>资金明细</h3>${closeTableHtml(days, unit)}</section><section class="close-result-card"><h3>分单明细</h3>${closeTableHtml(days, unit, true)}</section><p class="close-disclaimer">数据来自互联网，仅供参考，不构成投资建议</p></div>`;
}

const renderCloseDarkResultDisclaimerBase = renderCloseDarkResult;
renderCloseDarkResult = function renderCloseDarkResultWithDisclaimer(order) {
  const output = renderCloseDarkResultDisclaimerBase(order);
  const disclaimer = document.querySelector('.close-disclaimer');
  if (disclaimer) disclaimer.textContent = '数据和图表来自互联网，由AI生成，仅供参考，不构成投资建议';
  return output;
};

openOrder = async function openDarkOrderByResultType(id, ready) {
  if (!ready) return toast('结果尚未就绪');
  try {
    const order = await api(`/api/dark-funds/orders/${encodeURIComponent(id)}`);
    if (order.resultType === 'close_snapshot') {
      history.pushState({ darkOrder: id }, '', `#dark-result/${encodeURIComponent(id)}`);
      return renderCloseDarkResult(order);
    }
    if (order.noteId) return openNote(order.noteId);
    return toast('查询结果不存在');
  } catch (error) {
    toast(error.message);
  }
};

const renderLocationDarkResultBase = renderLocation;
renderLocation = function renderLocationWithDarkResult() {
  const hash = (location.hash || '#home').slice(1);
  if (!hash.startsWith('dark-result/')) return renderLocationDarkResultBase();
  const id = decodeURIComponent(hash.slice('dark-result/'.length));
  loading();
  return api(`/api/dark-funds/orders/${encodeURIComponent(id)}`)
    .then(renderCloseDarkResult)
    .catch((error) => { app.innerHTML = `<div class="notice"><strong>普通查询结果加载失败</strong>${escapeHtml(error.message || '请稍后重试')}</div>`; });
};
window.addEventListener('popstate', () => {
  if ((location.hash || '').slice(1).startsWith('dark-result/')) renderLocation();
});

function reserveWebGoldRefreshAttempt() {
  const userId = state.user && state.user.id || 'unknown';
  const key = `nl_gold_refresh_history_${userId}`;
  const now = Date.now();
  let history = [];
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    history = Array.isArray(saved) ? saved : [];
  } catch (_) {}
  history = history.filter((time) => Number(time) > now - WEB_GOLD_REFRESH_WINDOW_MS);
  if (history.length >= WEB_GOLD_REFRESH_LIMIT) return false;
  history.push(now);
  try { localStorage.setItem(key, JSON.stringify(history)); } catch (_) {}
  return true;
}

renderGold = async function renderGoldWithRefresh(page = 0) {
  state.route = 'gold';
  state.goldPage = page;
  setChrome();
  loading();
  if (!state.user) {
    app.innerHTML = `<div class="notice"><strong>登录后使用金手指</strong>登录后可核验金手指卡或服务包权益<div class="actions"><button class="primary" data-action="open-login">登录</button></div></div><div id="loginModalHost"></div>`;
    return;
  }
  try {
    await refreshMe();
    if (!state.user.goldAccess) {
      app.innerHTML = accessGate('金手指');
      return;
    }
    const latest = await api('/api/gold-finger/latest');
    const history = page ? await api(`/api/gold-finger/history?page=${encodeURIComponent(page)}`) : null;
    const records = history ? history.records : (latest.records || []);
    state.goldRefreshPolicy = latest.refreshPolicy || null;
    app.innerHTML = `<div class="gold-page"><header class="page-nav"><button class="back" data-action="back">‹</button><div class="nav-title">金手指</div><span class="vip-chip">金手指卡</span></header>${(latest.banners || []).slice(0, 1).map((banner) => `<img class="banner" src="${escapeHtml(imageUrl(banner.image))}" data-note="${escapeHtml(banner.noteId)}" alt="">`).join('')}<section class="history-card"><div class="history-title-row"><div class="history-title">点金历史</div><button class="gold-refresh-button" data-action="web-gold-refresh">手动刷新</button></div>${historyTable(records)}${history ? `<div class="pager"><button data-gold-page="${history.page - 1}" ${history.hasPrev ? '' : 'disabled'}>上一页</button><span>第 ${history.page} / ${history.totalPages} 页</span><button data-gold-page="${history.page + 1}" ${history.hasNext ? '' : 'disabled'}>下一页</button></div>` : '<div class="pager"><button data-gold-page="1" style="display:block;width:100%;margin:0;text-align:center">查看更多历史</button></div>'}</section><div class="disclaimer">数据来自互联网，仅供参考不构成投资建议</div></div>`;
  } catch (error) {
    app.innerHTML = `<div class="notice"><strong>金手指暂不可用</strong>${escapeHtml(error.message)}</div>`;
  }
};

async function refreshWebGold() {
  const button = document.querySelector('[data-action="web-gold-refresh"]');
  if (!button || button.disabled) return;
  if (!reserveWebGoldRefreshAttempt()) return toast('操作频繁，请稍后再试');
  button.disabled = true;
  button.textContent = '更新中…';
  const policy = state.goldRefreshPolicy || {};
  const shouldRequestData = !Number(policy.nextRefreshAt) || Number(policy.nextRefreshAt) <= Date.now();
  try {
    if (shouldRequestData) {
      await renderGold(state.goldPage || 0);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 450));
      const current = document.querySelector('[data-action="web-gold-refresh"]');
      if (current) {
        current.disabled = false;
        current.textContent = '手动刷新';
      }
    }
    toast('金手指已更新');
  } catch (_) {
    if (button && document.body.contains(button)) {
      button.disabled = false;
      button.textContent = '手动刷新';
    }
    toast('刷新失败，请稍后重试');
  }
}

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
  if (event.target.id === 'stockCode') {
    const sanitized = String(event.target.value || '').replace(/\D/g, '').slice(0, 6);
    if (event.target.value !== sanitized) event.target.value = sanitized;
    lookupWebStock(sanitized);
    return;
  }
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
  const querySubmit = event.target.closest('[data-dark-query-submit]');
  if (querySubmit) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return submitDark(querySubmit.dataset.darkQuerySubmit);
  }
  const darkPage = event.target.closest('[data-dark-page]');
  if (darkPage && !darkPage.disabled) {
    const page = Number(darkPage.dataset.darkPage);
    if (Number.isInteger(page) && page >= 1 && page <= state.darkHistoryTotalPages) loadWebDarkOrders(page);
    return;
  }
  const messagePage = event.target.closest('[data-message-page]');
  if (messagePage && !messagePage.disabled) {
    const page = Number(messagePage.dataset.messagePage);
    if (Number.isInteger(page) && page >= 1) renderMessages(page);
    return;
  }
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
  if (action === 'dark-refresh-page') return loadWebDarkOrders(1, true).catch((error) => toast(error.message || '刷新失败'));
  if (action === 'web-gold-refresh') return refreshWebGold();
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
