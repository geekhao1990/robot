// mock/data.js
// 本地模拟数据。图片使用 picsum.photos 占位图，
// 在微信开发者工具中需勾选「不校验合法域名」。

const img = (seed, w = 400, h = 600) =>
  `https://picsum.photos/seed/${seed}/${w}/${h}`;
const avatar = (n) => `https://i.pravatar.cc/150?img=${n}`;

// ---------------- 用户 ----------------
const users = [
  { id: 'u1', name: '旅行的猫', avatar: avatar(11), desc: '世界那么大，我想去看看 🌍', fans: 12800, follows: 231, likes: 98000 },
  { id: 'u2', name: '美食研究所', avatar: avatar(12), desc: '一个爱做饭的程序员', fans: 45600, follows: 88, likes: 320000 },
  { id: 'u3', name: '穿搭日记', avatar: avatar(5), desc: '记录每天的小确幸', fans: 8900, follows: 412, likes: 56000 },
  { id: 'u4', name: '健身搭子', avatar: avatar(15), desc: '自律给我自由 💪', fans: 23400, follows: 56, likes: 145000 },
  { id: 'u5', name: '家居灵感', avatar: avatar(20), desc: '把日子过成诗', fans: 67200, follows: 120, likes: 480000 },
  { id: 'u6', name: '数码控小李', avatar: avatar(33), desc: '只聊真实体验', fans: 34500, follows: 67, likes: 210000 },
];

const userMap = {};
users.forEach((u) => (userMap[u.id] = u));

