const store = require('../../utils/store');
const { refreshTabBar } = require('../../utils/util');

// 简易规则式回复（本地模拟，无需后端）
const RULES = [
  { k: ['你好', 'hello', 'hi', '在吗'], a: '你好呀！我是小红书 AI 助手，可以帮你写笔记文案、想标题、推荐选题，或者随便聊聊～' },
  { k: ['文案', '标题', '写'], a: '没问题！告诉我主题和风格（比如「成都周末citywalk，轻松活泼」），我来帮你生成一段笔记文案和几个吸睛标题。' },
  { k: ['推荐', '选题', '拍什么', '灵感'], a: '最近热门方向：① 平价好物开箱 ② 周末citywalk路线 ③ 减脂餐食谱 ④ 小户型收纳。你更想做哪类？我可以展开给你出 3 个具体选题。' },
  { k: ['旅行', '旅游', '攻略'], a: '想去哪座城市呀？告诉我天数和预算，我可以帮你排一份「不踩雷」的行程和出片机位清单。' },
  { k: ['美食', '做饭', '食谱'], a: '想吃点什么？给我食材或口味偏好，我来给你一份简单步骤的菜谱，顺便配一段发笔记的文案。' },
  { k: ['谢谢', '感谢', '辛苦'], a: '不客气～有需要随时找我！🌟' },
];

function genReply(text) {
  const t = (text || '').toLowerCase();
  for (const r of RULES) {
    if (r.k.some((k) => t.includes(k.toLowerCase()))) return r.a;
  }
  return `我理解你说的「${text}」。这是一个演示版 AI 助手，可以帮你：\n· 写/优化笔记文案\n· 取标题、起话题\n· 给选题和拍摄灵感\n你可以把需求说得更具体一点，我来帮你～`;
}

Page({
  data: {
    messages: [],
    draft: '',
    loading: false,
    scrollTo: 'bottom',
    meInitial: '我',
    suggests: ['帮我写一条旅行笔记文案', '推荐几个热门选题', '取一个吸睛标题'],
  },

  _id: 0,
  nextId() {
    return ++this._id;
  },

  onLoad() {
    const user = store.getUser();
    if (user && user.name) this.setData({ meInitial: user.name.slice(0, 1) });
  },

  onShow() {
    refreshTabBar(this, 1);
  },

  pushMessage(role, content, typing) {
    const messages = this.data.messages.concat({
      id: this.nextId(),
      role,
      content,
      typing: !!typing,
    });
    this.setData({ messages });
    this.scrollToBottom();
  },

  onInput(e) {
    this.setData({ draft: e.detail.value });
  },

  onSuggest(e) {
    this.setData({ draft: e.currentTarget.dataset.q });
    this.onSend();
  },

  onSend() {
    const text = this.data.draft.trim();
    if (!text || this.data.loading) return;
    this.setData({ draft: '', loading: true });
    this.pushMessage('user', text);

    // 插入「正在思考」占位
    const typingId = this.nextId();
    const messages = this.data.messages.concat({
      id: typingId,
      role: 'assistant',
      content: '',
      typing: true,
    });
    this.setData({ messages });
    this.scrollToBottom();

    // 模拟回复延时
    setTimeout(() => {
      const reply = genReply(text);
      const list = this.data.messages.map((m) =>
        m.id === typingId ? { ...m, content: reply, typing: false } : m
      );
      this.setData({ messages: list, loading: false });
      this.scrollToBottom();
    }, 700);
  },

  scrollToBottom() {
    this.setData({ scrollTo: '' });
    wx.nextTick(() => this.setData({ scrollTo: 'bottom' }));
  },
});
