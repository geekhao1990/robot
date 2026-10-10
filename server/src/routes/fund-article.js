const auth=require('../auth');
const db=require('../db');
const crypto=require('crypto');
const article=require('../fund-article');
const {requestCloseDarkFund,getQueueStatus}=require('../dark-fund-close-queue');
const {isReusableCloseResult}=require('../dark-fund-close');
module.exports=(router,HttpError)=>{
  const jobs=new Map();
  const check=ctx=>{if(!auth.isAdmin(ctx.headers.authorization))throw new HttpError(401,'未登录或登录失效');};
  const get=id=>{const job=jobs.get(id);if(!job)throw new HttpError(404,'任务已过期或服务已重启，请重新查询');return job;};
  router.post('/api/admin/fund-article/jobs',ctx=>{
    check(ctx);
    if(process.env.DARK_FUND_CLOSE_SAMPLE==='1')throw new HttpError(503,'当前启用了普通查询示例模式，请关闭后生成真实文章');
    const code=String(ctx.body.stockCode||'').trim();
    if(!/^\d{6}$/.test(code))throw new HttpError(400,'请输入6位股票代码');
    for(const [id,j] of jobs)if(Date.now()-j.createdAt>3600000&&!['querying','generating'].includes(j.status))jobs.delete(id);
    const running=[...jobs.values()].find(j=>['querying','generating'].includes(j.status));
    if(running)throw new HttpError(409,'已有自媒体任务正在执行，请等待完成');
    if(jobs.size>=30)jobs.delete(jobs.keys().next().value);
    const job={id:crypto.randomUUID(),stockCode:code,status:'querying',stage:'已加入普通查询队列',createdAt:Date.now()};jobs.set(job.id,job);
    Promise.resolve().then(async()=>{
      const cached=db.get().darkFundCloseCache?.[code];
      let result=cached?.result||cached;
      job.cacheHit=isReusableCloseResult(result,code);
      if(!job.cacheHit)result=await requestCloseDarkFund(code,{priority:'user'});
      job.funds=article.prepareFunds(result);
      const data=db.get();data.darkFundCloseCache ||= {};
      data.darkFundCloseCache[code]={stockCode:code,tradeDate:result.tradeDate,versionKey:result.versionKey,cachedAt:Date.now(),result};await db.save();
      job.stage='资金已取得，正在补充同日行情和近期公告';
      job.extra=await article.supplement(code,result.tradeDate);
      if(job.funds.days.length<7)job.extra.warnings.push(`仅取得${job.funds.days.length}个交易日，不补造历史数据`);
      job.status='ready';job.stage='数据已就绪';
    }).catch(e=>{job.status='failed';job.error=e.message;console.warn(`[暗盘三段论] ${code} 查询失败：${e.message}`);});
    return {id:job.id};
  });
  router.get('/api/admin/fund-article/jobs/:id',ctx=>{check(ctx);return {...get(ctx.params.id),queue:getQueueStatus()};});
  router.post('/api/admin/fund-article/jobs/:id/generate',ctx=>{
    check(ctx);const job=get(ctx.params.id);
    if(!['ready','done','generation_failed'].includes(job.status))throw new HttpError(409,'请等待数据查询完成');
    if([...jobs.values()].some(j=>j.status==='generating'))throw new HttpError(409,'已有文章正在生成');
    if(!process.env.DEEPSEEK_API_KEY)throw new HttpError(503,'请在服务器配置DEEPSEEK_API_KEY');
    const manual=article.manualFields(ctx.body.manual);
    const {notice,...quote}=manual;
    const input={...job.funds,quote:{...job.extra.quote,...quote},notices:ctx.body.useNotices===false?[]:job.extra.notices,manualNotice:notice};
    job.status='generating';job.stage='DS正在生成三段论';job.error='';job.output=null;
    article.generate(input).then(output=>{job.output=output;job.status='done';job.stage='生成完成';}).catch(e=>{job.status='generation_failed';job.error=e.message;});
    return {id:job.id};
  });
};
