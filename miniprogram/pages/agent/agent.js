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
  return `我理解你说的「${text}」。这是一个演示版 AI 助手，可以帮你：\n· 写/优化笔记文案\n· 取标题、起话题\n· 给选题和拍摄灵感\n· 输入港股代码查暗盘截图（如「暗盘 01810」）\n你可以把需求说得更具体一点，我来帮你～`;
}

// 识别「暗盘」指令，返回股票代码或 null。
// 支持：「暗盘 01810」「01810 暗盘」「查700的暗盘」，或直接输入纯数字代码「01810」
function parseDarkpoolCode(text) {
  const t = (text || '').trim();
  if (/^\d{1,6}$/.test(t)) return t; // 纯代码
  if (t.indexOf('暗盘') === -1) return null;
  const m = t.match(/\d{1,6}/);
  return m ? m[0] : null;
}

Page({
  data: {
    messages: [],
    draft: '',
    loading: false,
    scrollTo: 'bottom',
    meInitial: '我',
    suggests: ['帮我写一条旅行笔记文案', '推荐几个热门选题', '暗盘 01810'],
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

    const darkpoolCode = parseDarkpoolCode(text);
    const pending = darkpoolCode ? this.askDarkpool(darkpoolCode, typingId) : this.askBot(text);

    pending.then((reply) => {
      // reply 为字符串(文本消息) 或 {type:'image', src, content}(图片消息)
      const patch = typeof reply === 'string' ? { content: reply } : reply;
      const list = this.data.messages.map((m) =>
        m.id === typingId ? { ...m, ...patch, typing: false } : m
      );
      this.setData({ messages: list, loading: false });
      this.scrollToBottom();
    });
  },

  // 暗盘截图智能体：云函数 darkpool -> 设备端服务(操作同花顺App截图) -> 返回云存储图片
  askDarkpool(code, typingId) {
    const app = getApp();
    if (!(app.globalData.cloudEnabled && wx.cloud)) {
      return Promise.resolve(
        '暗盘截图功能需要开通云开发并部署 darkpool 云函数与设备端服务（见 darkpool-agent/README.md）。'
      );
    }
    // 把「正在思考」占位换成更贴切的提示
    this.setData({
      messages: this.data.messages.map((m) =>
        m.id === typingId ? { ...m, content: `正在获取 ${code} 的暗盘行情截图，当日已生成会秒回，首次约需 30 秒` } : m
      ),
    });

    return wx.cloud
      .callFunction({ name: 'darkpool', data: { code } })
      .then((res) => {
        const r = (res && res.result) || {};
        if (r.ok && r.fileID) {
          return { type: 'image', src: r.fileID, content: `${r.code} 暗盘行情截图` };
        }
        return r.message || '未能获取到该股票的暗盘截图，请稍后再试';
      })
      .catch(() => '暗盘截图服务暂时不可用，请稍后再试');
  },

  onPreviewImage(e) {
    const src = e.currentTarget.dataset.src;
    if (src) wx.previewImage({ urls: [src] });
  },

  // 优先调用云函数(知识库 RAG)，未开通云开发或失败时降级为本地回复
  askBot(text) {
    const history = this.data.messages
      .filter((m) => !m.typing && m.content)
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));

    const app = getApp();
    if (app.globalData.cloudEnabled && wx.cloud) {
      return wx.cloud
        .callFunction({ name: 'kbchat', data: { question: text, history } })
        .then((res) => (res && res.result && res.result.answer) || genReply(text))
        .catch(() => genReply(text));
    }
    // 本地降级：模拟延时
    return new Promise((resolve) => setTimeout(() => resolve(genReply(text)), 700));
  },

  scrollToBottom() {
    this.setData({ scrollTo: '' });
    wx.nextTick(() => this.setData({ scrollTo: 'bottom' }));
  },
});