// ---------------- 笔记 ----------------
// ratio = 封面高/宽，用于瀑布流布局
const rawNotes = [
  {
    id: 'n1', authorId: 'u1', category: '旅行',
    title: '在大理的第三天，洱海边的日落美到失语', ratio: 1.33,
    images: ['dali1', 'dali2', 'dali3'],
    content: '洱海边骑行真的是来大理必做的事情！租了一辆小电驴，沿着海西路一路骑，风很温柔，太阳落山的时候整个天空都是橘粉色的。\n\n📍推荐机位：才村码头、海舌公园\n🛵 电驴 50/天，记得充满电\n☕ 路边随便找家咖啡店坐下都很出片',
    tags: ['大理', '洱海', '旅行攻略'], likes: 23400, collects: 8900, comments: 342, time: 1, video: false,
  },
  {
    id: 'n2', authorId: 'u2', category: '美食',
    title: '10分钟搞定的快手早餐｜元气满满', ratio: 0.8,
    images: ['food1', 'food2'],
    content: '工作日早上谁有空慢慢做饭，分享我的快手早餐公式：\n\n1️⃣ 全麦面包烤一下\n2️⃣ 牛油果半个+水煮蛋\n3️⃣ 一杯燕麦奶\n\n营养均衡又顶饱，关键是真的很快！',
    tags: ['快手早餐', '减脂餐', '美食'], likes: 56700, collects: 23400, comments: 891, time: 3, video: false,
  },
  {
    id: 'n3', authorId: 'u3', category: '金手指', type: 'gold',
    title: '金手指｜领取与使用说明', ratio: 1.5,
    images: ['gold-finger1', 'gold-finger2'],
    content: '金手指资料与使用说明。点击下方「点击领取」，添加企业微信后领取完整内容。',
    tags: ['金手指', '领取说明'], likes: 12300, collects: 9800, comments: 0, time: 5, video: false,
  },
  {
    id: 'n4', authorId: 'u4', category: '健身',
    title: '居家徒手训练｜30天练出马甲线', ratio: 1.0,
    images: ['fit1', 'fit2'],
    content: '不用去健身房，在家就能练！这套动作我坚持了30天，效果真的肉眼可见。\n\n每天 20 分钟：\n· 卷腹 3×20\n· 平板支撑 3×60s\n· 俄罗斯转体 3×30\n\n坚持就是胜利！',
    tags: ['健身', '马甲线', '居家运动'], likes: 89000, collects: 45000, comments: 1203, time: 8, video: true,
  },
  {
    id: 'n5', authorId: 'u5', category: '家居',
    title: '30㎡小出租屋改造｜花了2000块', ratio: 1.25,
    images: ['home1', 'home2', 'home3'],
    content: '租房也要好好生活！这次改造没动硬装，全靠软装提升氛围感。\n\n🛋 二手沙发 + 米色沙发套\n💡 落地灯氛围拉满\n🪴 绿植是廉价高级感神器',
    tags: ['出租屋改造', '家居', '租房'], likes: 67800, collects: 34000, comments: 567, time: 12, video: false,
  },
  {
    id: 'n6', authorId: 'u6', category: '数码',
    title: '用了三个月，这款耳机值不值得买？', ratio: 0.9,
    images: ['tech1', 'tech2'],
    content: '真实使用体验，不恰饭不吹捧。\n\n✅ 降噪很能打\n✅ 续航满意\n❌ 久戴会夹耳\n\n总体推荐，性价比在线。',
    tags: ['数码', '耳机', '好物推荐'], likes: 34500, collects: 12000, comments: 456, time: 20, video: false,
  },
  {
    id: 'n7', authorId: 'u1', category: '旅行',
    title: '一个人的京都漫游｜避开人潮的小众路线', ratio: 1.4,
    images: ['kyoto1', 'kyoto2', 'kyoto3'],
    content: '京都不止有清水寺！分享几个游客很少但超美的地方：\n\n⛩ 贵船神社\n🍃 哲学之道\n🏯 伏见稻荷的后山\n\n清晨去人最少，拍照绝绝子。',
    tags: ['京都', '日本旅行', '小众景点'], likes: 45600, collects: 28000, comments: 678, time: 26, video: false,
  },
  {
    id: 'n8', authorId: 'u2', category: '美食',
    title: '本命甜品｜在家复刻巴斯克芝士蛋糕', ratio: 1.1,
    images: ['cake1', 'cake2'],
    content: '巴斯克的精髓就是那层焦化的表面！配方超简单：\n\n奶油奶酪 250g\n糖 80g\n鸡蛋 2个\n淡奶油 150g\n\n230度烤25分钟，放凉冷藏一夜更好吃～',
    tags: ['烘焙', '芝士蛋糕', '甜品'], likes: 78900, collects: 56000, comments: 1456, time: 30, video: false,
  },
  {
    id: 'n9', authorId: 'u3', category: '穿搭',
    title: '155小个子显高穿搭公式', ratio: 1.6,
    images: ['ootd5', 'ootd6'],
    content: '小个子姐妹看过来！记住这几个原则立马显高10cm：\n\n📏 上短下长 / 高腰线\n👖 同色系拉长比例\n👟 尖头鞋视觉延伸',
    tags: ['小个子穿搭', '显高', 'OOTD'], likes: 23400, collects: 19800, comments: 345, time: 40, video: false,
  },
  {
    id: 'n10', authorId: 'u5', category: '家居',
    title: '厨房收纳大改造｜告别杂乱台面', ratio: 0.85,
    images: ['kitchen1', 'kitchen2'],
    content: '台面空无一物才是终极目标！分享我的收纳思路：\n\n🧺 分区收纳，同类归位\n🪜 利用垂直空间\n🏷 透明罐+标签，一目了然',
    tags: ['厨房收纳', '收纳', '家居'], likes: 34500, collects: 23400, comments: 234, time: 48, video: false,
  },
  {
    id: 'n11', authorId: 'u4', category: '健身',
    title: '跑步一年瘦了20斤｜新手避坑指南', ratio: 1.2,
    images: ['run1', 'run2'],
    content: '从跑步小白到半马完赛，这些坑别踩：\n\n👟 一双合脚的跑鞋很重要\n🐢 慢慢来，先能跑下来再提速\n🦵 跑前热身跑后拉伸',
    tags: ['跑步', '减肥', '健身'], likes: 56700, collects: 34000, comments: 789, time: 60, video: false,
  },
  {
    id: 'n12', authorId: 'u6', category: '数码',
    title: '桌搭分享｜打造高效又好看的工作区', ratio: 1.35,
    images: ['desk1', 'desk2', 'desk3'],
    content: '在家办公的快乐源泉就是一个舒服的桌面！\n\n🖥 显示器支架解放桌面\n⌨️ 机械键盘手感党\n🔌 桌面理线很关键',
    tags: ['桌搭', '数码', '居家办公'], likes: 45600, collects: 28900, comments: 567, time: 72, video: false,
  },
  {
    id: 'n13', authorId: 'u6', category: '数码', type: 'course',
    courseUrl: 'https://pan.baidu.com/s/1AbCdEfGhIjKlMn 提取码: xhs8',
    title: '【保姆级教程】从0到1搭建你的第一个网站', ratio: 1.15,
    images: ['course1', 'course2'],
    content: '零基础也能学会！本课程包含全部源码 + 视频讲解：\n\n1️⃣ 环境搭建\n2️⃣ 前端页面开发\n3️⃣ 后端接口与部署\n\n点击下方「点击领取」即可领取完整资料～',
    tags: ['建站', '编程教程', '干货'], likes: 8900, collects: 5600, comments: 0, time: 4, video: false,
  },
];

