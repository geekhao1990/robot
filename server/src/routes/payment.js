const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const { refreshDarkFundQuota, consumeDarkFundQuota, refundDarkFundQuota, closeDarkFundActiveAt } = require('../membership');
const { latestTradingDate, compactDate } = require('../trading-date');
const {
  attachDarkFundImages,
  activateCloseDarkFundOrder,
  activateDarkFundOrder,
  normalizeCollectorResult,
  publicDarkFundOrder,
  refreshDarkFundOrderResult,
} = require('../dark-fund-orders');
const { isReusableCloseResult, nextTradingOpenAt } = require('../dark-fund-close');
const { callbackAuthorized, dispatchStockAnalysis } = require('../collector-client');
const { persistCollectorImages } = require('../collector-images');
const { pushNotification } = require('../notifications');
const { lookupStock } = require('../stock-lookup');
const { latestRanking, publicRanking } = require('../dark-fund-ranking');
const { requestCloseDarkFund, getQueueStatus = () => ({ userAhead: 0 }) } = require('../dark-fund-close-queue');
const { reviewModeApplies, goldAccess } = require('../util');

const activeGoldDailyQueries = new Set();

function beijingDateKey(now = Date.now()) {
  return new Date(Number(now) + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function goldDailyState(user, now = Date.now()) {
  const dateKey = beijingDateKey(now);
  const active = goldAccess(user);
  return {
    goldActive: active,
    goldExpireAt: active ? Number(user.goldExpire) || 0 : 0,
    goldDarkFundAvailable: active && String(user.goldDarkFundLastUsedDate || '') !== dateKey,
    goldDarkFundLastUsedDate: String(user.goldDarkFundLastUsedDate || ''),
  };
}

function darkFundQueueSnapshot(data) {
  const intradayAhead = (data.darkFundOrders || []).filter((order) => (
    (order.queryMode || 'intraday') === 'intraday'
    && ['CREATED', 'QUEUED'].includes(String(order.status || '').toUpperCase())
  )).length;
  const closeStatus = getQueueStatus() || {};
  const closeAhead = Math.max(0, Number(closeStatus.userAhead) || 0);
  return {
    intraday: { ahead: intradayAhead, estimatedWaitSeconds: intradayAhead * 15 },
    close: { ahead: closeAhead, estimatedWaitSeconds: closeAhead * 1.5 },
  };
}

function fetchCloseDarkFundOnce(stockCode) {
  return requestCloseDarkFund(stockCode, { priority: 'user' });
}

function cachedCloseResult(data, stockCode) {
  const entry = data.darkFundCloseCache && data.darkFundCloseCache[stockCode];
  const result = entry && (entry.result || entry);
  if (!result || !isReusableCloseResult(result, stockCode)) return null;
  return JSON.parse(JSON.stringify(result));
}

function storeCloseResult(data, stockCode, result) {
  data.darkFundCloseCache = data.darkFundCloseCache && typeof data.darkFundCloseCache === 'object'
    ? data.darkFundCloseCache
    : {};
  data.darkFundCloseCache[stockCode] = {
    stockCode,
    versionKey: String(result.versionKey || ''),
    tradeDate: String(result.tradeDate || ''),
    cachedAt: Date.now(),
    result: JSON.parse(JSON.stringify(result)),
  };
}

function beijingMinutes(timestamp) {
  const date = new Date(Number(timestamp) + 8 * 3600 * 1000);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function cachedIntradayResult(data, stockCode, now = Date.now()) {
  const entry = data.darkFundIntradayCache && data.darkFundIntradayCache[stockCode];
  const result = entry && entry.result;
  if (!entry || !result || String(entry.stockCode || '') !== stockCode) return null;
  if (String(result.tradingDate || '') !== String(entry.tradeDate || '')) return null;
  const expiresAt = Number(entry.expiresAt) || nextTradingOpenAt(entry.tradeDate);
  if (!expiresAt || now >= expiresAt) return null;
  return JSON.parse(JSON.stringify(result));
}

function storeIntradayResult(data, order, result) {
  if (!order || order.queryMode !== 'intraday' || beijingMinutes(order.createdAt) < 15 * 60) return false;
  const expiresAt = nextTradingOpenAt(result.tradingDate);
  if (!expiresAt || expiresAt <= Date.now()) return false;
  data.darkFundIntradayCache = data.darkFundIntradayCache && typeof data.darkFundIntradayCache === 'object'
    ? data.darkFundIntradayCache
    : {};
  data.darkFundIntradayCache[order.stockCode] = {
    stockCode: order.stockCode,
    tradeDate: result.tradingDate,
    cachedAt: Date.now(),
    expiresAt,
    result: JSON.parse(JSON.stringify(result)),
  };
  return true;
}

function darkFundOrderNo() {
  return `DF${Date.now()}${crypto.randomBytes(5).toString('hex')}`.slice(0, 32);
}

function orderQuotaResponse(order, quota, duplicate = false, user = null) {
  return {
    ...publicDarkFundOrder(order),
    orderId: order.id,
    request_id: order.clientRequestId || '',
    duplicate,
    remaining: quota.total,
    expiringRemaining: quota.service,
    permanentRemaining: quota.manual,
    quotaExpiresAt: quota.serviceExpireAt,
    closeMonthlyActive: closeDarkFundActiveAt(user),
    closeMonthlyExpireAt: closeDarkFundActiveAt(user) ? Number(user.darkFundCloseExpire) : 0,
    decisionPioneerEnabled: user && user.decisionPioneerEnabled === true,
    ...goldDailyState(user),
  };
}

module.exports = function register(router, HttpError) {
  const currentUser = (ctx) => {
    if (reviewModeApplies(ctx, db.get())) throw new HttpError(403, '功能暂未开放');
    const uid = auth.userIdFor(ctx.headers.authorization);
    if (!uid) throw new HttpError(401, '未登录');
    const user = db.get().users.find((item) => item.id === uid);
    if (!user) throw new HttpError(401, '用户不存在');
    return user;
  };

  router.get('/api/dark-funds/trade-date', (ctx) => {
    const user = currentUser(ctx);
    const quota = refreshDarkFundQuota(user);
    if (quota.changed) db.save();
    const tradeDate = latestTradingDate();
    return {
      tradeDate,
      compactTradeDate: compactDate(tradeDate),
      remaining: quota.total,
      expiringRemaining: quota.service,
      permanentRemaining: quota.manual,
      quotaExpiresAt: quota.serviceExpireAt,
      closeMonthlyActive: closeDarkFundActiveAt(user),
      closeMonthlyExpireAt: closeDarkFundActiveAt(user) ? Number(user.darkFundCloseExpire) : 0,
      decisionPioneerEnabled: user.decisionPioneerEnabled === true,
      darkFundEnabled: user.darkFundEnabled === true,
      queue: darkFundQueueSnapshot(db.get()),
      ...goldDailyState(user),
    };
  });

  router.get('/api/dark-funds/ranking', (ctx) => {
    const user = currentUser(ctx);
    if (user.darkFundEnabled !== true) throw new HttpError(403, '暗盘资金入口尚未开通');
    return publicRanking(latestRanking(db.get())) || { empty: true, inflow: [], outflow: [] };
  });

  const createDarkFundOrder = async (ctx, forcedQueryMode = '', benefitType = '') => {
    const user = currentUser(ctx);
    const useGoldDaily = benefitType === 'gold_daily';
    const stockCode = String((ctx.body || {}).stockCode || '').trim();
    const queryMode = forcedQueryMode || String((ctx.body || {}).query_mode || 'intraday').trim().toLowerCase();
    // 查询通道只由用户点击的查询类型决定。普通查询绝不允许落到 Windows 采集器。
    const querySource = queryMode === 'intraday' ? 'collector' : 'web';
    const suppliedRequestId = String((ctx.body || {}).request_id || '').trim();
    const requestId = suppliedRequestId || `legacy_${darkFundOrderNo()}`;
    if (!/^\d{6}$/.test(stockCode)) throw new HttpError(400, '请输入6位股票代码');
    if (/^(4|8|92)/.test(stockCode)) throw new HttpError(503, '系统繁忙');
    if (!['intraday', 'close'].includes(queryMode)) throw new HttpError(400, '查询类型无效');
    if (!['web', 'collector'].includes(querySource)) throw new HttpError(400, '查询来源无效');
    if (!/^[A-Za-z0-9_-]{12,80}$/.test(requestId)) throw new HttpError(400, '查询请求标识无效');
    if (useGoldDaily && !goldAccess(user)) {
      throw new HttpError(403, '金手指会员未开通或已过期');
    }
    if (queryMode === 'close' && !useGoldDaily && user.darkFundEnabled !== true) {
      throw new HttpError(403, '普通查询尚未开通');
    }
    if (queryMode === 'intraday' && user.decisionPioneerEnabled !== true) {
      throw new HttpError(403, '决策查询尚未开通');
    }
    const stockInfo = lookupStock(stockCode);
    const d = db.get();
    d.darkFundOrders = Array.isArray(d.darkFundOrders) ? d.darkFundOrders : [];
    const existing = d.darkFundOrders.find((item) => item.userId === user.id && item.clientRequestId === requestId);
    if (existing) {
      if (existing.stockCode !== stockCode) throw new HttpError(409, '查询请求标识已用于其他股票');
      if ((existing.queryMode || 'intraday') !== queryMode || (existing.querySource || 'collector') !== querySource) {
        throw new HttpError(409, '查询请求标识已用于其他查询方式');
      }
      return orderQuotaResponse(existing, refreshDarkFundQuota(user), true, user);
    }
    const goldDailyDate = beijingDateKey();
    const goldDailyKey = `${user.id}:${goldDailyDate}`;
    if (useGoldDaily) {
      if (String(user.goldDarkFundLastUsedDate || '') === goldDailyDate) {
        throw new HttpError(409, '今日金手指查暗盘次数已使用');
      }
      if (activeGoldDailyQueries.has(goldDailyKey)) {
        throw new HttpError(409, '今日金手指查暗盘正在查询中');
      }
      activeGoldDailyQueries.add(goldDailyKey);
    }
    try {
      const available = refreshDarkFundQuota(user);
      const useCloseMonthly = queryMode === 'close' && !useGoldDaily && closeDarkFundActiveAt(user);
      if (!useGoldDaily && !useCloseMonthly && available.total <= 0) throw new HttpError(403, '暗盘资金查询次数已用完');
    let closeResult = null;
    let closeCacheHit = false;
    let intradayResult = null;
    if (queryMode === 'close' && querySource === 'web') {
      closeResult = cachedCloseResult(d, stockCode);
      closeCacheHit = Boolean(closeResult);
      if (!closeResult) {
        const cachedOrder = d.darkFundOrders
          .filter((item) => ['READY', 'SUCCESS'].includes(item.status) && item.stockCode === stockCode)
          .sort((a, b) => Number(b.readyAt || b.createdAt || 0) - Number(a.readyAt || a.createdAt || 0))
          .find((item) => isReusableCloseResult(item.closeResult || (item.snapshot && item.snapshot.result), stockCode));
        if (cachedOrder) {
          closeResult = JSON.parse(JSON.stringify(cachedOrder.closeResult || cachedOrder.snapshot.result));
          closeCacheHit = true;
          storeCloseResult(d, stockCode, closeResult);
        }
      }
      if (!closeResult) {
        try {
          closeResult = await fetchCloseDarkFundOnce(stockCode);
          storeCloseResult(d, stockCode, closeResult);
        } catch (error) {
          throw new HttpError(Number(error && error.status) || 502, error && error.message || '盘后数据获取失败');
        }
      }
    }
    if (queryMode === 'close' && !closeResult) {
      throw new HttpError(502, '盘后数据未生成，已阻止连接 Windows 采集器');
    }
    if (queryMode === 'intraday') intradayResult = cachedIntradayResult(d, stockCode);
    const consumed = useGoldDaily
      ? { ...available, source: 'gold_daily' }
      : (useCloseMonthly ? { ...available, source: 'close_month' } : consumeDarkFundQuota(user));
    if (!consumed) throw new HttpError(403, '暗盘资金查询次数已用完');
    const tradeDate = closeResult ? closeResult.tradeDate : latestTradingDate();
    const order = {
      id: darkFundOrderNo(),
      clientRequestId: requestId,
      userId: user.id,
      product: 'dark-funds',
      stockCode,
      stockName: closeResult ? closeResult.stockName : (stockInfo.stockName || ''),
      queryMode,
      querySource,
      tradeDate,
      amount: 0,
      quotaSource: consumed.source,
      status: 'CREATED',
      createdAt: Date.now(),
    };
    d.darkFundOrders.push(order);
    if (closeResult) {
      if (useGoldDaily) user.goldDarkFundLastUsedDate = goldDailyDate;
      order.closeCacheHit = closeCacheHit;
      activateCloseDarkFundOrder(order, closeResult);
      pushNotification(d, order.userId, {
        type: 'dark_ready',
        title: `${order.stockCode}${useGoldDaily ? '金手指查暗盘' : '普通查询'}已完成`,
        content: '盘后数据和图表已经生成，点击查看历史订单',
        targetType: 'dark_history',
        targetId: order.id,
        dedupeKey: `dark-ready:${order.id}`,
      });
      db.save();
      await db.flush();
      return orderQuotaResponse(order, consumed, false, user);
    }
    if (intradayResult) {
      intradayResult.orderId = order.id;
      intradayResult.source = 'cache';
      order.intradayCacheHit = true;
      activateDarkFundOrder(d, order, intradayResult);
      pushNotification(d, order.userId, {
        type: 'dark_ready',
        title: `${order.stockCode}决策查询已完成`,
        content: '已使用收盘后的决策查询缓存生成结果，点击查看订单列表',
        targetType: 'dark_history',
        targetId: order.id,
        dedupeKey: `dark-ready:${order.id}`,
      });
      db.save();
      await db.flush();
      return orderQuotaResponse(order, consumed, false, user);
    }
    db.save();
    await db.flush();
    try {
      const accepted = await dispatchStockAnalysis(order);
      if (order.status === 'READY' || order.status === 'SUCCESS') {
        return orderQuotaResponse(order, consumed, false, user);
      }
      order.status = 'QUEUED';
      order.dispatchedAt = Date.now();
      order.collectorStatus = accepted.status;
      db.save();
      return orderQuotaResponse(order, consumed, false, user);
    } catch (error) {
      // 极快的缓存结果可能已在接单响应返回前回调成功，不能再覆盖为失败或退次数。
      if (order.status === 'READY' || order.status === 'SUCCESS') {
        return orderQuotaResponse(order, consumed, false, user);
      }
      order.status = 'DISPATCH_FAILED';
      order.dispatchError = error.message;
      order.failedAt = Date.now();
      if (!order.quotaRefundedAt && consumed.source !== 'close_month') {
        refundDarkFundQuota(user, consumed.source);
        order.quotaRefundedAt = Date.now();
      }
      db.save();
      throw error;
    }
    } finally {
      if (useGoldDaily) activeGoldDailyQueries.delete(goldDailyKey);
    }
  };

  // 两个独立入口从路由层固定查询类型，避免请求体缺失或旧客户端字段串线。
  router.post('/api/dark-funds/orders/intraday', (ctx) => createDarkFundOrder(ctx, 'intraday'));
  router.post('/api/dark-funds/orders/close', (ctx) => createDarkFundOrder(ctx, 'close'));
  router.post('/api/dark-funds/orders/gold', (ctx) => createDarkFundOrder(ctx, 'close', 'gold_daily'));
  router.post('/api/dark-funds/orders', (ctx) => createDarkFundOrder(ctx));

  router.get('/api/dark-funds/orders', (ctx) => {
    const user = currentUser(ctx);
    const query = ctx.query || {};
    const orders = (db.get().darkFundOrders || [])
      .filter((item) => item.userId === user.id)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map(publicDarkFundOrder);
    // 未传 page 时保留旧数组响应，兼容尚未更新的小程序版本。
    if (query.page === undefined || query.page === '') return orders;
    const pageSize = 10;
    const total = orders.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, Number.parseInt(query.page, 10) || 1), totalPages);
    const start = (page - 1) * pageSize;
    return {
      list: orders.slice(start, start + pageSize),
      page,
      pageSize,
      total,
      totalPages,
      unread: orders.filter((item) => item.unread).length,
    };
  });

  router.get('/api/dark-funds/orders/:id', (ctx) => {
    const user = currentUser(ctx);
    const d = db.get();
    const order = (d.darkFundOrders || []).find((item) => item.id === ctx.params.id && item.userId === user.id);
    if (!order) throw new HttpError(404, '订单不存在');
    if (order.status !== 'READY' && order.status !== 'SUCCESS') throw new HttpError(409, '查询结果尚未就绪');
    if (!order.viewedAt) order.viewedAt = Date.now();
    db.save();
    return publicDarkFundOrder(order);
  });

  router.post('/api/stock-analysis/callback', (ctx) => {
    if (!callbackAuthorized(ctx.headers)) throw new HttpError(401, '回调鉴权失败');
    const d = db.get();
    const body = ctx.body || {};
    const orderId = String(body.order_id || '').trim();
    const order = (d.darkFundOrders || []).find((item) => item.id === orderId);
    if (!order) throw new HttpError(404, '工单不存在');
    if (String(body.stock_code || '').trim() !== order.stockCode) throw new HttpError(400, '回调股票代码不匹配');
    if (order.status === 'READY' || order.status === 'SUCCESS') {
      if (body.analysis && String(body.analysis.title || '').trim()) {
        let imageUrls = order.collectorResult && order.collectorResult.images;
        let imagesUpdated = false;
        try {
          if (!Array.isArray(imageUrls) || imageUrls.length !== 2) {
            imageUrls = persistCollectorImages(body.images, order.id);
            imagesUpdated = true;
          }
          const result = normalizeCollectorResult({ ...body, image_urls: imageUrls }, order);
          refreshDarkFundOrderResult(d, order, result);
          storeIntradayResult(d, order, result);
        } catch (error) {
          throw new HttpError(400, error.message);
        }
        db.save();
        return { ok: true, duplicate: true, analysisUpdated: true, imagesUpdated };
      }
      if (body.images) {
        const existingImages = order.collectorResult && order.collectorResult.images;
        if (Array.isArray(existingImages) && existingImages.length === 2) {
          return { ok: true, duplicate: true, imagesUpdated: false };
        }
        let imageUrls;
        try {
          imageUrls = persistCollectorImages(body.images, order.id);
        } catch (error) {
          throw new HttpError(400, error.message);
        }
        attachDarkFundImages(d, order, imageUrls);
        db.save();
        return { ok: true, duplicate: true, imagesUpdated: true };
      }
      return { ok: true, duplicate: true };
    }
    if (String(body.status || '').toLowerCase() === 'failed' || body.ok === false) {
      order.status = 'FAILED';
      order.collectorError = String(body.error || '采集失败').slice(0, 500);
      order.failedAt = Date.now();
      const user = d.users.find((item) => item.id === order.userId);
      if (user && !order.quotaRefundedAt && order.quotaSource !== 'close_month') {
        refundDarkFundQuota(user, order.quotaSource);
        order.quotaRefundedAt = Date.now();
      }
      db.save();
      return { ok: true };
    }
    let result;
    try {
      result = normalizeCollectorResult({
        ...body,
        image_urls: ['https://pending.invalid/fund', 'https://pending.invalid/guide'],
      }, order);
      const imageUrls = persistCollectorImages(body.images, order.id);
      result.images = imageUrls;
    } catch (error) {
      order.status = 'FAILED';
      order.collectorError = String(error.message || '采集结果校验失败').slice(0, 500);
      order.failedAt = Date.now();
      const user = d.users.find((item) => item.id === order.userId);
      if (user && !order.quotaRefundedAt && order.quotaSource !== 'close_month') {
        refundDarkFundQuota(user, order.quotaSource);
        order.quotaRefundedAt = Date.now();
      }
      db.save();
      throw new HttpError(400, error.message);
    }
    activateDarkFundOrder(d, order, result);
    storeIntradayResult(d, order, result);
    pushNotification(d, order.userId, {
      type: 'dark_ready',
      title: `${order.stockCode}暗盘查询已完成`,
      content: '查询结果已经生成，点击查看历史订单',
      targetType: 'dark_history',
      targetId: order.id,
      dedupeKey: `dark-ready:${order.id}`,
    });
    db.save();
    return { ok: true };
  });

};
