// server/src/seed.js
// 初始数据。首次启动写入 data/db.json，之后由管理后台维护。

const img = (seed, w = 800, h = 1000) => `https://picsum.photos/seed/${seed}/${w}/${h}`;
const avatar = (n) => `https://i.pravatar.cc/150?img=${n}`;
const { normalizeType, typeLabel } = require('./content-types');

const YEAR = 365 * 24 * 3600 * 1000;
const u = (o) => ({ vip: false, vipPlan: '', vipExpire: 0, vipPermanent: false, official: true, createdAt: 0, tags: [], ...o });
const users = [
  u({ id: 'u1', name: '旅行的猫', avatar: avatar(11), desc: '世界那么大，我想去看看 🌍', fans: 12800, follows: 231, likes: 98000 }),
  u({ id: 'u2', name: '美食研究所', avatar: avatar(12), desc: '一个爱做饭的程序员', fans: 45600, follows: 88, likes: 320000, vip: true, vipPlan: 'year', vipExpire: Date.now() + YEAR }),
  u({ id: 'u3', name: '穿搭日记', avatar: avatar(5), desc: '记录每天的小确幸', fans: 8900, follows: 412, likes: 56000 }),
  u({ id: 'u4', name: '日常小课堂', avatar: avatar(15), desc: '记录实用的生活灵感', fans: 23400, follows: 56, likes: 145000, vip: true, vipPlan: 'month', vipExpire: Date.now() + 30 * 24 * 3600 * 1000 }),
  u({ id: 'u5', name: '家居灵感', avatar: avatar(20), desc: '把日子过成诗', fans: 67200, follows: 120, likes: 480000 }),
  u({ id: 'u6', name: '数码控小李', avatar: avatar(33), desc: '只聊真实体验', fans: 34500, follows: 67, likes: 210000 }),
];

function note(o) {
  const ratio = o.ratio || 1.25;
  const author = users.find((u) => u.id === o.authorId);
  const type = normalizeType(o.type);
  return {
    id: o.id,
    authorId: o.authorId,
    author: { id: author.id, name: author.name, avatar: author.avatar },
    category: typeLabel(type),
    type,
    baiduUrl: o.baiduUrl || (o.courseUrl && !/quark\.cn/i.test(o.courseUrl) ? o.courseUrl : ''),
    quarkUrl: o.quarkUrl || (o.courseUrl && /quark\.cn/i.test(o.courseUrl) ? o.courseUrl : ''),
    courseUrl: o.courseUrl || o.baiduUrl || o.quarkUrl || '',
    title: o.title,
    content: o.content,
    images: (o.images || []).map((s) => img(s, 800, Math.round(800 * ratio))),
    cover: img(o.images[0], 400, Math.round(400 * ratio)),
    coverRatio: ratio,
    tags: o.tags || [],
    likes: o.likes || 0,
    collects: o.collects || 0,
    visible: o.visible !== false,
    video: false,
    time: Date.now() - (o.hours || 1) * 3600 * 1000,
  };
}

const notes = [
  note({ id: 'n1', authorId: 'u4', type: 'ad', title: '周末慢早餐｜给自己半小时的仪式感', ratio: 1.3, images: ['slow-breakfast', 'weekend-coffee'], content: '周末不用赶时间，给自己做一份慢早餐。热一杯牛奶、煎个鸡蛋，再把窗帘拉开，普通的一天也会变得很柔软。', tags: ['慢早餐', '生活记录', '周末'], likes: 58, collects: 26, hours: 1 }),
  note({ id: 'n2', authorId: 'u2', type: 'ad', title: '十分钟收纳桌面，工作心情都变好了', ratio: 0.8, images: ['tidy-desk'], content: '不需要买很多收纳工具：把每天都要用的东西留在手边，其他物品收进抽屉。下班前花十分钟整理，第二天打开电脑会轻松很多。', tags: ['桌面收纳', '居家办公', '生活小技巧'], likes: 43, collects: 31, hours: 3 }),
  note({ id: 'n3', authorId: 'u4', category: '金手指', type: 'gold', visible: false, title: '金手指｜领取与使用说明', ratio: 1.15, images: ['gold1', 'gold2'], content: '点击主图或下方「点击领取」，开通会员后查看每日金手指数据。', tags: ['金手指', '领取说明'], likes: 42, collects: 28, hours: 4 }),
  note({ id: 'n4', authorId: 'u6', title: '通勤包里一直带着的五样小物', ratio: 1.0, images: ['commute-bag', 'daily-essentials'], content: '一把折叠伞、一支润唇膏、耳机、小水杯和纸巾。都是不贵的小东西，但每天出门时都能带来一点踏实感。', tags: ['通勤日常', '好物分享', '生活方式'], likes: 67, collects: 38, hours: 8 }),
  note({ id: 'n5', authorId: 'u2', title: '下班后的热汤面，简单但很治愈', ratio: 1.25, images: ['noodle-soup', 'home-dinner'], content: '冰箱里常备鸡蛋和青菜，十分钟煮一碗热汤面。认真吃完晚饭，再慢慢收拾厨房，就是我的下班仪式。', tags: ['一人食', '下班日常', '简单料理'], likes: 52, collects: 29, hours: 12 }),
  note({ id: 'n6', authorId: 'u1', title: '耳机用了三个月，通勤体验分享', ratio: 0.9, images: ['commute-headphones'], content: '通勤路上最离不开的就是耳机。降噪够用、佩戴轻松，地铁里听播客也很清楚。适合想提升通勤幸福感的人。', tags: ['通勤好物', '数码日常', '耳机'], likes: 34, collects: 22, hours: 20 }),
  note({ id: 'n7', authorId: 'u4', type: 'course', courseUrl: 'https://pan.baidu.com/s/1HjKlMn 提取码: js66', title: '手机拍照构图入门课｜日常也能拍得更好看', ratio: 1.4, images: ['phone-photography'], content: '从光线、角度到画面留白，整理了几种日常最常用的手机拍照方法。通勤、吃饭和旅行时都能马上用上。', tags: ['手机摄影', '拍照技巧', '课程'], likes: 76, collects: 47, hours: 26 }),
  note({ id: 'n8', authorId: 'u5', title: '周末在家做一份巴斯克蛋糕', ratio: 1.1, images: ['basque-cake', 'afternoon-coffee'], content: '不追求完美的裂纹，刚出炉时的焦香就已经很满足。配一杯咖啡，周末下午会变得特别慢。', tags: ['烘焙日常', '甜品', '周末生活'], likes: 61, collects: 42, hours: 30 }),
];

const categories = ['资料', '课程', '金手指', '广告'];
const hotSearch = ['慢早餐', '桌面收纳', '通勤好物', '一人食', '手机摄影', '周末生活', '烘焙', '居家办公'];
const admins = [{ username: 'admin', password: 'admin123' }];

// 每个用户的交互状态（点赞/收藏/关注），源数据在后端。
const userState = {};
// 每个用户的消息数据（通知/会话），首次访问时按模板懒初始化。
const messageData = {};
const settings = { rewardedAdEnabled: false, vipEnabled: false, featuredNoteId: 'n3' };

module.exports = function seed() {
  return {
    users, notes, categories, hotSearch, admins, userState, messageData, settings,
    paymentOrders: [], withdrawals: [], pointAnomalies: [],
    sessions: { app: {}, admin: {} }, adminOperationLogs: [],
  };
};