// 评论模板
const sampleComments = [
  { user: 'u3', text: '太实用了，已收藏！谢谢分享 🥰' },
  { user: 'u4', text: '请问有更详细的攻略吗？' },
  { user: 'u2', text: '博主审美在线，关注了～' },
  { user: 'u5', text: '同款体验，真的很不错👍' },
  { user: 'u1', text: '看完直接种草了，冲！' },
  { user: 'u6', text: '蹲一个后续，期待更新' },
];

// 生成笔记完整对象
function buildNote(raw) {
  const author = userMap[raw.authorId];
  const cover = img(raw.images[0], 400, Math.round(400 * raw.ratio));
  const images = raw.images.map((s) => img(s, 800, Math.round(800 * raw.ratio)));
  const type = raw.type === 'course' || raw.type === 'gold' ? raw.type : 'material';
  const category = { material: '资料', course: '课程', gold: '金手指' }[type];
  return {
    ...raw,
    type,
    category,
    cover,
    coverRatio: raw.ratio,
    images,
    author: { id: author.id, name: author.name, avatar: author.avatar },
    time: Date.now() - raw.time * 3600 * 1000,
    commentList: sampleComments.slice(0, 4).map((c, i) => ({
      id: `${raw.id}-c${i}`,
      user: userMap[c.user],
      text: c.text,
      likes: Math.floor(Math.random() * 200),
      liked: false,
      time: Date.now() - (i + 1) * 3600 * 1000,
      replies:
        i === 0
          ? [
              {
                id: `${raw.id}-c${i}-r0`,
                user: userMap[raw.authorId],
                to: userMap[c.user].name,
                text: '谢谢支持！有问题随时问我～',
                likes: Math.floor(Math.random() * 30),
                liked: false,
                time: Date.now() - i * 1800 * 1000 - 600 * 1000,
              },
            ]
          : [],
    })),
  };
}

const notes = rawNotes.map(buildNote);
const noteMap = {};
notes.forEach((n) => (noteMap[n.id] = n));

const categories = ['资料', '课程', '金手指'];
const hotSearch = ['多巴胺穿搭', 'citywalk', '露营', '美拉德', '特种兵旅行', '抄作业', '平价好物', '减脂餐'];

// ---------------- 消息：通知（赞/收藏/关注/评论） ----------------
const notifications = [
  { id: 'm1', type: 'like', userId: 'u3', noteId: 'n1', text: '赞了你的笔记', time: 0.2 },
  { id: 'm2', type: 'collect', userId: 'u4', noteId: 'n1', text: '收藏了你的笔记', time: 0.5 },
  { id: 'm3', type: 'comment', userId: 'u2', noteId: 'n5', text: '评论了你的笔记：太实用了，已收藏！', time: 1 },
  { id: 'm4', type: 'follow', userId: 'u5', text: '关注了你', time: 2 },
  { id: 'm5', type: 'like', userId: 'u6', noteId: 'n5', text: '赞了你的笔记', time: 3 },
  { id: 'm6', type: 'like', userId: 'u2', noteId: 'n1', text: '赞了你的笔记', time: 5 },
  { id: 'm7', type: 'collect', userId: 'u1', noteId: 'n5', text: '收藏了你的笔记', time: 8 },
  { id: 'm8', type: 'follow', userId: 'u6', text: '关注了你', time: 26 },
  { id: 'm9', type: 'comment', userId: 'u4', noteId: 'n1', text: '评论了你的笔记：请问机位在哪呀～', time: 30 },
];

// ---------------- 消息：私信会话 ----------------
const conversations = [
  {
    id: 'c1', userId: 'u2', unread: 2, time: 0.1,
    messages: [
      { fromMe: false, text: '在吗？看到你那篇早餐笔记啦', time: 1 },
      { fromMe: true, text: '在的～有什么问题嘛', time: 0.8 },
      { fromMe: false, text: '请问那个燕麦奶是哪个牌子的呀', time: 0.3 },
      { fromMe: false, text: '想自己也试试 😋', time: 0.1 },
    ],
  },
  {
    id: 'c2', userId: 'u3', unread: 0, time: 2,
    messages: [
      { fromMe: false, text: '你的穿搭真好看！求链接～', time: 5 },
      { fromMe: true, text: '已经私你啦，记得查收', time: 2 },
    ],
  },
  {
    id: 'c3', userId: 'u5', unread: 1, time: 24,
    messages: [
      { fromMe: false, text: '改造那期的落地灯能分享下吗', time: 26 },
      { fromMe: true, text: '可以呀，我整理下发你', time: 25 },
      { fromMe: false, text: '太感谢啦 🥰', time: 24 },
    ],
  },
];

module.exports = {
  users,
  userMap,
  notes,
  noteMap,
  categories,
  hotSearch,
  notifications,
  conversations,
};
