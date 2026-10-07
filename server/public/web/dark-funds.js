/* Web 暗盘完整版：与小程序共用接口、队列、缓存和订单数据。 */
state.webDarkRankingDirection = state.webDarkRankingDirection || 'inflow';
state.webDarkRankingExpanded = state.webDarkRankingExpanded || '';
state.webDarkFundView = state.webDarkFundView || 'main';
state.webDarkDetailView = state.webDarkDetailView || 'core';

function wdfNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function wdfExpiry(value) {
  const date = new Date(Number(value) || 0);
  if (!Number(value) || !Number.isFinite(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function wdfOrderTime(value) {
  const date = new Date(Number(value) || 0);
  if (!Number(value) || !Number.isFinite(date.getTime())) return '—';
  const pad = (number) => String(number).padStart(2, '0');
  return `${String(date.getFullYear()).slice(-2)}${pad(date.getMonth() + 1)}${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function wdfOrderDay(value) {
  const date = new Date(Number(value) || 0);
  return Number.isFinite(date.getTime()) && Number(value) ? `${date.getMonth() + 1}月${date.getDate()}日` : '日期未知';
}

function wdfTabs(mode, unread = 0) {
  return `<div class="tabs wdf-tabs">
    <button class="${mode === 'query' ? 'active' : ''}" data-dark-tab="query">查暗盘</button>
    <button class="${mode === 'ranking' ? 'active' : ''}" data-dark-tab="ranking">今日暗盘榜</button>
    <button class="${mode === 'orders' ? 'active' : ''}" data-dark-tab="orders">订单列表${unread ? `<span class="web-tab-badge">${Math.min(99, unread)}</span>` : ''}</button>
  </div>`;
}

function wdfQuotaHtml(date) {
  const remaining = Number(date.remaining) || (Number(date.expiringRemaining) || 0) + (Number(date.permanentRemaining) || 0);
  const monthlyExpiry = wdfExpiry(date.closeMonthlyExpireAt || date.closeMonthlyExpiry);
  const quotaExpiry = wdfExpiry(date.quotaExpiresAt);
  return `<div class="wdf-benefits">
    <section class="wdf-quota">
      ${date.closeMonthlyActive === true ? `<div class="wdf-quota-main">普通查询包月：<b>无限查询</b>${monthlyExpiry ? `<small>有效至 ${monthlyExpiry}</small>` : ''}</div>` : ''}
      <div class="wdf-quota-main">剩余次数：<b>${remaining}</b></div>
      <div class="wdf-quota-row"><span>30天内到期</span><strong>${Number(date.expiringRemaining) || 0} 次${quotaExpiry ? `<small>（有效至 ${quotaExpiry}）</small>` : ''}</strong></div>
      <div class="wdf-quota-row"><span>长期有效</span><strong>${Number(date.permanentRemaining) || 0} 次</strong></div>
    </section>
    <section class="wdf-recharge" data-action="enterprise-contact"><i>企</i><div><b>充值暗盘次数</b><span>暗盘查询低至2毛4</span><span>更多套餐请咨询企业微信</span></div></section>
  </div>`;
}

function wdfQueryHtml(date) {
  const queue = date.queue || {};
  const queueText = (label, item = {}) => `<span class="dark-query-label">${label}</span><small>前方排队${Math.max(0, Number(item.ahead) || 0)}人，预计等待${Math.max(0, Number(item.estimatedWaitSeconds) || 0)}秒</small>`;
  state.darkTradeDate = String(date.compactTradeDate || date.tradeDate || '');
  return `<div class="query-wrap"><section class="query-card wdf-query-card">
    <input id="stockCode" class="stock-input" inputmode="numeric" maxlength="6" placeholder="请输入6位代码" aria-label="六位股票代码">
    <div id="stockLookupDropdown" class="stock-dropdown"></div>
    <div class="query-actions wdf-query-actions">
      <button class="primary dark-query-button" data-dark-query-submit="intraday">${queueText('决策查询', queue.intraday)}</button>
      <button class="close-query dark-query-button" data-dark-query-submit="close">${queueText('普通查询', queue.close)}</button>
    </div>
    ${wdfQuotaHtml(date)}
  </section></div>`;
}

function wdfOrderGroups(orders) {
  if (!orders.length) return '<div class="empty">暂无订单</div>';
  const groups = [];
  orders.forEach((order) => {
    const label = wdfOrderDay(order.createdAt);
    let group = groups[groups.length - 1];
    if (!group || group.label !== label) {
      group = { label, orders: [] };
      groups.push(group);
    }
    group.orders.push(order);
  });
  return groups.map((group) => `<section class="wdf-order-group"><h3>${escapeHtml(group.label)}<small>${group.orders.length}个订单</small></h3><div class="wdf-order-list">${group.orders.map((order) => {
    const ready = order.ready === true || order.status === 'READY' || order.status === 'SUCCESS';
    const failed = String(order.status || '').includes('FAILED');
    const type = order.queryMode === 'close' ? '普通查询' : '决策查询';
    const name = order.stockDisplayName || darkQueryStockName(order.stockName || '');
    const marketCode = closeMarketCode(order.stockCode || '');
    return `<article class="wdf-order" data-order="${escapeHtml(order.id)}" data-ready="${ready}">
      <div class="wdf-order-main"><div class="wdf-order-stock">${name ? `<strong>${escapeHtml(name)}</strong>` : ''}<span>${escapeHtml(marketCode)}</span></div><div class="wdf-order-meta"><b>${type}</b><span>查询时间：${escapeHtml(wdfOrderTime(order.createdAt))}</span></div></div>
      <div class="wdf-order-status ${ready ? 'ready' : ''} ${failed ? 'failed' : ''}">${ready ? '点击查看 ›' : (failed ? '查询失败' : '处理中')}</div>
    </article>`;
  }).join('')}</div></section>`).join('');
}

function darkOrdersHtml(orders) {
  return wdfOrderGroups(Array.isArray(orders) ? orders : []);
}

function wdfOrdersHtml(result) {
  const orders = Array.isArray(result) ? result : (result.list || []);
  const page = Array.isArray(result) ? 1 : Number(result.page) || 1;
  const pages = Array.isArray(result) ? 1 : Number(result.totalPages) || 1;
  state.darkHistoryPage = page;
  state.darkHistoryTotalPages = pages;
  return `<div class="wdf-history"><div class="wdf-history-head"><div><strong>查询记录</strong><span>共 ${Number(result.total) || orders.length} 个订单</span></div><button data-wdf-history-refresh>手动刷新</button></div><div id="darkOrdersHost">${wdfOrderGroups(orders)}</div>${webDarkPagination(page, pages)}</div>`;
}

function wdfRankingUnit(values) {
  const max = Math.max(0, ...values.map((value) => Math.abs(wdfNumber(value))));
  return max >= 100000000 ? { divisor: 100000000, suffix: '亿', digits: 2 } : { divisor: 10000, suffix: '万', digits: 1 };
}

function wdfRankingMoney(value, unit) {
  const number = wdfNumber(value) / unit.divisor;
  return `${number > 0 ? '+' : ''}${number.toFixed(unit.digits)}${unit.suffix}`;
}

function wdfDecorateRanking(item, side) {
  const grey = wdfNumber(item.grey);
  const listed = wdfNumber(item.listed);
  const main = Number.isFinite(Number(item.main)) ? Number(item.main) : grey + listed;
  const retail = Number.isFinite(Number(item.retail)) ? Number(item.retail) : -main;
  const unit = wdfRankingUnit([grey, listed, main, retail]);
  const bars = [{ label: '主力明盘', value: listed }, { label: '主力暗盘', value: grey }, { label: '散户流入', value: retail }];
  const maximum = Math.max(1, ...bars.map((bar) => Math.abs(bar.value)));
  return { ...item, side, key: `${side}:${item.stockCode}`, grey, listed, main, retail, unit, bars: bars.map((bar) => ({ ...bar, text: wdfRankingMoney(bar.value, unit), height: Math.max(12, Math.round(Math.abs(bar.value) / maximum * 92)) })) };
}

function wdfRankingItems(ranking, side) {
  return (ranking[side] || []).map((item) => wdfDecorateRanking(item, side));
}

function wdfRankingList(ranking, side) {
  const items = wdfRankingItems(ranking, side);
  if (!state.webDarkRankingExpanded && items.length) state.webDarkRankingExpanded = items[0].key;
  if (!items.length) return '<div class="empty">暂无榜单数据</div>';
  return `<div class="wdf-ranking-list">${items.map((item, index) => {
    const expanded = state.webDarkRankingExpanded === item.key;
    const change = Number.isFinite(Number(item.changePercent)) ? `${Number(item.changePercent) > 0 ? '+' : ''}${Number(item.changePercent).toFixed(2)}%` : '—';
    return `<article class="wdf-ranking-item">
      <div class="wdf-ranking-row" data-wdf-ranking-toggle="${escapeHtml(item.key)}"><i>${index + 1}</i><strong>${escapeHtml(item.stockName || '')}</strong><b class="${wdfNumber(item.changePercent) >= 0 ? 'money-up' : 'money-down'}">${change}</b><span class="${expanded ? 'expanded' : ''}"></span></div>
      <div class="wdf-ranking-money"><div><span>暗盘资金</span><b class="${item.grey >= 0 ? 'money-up' : 'money-down'}">${wdfRankingMoney(item.grey, item.unit)}</b></div><div><span>明盘资金</span><b class="${item.listed >= 0 ? 'money-up' : 'money-down'}">${wdfRankingMoney(item.listed, item.unit)}</b></div></div>
      ${expanded ? `<div class="wdf-ranking-snapshot"><h4>主力流向</h4><div class="wdf-ranking-summary"><div><span>主力净流入</span><b class="${item.main >= 0 ? 'money-up' : 'money-down'}">${wdfRankingMoney(item.main, item.unit)}</b></div><div><span>散户流入</span><b class="${item.retail >= 0 ? 'money-up' : 'money-down'}">${wdfRankingMoney(item.retail, item.unit)}</b></div></div><div class="wdf-ranking-chart"><div class="wdf-zero"></div>${item.bars.map((bar) => `<div class="wdf-rank-bar"><div class="wdf-rank-stack ${bar.value >= 0 ? 'positive' : 'negative'}">${bar.value >= 0 ? `<small class="money-up">${bar.text}</small><i class="up" style="height:${bar.height}px"></i>` : `<i class="down" style="height:${bar.height}px"></i><small class="money-down">${bar.text}</small>`}</div><span>${bar.label}</span></div>`).join('')}</div></div>` : ''}
    </article>`;
  }).join('')}</div>`;
}

function wdfRankingHtml(ranking) {
  if (!ranking || ranking.empty) return '<div class="wdf-ranking-empty">今日暗盘榜16点后更新</div>';
  const side = state.webDarkRankingDirection;
  return `<div class="wdf-ranking-page"><header class="wdf-ranking-head"><strong>${escapeHtml(ranking.title || '收盘暗盘榜')}</strong><span>${escapeHtml(ranking.updateHint || '每个交易日16点更新')}</span></header><div class="wdf-ranking-tabs"><button class="inflow ${side === 'inflow' ? 'active' : ''}" data-wdf-ranking-side="inflow">暗盘流入前十</button><button class="outflow ${side === 'outflow' ? 'active' : ''}" data-wdf-ranking-side="outflow">暗盘流出前十</button></div><div id="wdfRankingHost">${wdfRankingList(ranking, side)}</div><p class="wdf-ranking-tip">数据来自互联网和AI工具，不构成投资建议</p></div>`;
}

async function renderDarkEnhanced(mode = 'query') {
  const currentMode = ['query', 'ranking', 'orders'].includes(mode) ? mode : 'query';
  state.route = 'dark';
  setChrome();
  loading();
  try {
    await refreshMe();
    const datePromise = api('/api/dark-funds/trade-date');
    const contentPromise = currentMode === 'ranking'
      ? api('/api/dark-funds/ranking')
      : currentMode === 'orders' ? api(`/api/dark-funds/orders?page=${encodeURIComponent(state.darkHistoryPage || 1)}`) : api('/api/dark-funds/orders?page=1');
    const orderSummaryPromise = currentMode === 'ranking' ? api('/api/dark-funds/orders?page=1') : contentPromise;
    const [date, content, orderSummary] = await Promise.all([datePromise, contentPromise, orderSummaryPromise]);
    const unread = Number(orderSummary && orderSummary.unread) || 0;
    const body = currentMode === 'query' ? wdfQueryHtml(date) : currentMode === 'ranking' ? wdfRankingHtml(content) : wdfOrdersHtml(content);
    app.innerHTML = `<div class="dark-page wdf-page"><header class="page-nav"><button class="back" data-action="back">‹</button><div class="nav-title">暗盘资金</div></header>${wdfTabs(currentMode, unread)}${body}</div>`;
    if (currentMode === 'query') {
      state.darkStockSuggestion = null;
      state.darkStockLookupError = '';
      state.darkStockLookupLoading = false;
    }
    if (currentMode === 'ranking') state.webDarkRanking = content;
  } catch (error) {
    app.innerHTML = `<div class="notice"><strong>暗盘功能加载失败</strong>${escapeHtml(error.message || '请稍后再试')}</div>`;
  }
}

renderDark = renderDarkEnhanced;

loadWebDarkOrders = async function loadWebDarkOrdersEnhanced(page = 1, showToast = false) {
  const result = await api(`/api/dark-funds/orders?page=${encodeURIComponent(page)}`);
  state.darkHistoryPage = Number(result.page) || 1;
  state.darkHistoryTotalPages = Number(result.totalPages) || 1;
  const host = document.querySelector('#darkOrdersHost');
  if (host) {
    host.innerHTML = wdfOrderGroups(Array.isArray(result) ? result : (result.list || []));
    const pagination = host.parentElement.querySelector('.web-pagination');
    if (pagination) pagination.outerHTML = webDarkPagination(state.darkHistoryPage, state.darkHistoryTotalPages);
  }
  if (showToast) toast('订单已刷新');
};

function wdfChooseUnit(values) {
  return values.some((value) => Math.abs(wdfNumber(value)) >= 100000000)
    ? { divisor: 100000000, label: '亿元', suffix: '亿', digits: 2 }
    : { divisor: 10000, label: '万元', suffix: '万', digits: 1 };
}

function wdfUnitValue(value, unit) {
  const rounded = Math.round(wdfNumber(value) / unit.divisor * (10 ** unit.digits)) / (10 ** unit.digits);
  return Object.is(rounded, -0) ? 0 : rounded;
}

function wdfUnitText(value, unit, suffix = false) {
  return `${wdfUnitValue(value, unit).toFixed(unit.digits)}${suffix ? unit.suffix : ''}`;
}

function wdfBalanced(row, unit) {
  const main = wdfUnitValue(row.main, unit);
  let listed = wdfUnitValue(row.listed, unit);
  let grey = wdfUnitValue(row.grey, unit);
  const residual = Number((main - listed - grey).toFixed(unit.digits));
  if (Math.abs(listed) >= Math.abs(grey)) listed = Number((listed + residual).toFixed(unit.digits));
  else grey = Number((grey + residual).toFixed(unit.digits));
  return { main, listed, grey };
}

function wdfRolling(days, size) {
  return days.map((row, index) => ({ date: row.tradeDate.slice(5), value: index + 1 < size ? null : days.slice(index - size + 1, index + 1).reduce((sum, item) => sum + wdfNumber(item.grey), 0) }));
}

function wdfTrendSvg(series, unit) {
  const valid = series.map((item, index) => item.value === null ? null : { ...item, index }).filter(Boolean);
  if (!valid.length) return '<div class="wdf-trend-empty">历史数据不足，暂时无法绘制该周期</div>';
  const width = 720, height = 300, left = 86, right = 18, top = 22, bottom = 45;
  const values = valid.map((item) => item.value);
  let min = Math.min(0, ...values), max = Math.max(0, ...values);
  const span = Math.max(max - min, Math.abs(max), Math.abs(min), 1);
  min -= span * .12; max += span * .12;
  const x = (index) => left + (series.length <= 1 ? (width - left - right) / 2 : index / (series.length - 1) * (width - left - right));
  const y = (value) => top + (max - value) / (max - min) * (height - top - bottom);
  const zero = y(0);
  const points = valid.map((item) => `${x(item.index)},${y(item.value)}`).join(' ');
  const polygon = `${x(valid[0].index)},${zero} ${points} ${x(valid[valid.length - 1].index)},${zero}`;
  return `<svg class="wdf-trend-svg" viewBox="0 0 ${width} ${height}" role="img">
    <defs><clipPath id="wdfAbove"><rect x="${left}" y="${top}" width="${width-left-right}" height="${Math.max(0, zero-top)}"/></clipPath><clipPath id="wdfBelow"><rect x="${left}" y="${zero}" width="${width-left-right}" height="${Math.max(0, height-bottom-zero)}"/></clipPath></defs>
    ${[0,1,2,3,4].map((step) => { const value = max - (max-min)*step/4; return `<line x1="${left}" y1="${y(value)}" x2="${width-right}" y2="${y(value)}" stroke="#e9ecef" stroke-dasharray="5 5"/><text x="${left-8}" y="${y(value)+4}" text-anchor="end">${wdfUnitText(value, unit, true)}</text>`; }).join('')}
    <polygon points="${polygon}" fill="#ff0000" opacity=".78" clip-path="url(#wdfAbove)"/><polygon points="${polygon}" fill="#00ff00" opacity=".78" clip-path="url(#wdfBelow)"/>
    <line x1="${left}" y1="${zero}" x2="${width-right}" y2="${zero}" stroke="#9298a0"/><polyline points="${points}" fill="none" stroke="#ffe50a" stroke-width="4"/>
    ${series.map((item,index) => `<text x="${x(index)}" y="${height-14}" text-anchor="middle">${escapeHtml(item.date)}</text>`).join('')}
  </svg>`;
}

function wdfDayChart(latest, unit) {
  const balanced = wdfBalanced(latest, unit);
  const bars = [
    { label: '主力明盘', value: wdfNumber(latest.listed), text: balanced.listed.toFixed(unit.digits) },
    { label: '主力暗盘', value: wdfNumber(latest.grey), text: balanced.grey.toFixed(unit.digits) },
    { label: '散户流入', value: -wdfNumber(latest.main), text: wdfUnitText(-wdfNumber(latest.main), unit) },
  ];
  const maximum = Math.max(1, ...bars.map((bar) => Math.abs(bar.value)));
  return `<div class="wdf-flow-chart"><div class="wdf-flow-zero"></div>${bars.map((bar) => `<div class="wdf-flow-column"><div class="wdf-flow-stack ${bar.value >= 0 ? 'positive' : 'negative'}">${bar.value >= 0 ? `<b class="money-up">${bar.text}</b><i class="up" style="height:${Math.max(12, Math.round(Math.abs(bar.value)/maximum*112))}px"></i>` : `<i class="down" style="height:${Math.max(12, Math.round(Math.abs(bar.value)/maximum*112))}px"></i><b class="money-down">${bar.text}</b>`}</div><span>${bar.label}</span></div>`).join('')}</div>`;
}

function wdfResultTable(rows, detail) {
  const columns = detail ? [['super_large','特大单'],['large','大单'],['middle','中单'],['small','小单']] : [['main','主力净流入'],['grey','暗盘'],['listed','明盘']];
  return `<div class="wdf-table-scroll"><table class="wdf-table"><thead><tr><th>日期</th>${columns.map(([,label])=>`<th>${label}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => {
    const unit = wdfChooseUnit(columns.map(([key]) => row[key]));
    const balanced = detail ? null : wdfBalanced(row, unit);
    return `<tr><td>${escapeHtml(row.tradeDate.slice(5))}</td>${columns.map(([key]) => { const value = balanced && Object.prototype.hasOwnProperty.call(balanced,key) ? balanced[key].toFixed(unit.digits) + unit.suffix : wdfUnitText(row[key],unit,true); return `<td class="${wdfNumber(row[key]) >= 0 ? 'money-up':'money-down'}">${value}</td>`; }).join('')}</tr>`;
  }).join('')}</tbody></table></div>`;
}

function wdfResultContent() {
  const result = state.webDarkResult;
  const days = result.days;
  const latest = days[days.length - 1];
  const unit = wdfChooseUnit([latest.main, latest.listed, latest.grey]);
  const main = wdfNumber(latest.main);
  const view = state.webDarkFundView;
  let chart = wdfDayChart(latest, unit);
  if (view !== 'main') {
    const size = view === 'trend5' ? 5 : 3;
    const series = wdfRolling(days, size);
    const latestTrend = series.slice().reverse().find((item) => item.value !== null);
    const trendUnit = wdfChooseUnit([latestTrend ? latestTrend.value : 0]);
    chart = `<div class="wdf-trend-summary"><span>${size}日暗盘净流入</span><b class="${!latestTrend || latestTrend.value >= 0 ? 'money-up':'money-down'}">${latestTrend ? wdfUnitText(latestTrend.value,trendUnit,true):'—'}</b></div>${wdfTrendSvg(series,trendUnit)}`;
  }
  const rows = days.slice().reverse().slice(0,7);
  return `<section class="wdf-result-card"><h3>暗盘资金</h3><div class="wdf-segments"><button class="${view==='main'?'active':''}" data-wdf-fund-view="main">1日暗盘</button><button class="${view==='trend3'?'active':''}" data-wdf-fund-view="trend3">3日暗盘</button><button class="${view==='trend5'?'active':''}" data-wdf-fund-view="trend5">5日暗盘</button></div>${view === 'main' ? `<h4 class="wdf-flow-title"><i></i>主力流向(${unit.label})<span></span></h4><div class="wdf-result-summary"><div><span>主力净流入</span><b class="${main>=0?'money-up':'money-down'}">${wdfUnitText(main,unit)}</b></div><div><span>散户流入</span><b class="${-main>=0?'money-up':'money-down'}">${wdfUnitText(-main,unit)}</b></div></div>` : ''}${chart}</section>
    <section class="wdf-result-card"><h3>近7日资金情况</h3><div class="wdf-segments"><button class="${state.webDarkDetailView==='core'?'active':''}" data-wdf-detail-view="core">主力资金</button><button class="${state.webDarkDetailView==='orders'?'active':''}" data-wdf-detail-view="orders">资金结构</button></div>${wdfResultTable(rows,state.webDarkDetailView==='orders')}</section>`;
}

function renderCloseDarkResultEnhanced(order) {
  const result = order && order.snapshot && order.snapshot.result ? order.snapshot.result : order && order.result ? order.result : order;
  if (!result || result.type !== 'close_snapshot' || !Array.isArray(result.days) || !result.days.length) return toast('盘后数据不存在');
  result.days = result.days.slice().sort((a,b)=>String(a.tradeDate).localeCompare(String(b.tradeDate)));
  result.displayName = closeHybridStockName(result.stockName,result.stockInitials);
  result.displayCode = closeMarketCode(result.stockCode);
  state.webDarkResult = result;
  state.webDarkFundView = 'main';
  state.webDarkDetailView = 'core';
  state.route = 'dark-result';
  setChrome();
  app.innerHTML = `<div class="wdf-result-page"><header class="page-nav"><button class="back" data-action="back">‹</button><div class="nav-title">普通查询结果</div></header><section class="wdf-result-hero"><div class="wdf-result-stock"><strong>${escapeHtml(result.displayName)}</strong><span>${escapeHtml(result.displayCode)}</span><small>${escapeHtml(result.tradeDate)} · ${escapeHtml(result.versionLabel || '收盘')}</small></div><div class="wdf-poster-actions">${state.user && state.user.official ? '<button class="secondary" data-wdf-poster="noqr">无二维码分享图</button>' : ''}<button data-wdf-poster="qr">⇧ 生成分享图</button></div></section><div id="wdfResultContent">${wdfResultContent()}</div><p class="wdf-disclaimer">数据和图表来自互联网，由AI生成，仅供参考，不构成投资建议</p></div>`;
}

renderCloseDarkResult = renderCloseDarkResultEnhanced;

function wdfExactAmount(value) {
  const number = wdfNumber(value), sign = number > 0 ? '+' : number < 0 ? '-' : '', absolute = Math.abs(number);
  return absolute >= 100000000 ? `${sign}${(absolute/100000000).toFixed(2)}亿` : `${sign}${(absolute/10000).toFixed(1)}万`;
}

function wdfMaskedAmount(value) {
  const number = wdfNumber(value), sign = number < 0 ? '-' : '', absolute = Math.abs(number);
  const hide = (text) => { let count=0; return String(text).replace(/\d/g,(digit)=>count++<2?'x':digit); };
  if (absolute >= 100000000) return `${sign}${hide((absolute/100000000).toFixed(2))}亿元`;
  const amount = absolute/10000, text = Number.isInteger(amount) ? String(amount) : amount.toFixed(1).replace(/\.0$/,'');
  return `${sign}${hide(text || '0')}万`;
}

function wdfPosterMetrics(result) {
  const days = result.days, latest = days[days.length-1], sum = (size) => days.slice(-size).reduce((total,row)=>total+wdfNumber(row.grey),0);
  const unit = wdfChooseUnit([latest.main,latest.grey,latest.listed]), balanced = wdfBalanced(latest,unit);
  return { stockName: result.stockName || result.displayName, stockCode: result.displayCode || result.stockCode, tradeDate: result.tradeDate || latest.tradeDate, latest, day1:wdfNumber(latest.grey), day3:sum(3), day5:sum(5), day1Text:`${balanced.grey.toFixed(unit.digits)}${unit.suffix}`, day3Text:wdfMaskedAmount(sum(3)), day5Text:wdfMaskedAmount(sum(5)), barTexts:[balanced.listed.toFixed(unit.digits),balanced.grey.toFixed(unit.digits),wdfUnitText(-wdfNumber(latest.main),unit)] };
}

function wdfLoadImage(source) {
  return new Promise((resolve,reject)=>{ const image=new Image(); image.onload=()=>resolve(image); image.onerror=()=>reject(new Error('分享图素材加载失败')); image.src=source; });
}

async function wdfGeneratePoster(withoutQr) {
  if (!state.webDarkResult) return;
  toast('正在生成分享图');
  try {
    const [background,qr] = await Promise.all([wdfLoadImage('/web/assets/dark-share-bg-v2.jpg'),withoutQr?Promise.resolve(null):wdfLoadImage('/web/assets/indicator-warehouse-mini-code.jpg')]);
    const canvas=document.createElement('canvas'); canvas.width=750; canvas.height=1334;
    const context=canvas.getContext('2d'), metrics=wdfPosterMetrics(state.webDarkResult);
    wdfDrawPoster(context,metrics,background,qr,withoutQr);
    canvas.toBlob((blob)=>{ if(!blob)return toast('生成分享图失败'); const url=URL.createObjectURL(blob); wdfPosterModal(url,blob); },'image/png',1);
  } catch(error) { toast(error.message || '生成分享图失败'); }
}

function wdfRoundRect(context,x,y,w,h,r){context.beginPath();context.moveTo(x+r,y);context.lineTo(x+w-r,y);context.quadraticCurveTo(x+w,y,x+w,y+r);context.lineTo(x+w,y+h-r);context.quadraticCurveTo(x+w,y+h,x+w-r,y+h);context.lineTo(x+r,y+h);context.quadraticCurveTo(x,y+h,x,y+h-r);context.lineTo(x,y+r);context.quadraticCurveTo(x,y,x+r,y);context.closePath();}

function wdfDrawPoster(context,m,bg,qr,withoutQr){
  const fill=(text,x,y,size,color='#fff',weight='400',align='left')=>{context.font=`${weight} ${size}px "Microsoft YaHei",sans-serif`;context.fillStyle=color;context.textAlign=align;context.textBaseline='middle';context.fillText(String(text),x,y);};
  const valueColor=(value)=>wdfNumber(value)>=0?'#ff4148':'#00e4a8';
  const sourceRatio=bg.width/bg.height,targetRatio=750/1334,sw=sourceRatio>targetRatio?bg.height*targetRatio:bg.width,sh=sourceRatio>targetRatio?bg.height:bg.width/targetRatio;
  context.drawImage(bg,(bg.width-sw)/2,(bg.height-sh)/2,sw,sh,0,0,750,1334);context.fillStyle='rgba(0,0,0,.30)';context.fillRect(0,0,750,1334);
  context.save();context.translate(48,96);context.transform(1,0,-.13,1,0,0);context.font='900 68px "Microsoft YaHei",sans-serif';context.lineJoin='bevel';context.lineWidth=3;context.shadowColor='rgba(0,0,0,.88)';context.shadowBlur=9;context.shadowOffsetX=7;context.shadowOffsetY=8;const white=context.createLinearGradient(0,-38,0,38);white.addColorStop(0,'#fff');white.addColorStop(.53,'#aeb5bd');white.addColorStop(.72,'#fff');white.addColorStop(1,'#858d96');context.strokeStyle='#111820';context.strokeText('暗盘',0,0);context.fillStyle=white;context.fillText('暗盘',0,0);const first=context.measureText('暗盘').width+4,red=context.createLinearGradient(0,-38,0,38);red.addColorStop(0,'#ff5a5f');red.addColorStop(.5,'#a70d18');red.addColorStop(.72,'#ff343b');red.addColorStop(1,'#830812');context.strokeStyle='#3a0509';context.strokeText('追踪',first,0);context.fillStyle=red;context.fillText('追踪',first,0);context.restore();
  fill('主力资金 · 先人一步',50,142,23,'#d5dbe3');context.fillStyle='#ef343b';context.fillRect(48,174,654,3);
  wdfRoundRect(context,34,205,682,840,26);context.fillStyle='rgba(5,12,18,.90)';context.fill();context.strokeStyle='rgba(255,55,62,.55)';context.lineWidth=2;context.stroke();
  fill(m.stockName,62,266,46,'#fff','800');fill(m.stockCode,690,270,22,'#b8c2cf','400','right');fill(`${m.tradeDate} 收盘暗盘数据`,63,312,21,'#aab7c6');
  wdfRoundRect(context,52,350,418,246,20);context.fillStyle='rgba(0,64,54,.28)';context.fill();context.strokeStyle='rgba(0,228,168,.34)';context.stroke();fill('1日暗盘',78,397,33,'#fff','700');fill(m.day1Text,78,476,70,valueColor(m.day1),'800');fill(m.day1>=0?'今日暗盘资金净流入':'今日暗盘资金净流出',78,552,22,'#b6cbd2');
  [['3日暗盘净流入',m.day3Text,m.day3],['5日暗盘净流入',m.day5Text,m.day5]].forEach((item,index)=>{const y=350+index*123;wdfRoundRect(context,488,y,208,108,15);context.fillStyle='rgba(19,28,35,.92)';context.fill();context.strokeStyle='rgba(255,255,255,.08)';context.stroke();fill(item[0],510,y+31,18,'#dce3ea');fill(item[1],510,y+75,32,valueColor(item[2]),'700');});
  fill('1日暗盘资金截图',62,644,27,'#fff','700');fill('(单位：万元)',62,680,17,'#a8b4c1');const bars=[{label:'主力明盘',value:wdfNumber(m.latest.listed)},{label:'主力暗盘',value:wdfNumber(m.latest.grey)},{label:'散户流入',value:-wdfNumber(m.latest.main)}],maximum=Math.max(...bars.map(item=>Math.abs(item.value)),1),zeroY=826;context.strokeStyle='#89949f';context.beginPath();context.moveTo(65,zeroY);context.lineTo(685,zeroY);context.stroke();bars.forEach((bar,index)=>{const x=145+index*215,h=Math.max(18,Math.round(Math.abs(bar.value)/maximum*125));context.fillStyle=valueColor(bar.value);wdfRoundRect(context,x-24,bar.value>=0?zeroY-h:zeroY,48,h,5);context.fill();fill(m.barTexts[index]||wdfExactAmount(bar.value),x,bar.value>=0?zeroY-h-25:zeroY+h+25,20,valueColor(bar.value),'700','center');fill(bar.label,x,1015,21,'#d7dee6','400','center');});
  wdfRoundRect(context,34,1062,682,226,24);context.fillStyle='rgba(13,17,24,.94)';context.fill();context.strokeStyle='rgba(255,57,64,.42)';context.stroke();
  context.save();const glow=context.createRadialGradient(648,1084,4,648,1084,108);glow.addColorStop(0,'rgba(255,35,46,.34)');glow.addColorStop(1,'rgba(255,35,46,0)');context.fillStyle=glow;context.fillRect(520,1065,180,116);context.globalAlpha=.25;[1082,1112,1142,1172].forEach((y)=>{context.strokeStyle='#ad4650';context.beginPath();context.moveTo(526,y);context.lineTo(696,y);context.stroke();});[535,575,615,655,695].forEach((x)=>{context.strokeStyle='#71323a';context.beginPath();context.moveTo(x,1072);context.lineTo(x,1174);context.stroke();});context.globalAlpha=.9;[[540,1127,1160,1138,1152,'#00d7a0'],[565,1118,1151,1127,1144,'#ff3b43'],[590,1125,1155,1133,1147,'#00d7a0'],[615,1099,1140,1109,1132,'#ff3b43'],[640,1084,1125,1094,1118,'#ff3b43'],[665,1071,1109,1080,1102,'#ff3b43']].forEach(([x,high,low,top,bottom,color])=>{context.strokeStyle=color;context.lineWidth=2;context.beginPath();context.moveTo(x,high);context.lineTo(x,low);context.stroke();context.fillStyle=color;wdfRoundRect(context,x-6,top,12,Math.max(5,bottom-top),2);context.fill();});context.globalAlpha=1;context.strokeStyle='#ff343e';context.lineWidth=3;context.shadowColor='rgba(255,35,46,.9)';context.shadowBlur=10;context.beginPath();context.moveTo(532,1152);context.bezierCurveTo(565,1138,580,1147,603,1129);context.bezierCurveTo(626,1110,651,1093,686,1074);context.stroke();context.shadowColor='transparent';context.restore();
  const textX=withoutQr?64:254;if(!withoutQr){wdfRoundRect(context,54,1090,148,148,16);context.fillStyle='#fff';context.fill();context.drawImage(qr,60,1096,136,136);context.strokeStyle='rgba(255,255,255,.24)';context.beginPath();context.moveTo(226,1092);context.lineTo(226,1248);context.stroke();}
  fill('搜索“指标仓库”小程序',textX,1096,29,'#fff','800');fill('查看7天暗盘数据',textX,1139,21,'#d0d6dd','600');fill('实时追踪主力资金动向',textX,1168,18,'#9faab6');const ctaX=withoutQr?62:250,ctaWidth=withoutQr?630:442;const gradient=context.createLinearGradient(ctaX,1190,ctaX+ctaWidth,1248);gradient.addColorStop(0,'#ff4b50');gradient.addColorStop(1,'#c91422');wdfRoundRect(context,ctaX,1188,ctaWidth,62,17);context.fillStyle=gradient;context.fill();fill(withoutQr?'分享暗盘数据，关注“指标仓库”小程序':'长按识别小程序码，查看个股暗盘数据',ctaX+20,1219,18,'#fff','600');fill('数据来自互联网，仅供参考，不构成投资建议',375,1310,16,'#647180','400','center');
}

function wdfPosterModal(url,blob){
  document.querySelector('#wdfPosterModal')?.remove();const host=document.createElement('div');host.id='wdfPosterModal';host.className='wdf-poster-mask';host.innerHTML=`<section class="wdf-poster-sheet"><button class="wdf-poster-close" data-wdf-poster-close>×</button><img src="${url}" alt="暗盘分享图"><div><button data-wdf-poster-download>保存图片</button><button class="primary" data-wdf-poster-share>分享图片</button></div><small>可保存后发送到微信、朋友圈或其他平台</small></section>`;document.body.appendChild(host);host._posterUrl=url;host._posterBlob=blob;
}

document.addEventListener('click',async(event)=>{
  const historyRefresh=event.target.closest('[data-wdf-history-refresh]');if(historyRefresh){const key='nl_dark_history_refresh_times',now=Date.now();let times=[];try{times=JSON.parse(localStorage.getItem(key)||'[]').filter((time)=>now-Number(time)<60000);}catch(_){}if(times.length>=2)return toast('请稍后再试');times.push(now);try{localStorage.setItem(key,JSON.stringify(times));}catch(_){}historyRefresh.disabled=true;try{await loadWebDarkOrders(1,true);}catch(error){toast(error.message||'刷新失败');}finally{historyRefresh.disabled=false;}return;}
  const side=event.target.closest('[data-wdf-ranking-side]');if(side){state.webDarkRankingDirection=side.dataset.wdfRankingSide;const items=wdfRankingItems(state.webDarkRanking,state.webDarkRankingDirection);state.webDarkRankingExpanded=items.length?items[0].key:'';document.querySelector('#wdfRankingHost').innerHTML=wdfRankingList(state.webDarkRanking,state.webDarkRankingDirection);document.querySelectorAll('[data-wdf-ranking-side]').forEach(button=>button.classList.toggle('active',button.dataset.wdfRankingSide===state.webDarkRankingDirection));return;}
  const toggle=event.target.closest('[data-wdf-ranking-toggle]');if(toggle){const key=toggle.dataset.wdfRankingToggle;state.webDarkRankingExpanded=state.webDarkRankingExpanded===key?'':key;document.querySelector('#wdfRankingHost').innerHTML=wdfRankingList(state.webDarkRanking,state.webDarkRankingDirection);return;}
  const fund=event.target.closest('[data-wdf-fund-view]');if(fund){state.webDarkFundView=fund.dataset.wdfFundView;document.querySelector('#wdfResultContent').innerHTML=wdfResultContent();return;}
  const detail=event.target.closest('[data-wdf-detail-view]');if(detail){state.webDarkDetailView=detail.dataset.wdfDetailView;document.querySelector('#wdfResultContent').innerHTML=wdfResultContent();return;}
  const poster=event.target.closest('[data-wdf-poster]');if(poster)return wdfGeneratePoster(poster.dataset.wdfPoster==='noqr');
  const close=event.target.closest('[data-wdf-poster-close]');if(close){const modal=document.querySelector('#wdfPosterModal');if(modal){URL.revokeObjectURL(modal._posterUrl);modal.remove();}return;}
  const download=event.target.closest('[data-wdf-poster-download]');if(download){const modal=document.querySelector('#wdfPosterModal'),link=document.createElement('a');link.href=modal._posterUrl;link.download=`暗盘分享图-${state.webDarkResult.tradeDate||''}.png`;link.click();return;}
  const share=event.target.closest('[data-wdf-poster-share]');if(share){const modal=document.querySelector('#wdfPosterModal'),file=new File([modal._posterBlob],`暗盘分享图-${state.webDarkResult.tradeDate||''}.png`,{type:'image/png'});if(navigator.canShare&&navigator.canShare({files:[file]})){try{await navigator.share({files:[file],title:'暗盘分享图'});}catch(_){}return;}const link=document.createElement('a');link.href=modal._posterUrl;link.download=file.name;link.click();toast('图片已保存，请从微信发送');}
});
