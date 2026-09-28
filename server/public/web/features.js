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
    app.innerHTML = `<header class="page-nav"><button class="back" data-action="back">‹</button><div class="nav-author"><img src="${escapeHtml(imageUrl(note.author && note.author.avatar))}" alt=""><strong>${escapeHtml(note.author && note.author.name || '作者')}</strong>${ownNote ? '' : `<button class="follow ${followed ? 'followed' : ''}" data-web-action="follow" data-author-id="${escapeHtml(authorId)}">${followed ? '已关注' : '+ 关注'}</button>`}</div></header>${dark ? '' : media}<article class="article"><h1>${escapeHtml(note.title)}</h1>${dark ? media : paragraphs.map((item) => `<p class="paragraph">${escapeHtml(item)}</p>`).join('')}<div class="ad-placeholder">广告位</div><div class="tags">${(note.tags || []).map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join('')}</div><div class="article-meta">${new Date(note.time || Date.now()).toLocaleDateString()}</div><div class="actionbar">${note.hasResource ? `<button class="primary" data-resource="${escapeHtml(note.id)}" data-free="${note.free === true}">${dark ? '查询暗盘' : '点击领取'}</button>` : ''}${interactionButton('like', liked, '♡', '♥', note.likes)}${interactionButton('collect', collected, '☆', '★', note.collects)}<button class="small-action ${dark ? 'disabled' : ''}"><b>↗</b><span>${dark ? '不可用' : '分享有礼'}</span></button><button class="small-action" data-action="contact"><b>◯</b><span>客服</span></button></div><div id="resourceLinks" class="resource-links"></div></article>`;
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
    if (gift) gift.insertAdjacentHTML('beforebegin', profileLibraryHtml(state.profileTab, notes || []));
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
renderDark = async function renderPollingDark(mode = 'query') {
  stopDarkPolling();
  await renderDarkBase(mode);
  if (!state.user || !document.querySelector('.dark-page')) return;
  const pending = await refreshDarkOrders(mode);
  if (pending && !state.darkPollTimer) state.darkPollTimer = setInterval(() => refreshDarkOrders(mode), 5000);
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
  return renderRouteBase(name);
};

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
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'messages') {
    event.preventDefault();
    event.stopImmediatePropagation();
    history.pushState({ route: 'messages' }, '', '#messages');
    return renderMessages();
  }
});
