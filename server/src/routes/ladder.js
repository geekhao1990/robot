const auth = require('../auth');
const ladder = require('../ladder-ocr');
const dragon = require('../dragon-board');
const article = require('../article-rewrite');
module.exports = (router, HttpError) => {
  const check = ctx => { if (!auth.isAdmin(ctx.headers.authorization)) throw new HttpError(401,'未登录或登录失效'); };
  let busy = false;
  let articleBusy=false;
  router.post('/api/admin/ladder/article/rewrite',async ctx=>{
    check(ctx);
    if(articleBusy)throw new HttpError(409,'已有文章改写任务，请等待完成');
    articleBusy=true;
    try{return await article.rewrite(ctx.body);}finally{articleBusy=false;}
  });
  router.get('/api/admin/ladder/config',ctx=>{check(ctx);return ladder.status();});
  router.post('/api/admin/ladder/recognize',async ctx=>{
    check(ctx);
    if(busy) throw new HttpError(409,'已有识别任务，请稍后再试');
    busy=true;
    try { return await ladder.recognize(ctx.body.image); } finally {busy=false;}
  });
  router.post('/api/admin/ladder/confirm',ctx=>{
    check(ctx);
    if(ctx.body.confirmed!==true) throw new HttpError(400,'请先确认JSON');
    return {data:ladder.validate(ctx.body.data)};
  });
  router.post('/api/admin/ladder/dragon/recognize',async ctx=>{
    check(ctx);
    if(busy) throw new HttpError(409,'已有识别任务，请稍后再试');
    busy=true;
    try{return await dragon.recognize(ctx.body.image);}finally{busy=false;}
  });
  router.post('/api/admin/ladder/dragon/confirm',ctx=>{
    check(ctx);
    if(ctx.body.confirmed!==true)throw new HttpError(400,'请先确认JSON');
    return {data:dragon.validate(ctx.body.data)};
  });
};
