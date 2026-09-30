const crypto = require('crypto');
const db = require('../db');
const auth = require('../auth');
const { refreshDarkFundQuota, consumeDarkFundQuota, refundDarkFundQuota } = require('../membership');
const { latestTradingDate, compactDate } = require('../trading-date');
const {
  attachDarkFundImages,
  activateDarkFundOrder,
  normalizeCollectorResult,
  publicDarkFundOrder,
  refreshDarkFundOrderResult,
} = require('../dark-fund-orders');
const { callbackAuthorized, dispatchStockAnalysis } = require('../collector-client');
const { persistCollectorImages } = require('../collector-images');
const { pushNotification } = require('../notifications');

function darkFundOrderNo() {
  return `DF${Date.now()}${crypto.randomBytes(5).toString('hex')}`.slice(0, 32);
}

function orderQuotaResponse(order, quota, duplicate = false) {
  return {
    ...publicDarkFundOrder(order),
    orderId: order.id,
    request_id: order.clientRequestId || '',
    duplicate,
    remaining: quota.total,
    expiringRemaining: quota.service,
    permanentRemaining: quota.manual,
    quotaExpiresAt: quota.serviceExpireAt,
  };
}

module.exports = function register(router, HttpError) {
  const currentUser = (ctx) => {
    const uid = auth.userIdFor(ctx.headers.authorization);
    if (!uid) throw new HttpError(401, '未登录');
    const user = db.get().users.find((item) => item.id === uid);
    if (!user) throw new HttpError(401, '用户不存在');
    return user;
  };

  router.get('/api/dark-funds/trade-date', (ctx) => {
    const user = currentUser(ctx);
    if (user.darkFundEnabled !== true) throw new HttpError(403, '暗盘资金入口尚未开通');
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
    };
  });

  router.post('/api/dark-funds/orders', async (ctx) => {
    const user = currentUser(ctx);
    const stockCode = String((ctx.body || {}).stockCode || '').trim();
    const suppliedRequestId = String((ctx.body || {}).request_id || '').trim();
    const requestId = suppliedRequestId || `legacy_${darkFundOrderNo()}`;
    if (!/^\d{6}$/.test(stockCode)) throw new HttpError(400, '请输入6位股票代码');
    if (/^(4|8|92)/.test(stockCode)) throw new HttpError(503, '系统繁忙');
    if (!/^[A-Za-z0-9_-]{12,80}$/.test(requestId)) throw new HttpError(400, '查询请求标识无效');
    if (user.darkFundEnabled !== true) throw new HttpError(403, '暗盘资金入口尚未开通');
    const d = db.get();
    d.darkFundOrders = Array.isArray(d.darkFundOrders) ? d.darkFundOrders : [];
    const existing = d.darkFundOrders.find((item) => item.userId === user.id && item.clientRequestId === requestId);
    if (existing) {
      if (existing.stockCode !== stockCode) throw new HttpError(409, '查询请求标识已用于其他股票');
      return orderQuotaResponse(existing, refreshDarkFundQuota(user), true);
    }
    const consumed = consumeDarkFundQuota(user);
    if (!consumed) throw new HttpError(403, '暗盘资金查询次数已用完');
    const tradeDate = latestTradingDate();
    const order = {
      id: darkFundOrderNo(),
      clientRequestId: requestId,
      userId: user.id,
      product: 'dark-funds',
      stockCode,
      tradeDate,
      amount: 0,
      quotaSource: consumed.source,
      status: 'CREATED',
      createdAt: Date.now(),
    };
    d.darkFundOrders.push(order);
    db.save();
    await db.flush();
    try {
      const accepted = await dispatchStockAnalysis(order);
      if (order.status === 'READY' || order.status === 'SUCCESS') {
        return orderQuotaResponse(order, consumed);
      }
      order.status = 'QUEUED';
      order.dispatchedAt = Date.now();
      order.collectorStatus = accepted.status;
      db.save();
      return orderQuotaResponse(order, consumed);
    } catch (error) {
      // 极快的缓存结果可能已在接单响应返回前回调成功，不能再覆盖为失败或退次数。
      if (order.status === 'READY' || order.status === 'SUCCESS') {
        return orderQuotaResponse(order, consumed);
      }
      order.status = 'DISPATCH_FAILED';
      order.dispatchError = error.message;
      order.failedAt = Date.now();
      if (!order.quotaRefundedAt) {
        refundDarkFundQuota(user, consumed.source);
        order.quotaRefundedAt = Date.now();
      }
      db.save();
      throw error;
    }
  });

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
      if (user && !order.quotaRefundedAt) {
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
      if (user && !order.quotaRefundedAt) {
        refundDarkFundQuota(user, order.quotaSource);
        order.quotaRefundedAt = Date.now();
      }
      db.save();
      throw new HttpError(400, error.message);
    }
    activateDarkFundOrder(d, order, result);
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
