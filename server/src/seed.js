// server/src/seed.js
// 初始数据。首次启动写入 data/db.json，之后由管理后台维护。

const img = (seed, w = 800, h = 1000) => `https://picsum.photos/seed/${seed}/${w}/${h}`;
const avatar = (n) => `https://i.pravatar.cc/150?img=${n}`;

const YEAR = 365 * 24 * 3600 * 1000;
const u = (o) => ({ vip: false, vipPlan: '', vipExpire: 0, ...o });
const users = [
  u({ id: 'u1', name: '旅行的猫', avatar: avatar(11), desc: '世界那么大，我想去看看 🌍', fans: 12800, follows: 231, likes: 98000 }),
  u({ id: 'u2', name: '美食研究所', avatar: avatar(12), desc: '一个爱做饭的程序员', fans: 45600, follows: 88, likes: 320000, vip: true, vipPlan: 'year', vipExpire: Date.now() + YEAR }),
  u({ id: 'u3', name: '穿搭日记', avatar: avatar(5), desc: '记录每天的小确幸', fans: 8900, follows: 412, likes: 56000 }),
  u({ id: 'u4', name: '金融小课堂', avatar: avatar(15), desc: '只讲干货', fans: 23400, follows: 56, likes: 145000, vip: true, vipPlan: 'month', vipExpire: Date.now() + 30 * 24 * 3600 * 1000 }),
  u({ id: 'u5', name: '家居灵感', avatar: avatar(20), desc: '把日子过成诗', fans: 67200, follows: 120, likes: 480000 }),
  u({ id: 'u6', name: '数码控小李', avatar: avatar(33), desc: '只聊真实体验', fans: 34500, follows: 67, likes: 210000 }),
];

function note(o) {
  const ratio = o.ratio || 1.25;
  const author = users.find((u) => u.id === o.authorId);
  return {
    id: o.id,
    authorId: o.authorId,
    author: { id: author.id, name: author.name, avatar: author.avatar },
    category: o.category,
    type: o.type === 'course' ? 'course' : 'material',
    courseUrl: o.courseUrl || '',
    title: o.title,
    content: o.content,
    images: (o.images || []).map((s) => img(s, 800, Math.round(800 * ratio))),
    cover: img(o.images[0], 400, Math.round(400 * ratio)),
    coverRatio: ratio,
    tags: o.tags || [],
    likes: o.likes || 0,
    collects: o.collects || 0,
    comments: o.comments || 0,
    video: false,
    time: Date.now() - (o.hours || 1) * 3600 * 1000,
    commentList: [],
  };
}

const notes = [
  note({ id: 'n1', authorId: 'u4', category: '指标', title: 'MACD 顶背离实战图解', ratio: 1.3, images: ['fin1', 'fin2'], content: '顶背离的三个确认信号……', tags: ['指标', '技术分析'], likes: 23400, collects: 8900, comments: 342, hours: 1 }),
  note({ id: 'n2', authorId: 'u2', category: '视频', title: '10分钟看懂均线系统', ratio: 0.8, images: ['vid1'], content: '均线多头排列怎么看……', tags: ['视频', '入门'], likes: 56700, collects: 23400, comments: 891, hours: 3 }),
  note({ id: 'n3', authorId: 'u4', category: '其他', type: 'course', courseUrl: 'https://pan.baidu.com/s/1AbCdEfG 提取码: jz88', title: '缠论买卖点系统课', ratio: 1.15, images: ['gold1', 'gold2'], content: '完整视频 + 源码，点击领取……', tags: ['课程'], likes: 8900, collects: 5600, comments: 0, hours: 4 }),
  note({ id: 'n4', authorId: 'u6', category: '指标', title: '主力资金流向指标解读', ratio: 1.0, images: ['fin3', 'fin4'], content: '资金流向怎么用……', tags: ['指标'], likes: 89000, collects: 45000, comments: 1203, hours: 8 }),
  note({ id: 'n5', authorId: 'u2', category: '视频', title: '盘前复盘的正确姿势', ratio: 1.25, images: ['vid2', 'vid3'], content: '每天 15 分钟复盘……', tags: ['视频', '复盘'], likes: 67800, collects: 34000, comments: 567, hours: 12 }),
  note({ id: 'n6', authorId: 'u1', category: '指标', title: 'KDJ 金叉死叉避坑指南', ratio: 0.9, images: ['fin5'], content: 'KDJ 钝化怎么办……', tags: ['指标'], likes: 34500, collects: 12000, comments: 456, hours: 20 }),
  note({ id: 'n7', authorId: 'u4', category: '其他', type: 'course', courseUrl: 'https://pan.baidu.com/s/1HjKlMn 提取码: js66', title: '波段操作系统资料包', ratio: 1.4, images: ['gold3'], content: '波段心法 + 选股公式……', tags: ['课程'], likes: 45600, collects: 28000, comments: 0, hours: 26 }),
  note({ id: 'n8', authorId: 'u5', category: '视频', title: '从0到1搭建交易系统', ratio: 1.1, images: ['vid4', 'vid5'], content: '交易系统三要素……', tags: ['视频'], likes: 78900, collects: 56000, comments: 1456, hours: 30 }),
];

const categories = ['指标', '视频', '其他'];
const hotSearch = ['缠论', 'MACD', '均线', '波段', '复盘', '资金流向', '选股公式', '交易系统'];
const admins = [{ username: 'admin', password: 'admin123' }];

// 每个用户的交互状态（点赞/收藏/关注），源数据在后端。
const userState = {};
// 每个用户的消息数据（通知/会话），首次访问时按模板懒初始化。
const messageData = {};
const settings = { rewardedAdEnabled: false, featuredNoteId: 'n3' };

module.exports = function seed() {
  return { users, notes, categories, hotSearch, admins, userState, messageData, settings };
};
