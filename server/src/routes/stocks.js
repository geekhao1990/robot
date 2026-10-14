const auth = require('../auth');
const { lookupStock, searchStocks } = require('../stock-lookup');

module.exports = function register(router, HttpError) {
  router.get('/api/stocks/search', (ctx) => {
    if (!auth.userIdFor(ctx.headers.authorization)) throw new HttpError(401, '请先登录');
    return searchStocks(ctx.query.q);
  });
  router.get('/api/stocks/lookup', async (ctx) => {
    if (!auth.userIdFor(ctx.headers.authorization)) throw new HttpError(401, '请先登录');
    return lookupStock(ctx.query.code);
  });
};
