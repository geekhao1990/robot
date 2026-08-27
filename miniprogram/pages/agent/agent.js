const api = require('../../utils/api');
const store = require('../../utils/store');
const config = require('../../utils/config');
const { refreshTabBar } = require('../../utils/util');

const PROMO_TEXT = 'AI 回答不满意？需要金手指、阴阳谱、暗盘，9.9 元即可体验，请联系企业微信 👇';
const GOLD_REPLY_TEXT = '请添加企业微信领取金手指，点击或长按下方二维码 👇';
const AUTO_MESSAGE_KEY = 'agent_auto_message';

Page({
  data: {
    messages: [],
    draft: '',
    loading: false,
    scrollTo: 'bottom',
    meInitial: '我',
    suggests: ['MACD 指标', '复盘技巧', '缠论', '视频教程'],
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
    const autoMessage = wx.getStorageSync(AUTO_MESSAGE_KEY);
    if (autoMessage) {
      wx.removeStorageSync(AUTO_MESSAGE_KEY);
      if (autoMessage === '金手指') this.replyGoldFinger();
    }
  },

  replyGoldFinger() {
    const messages = this.data.messages.concat(
      { id: this.nextId(), role: 'user', content: '金手指' },
      { id: this.nextId(), role: 'assistant', promo: true, content: GOLD_REPLY_TEXT, qr: config.vipQr }
    );
    this.setData({ messages, draft: '' });
    this.scrollToBottom();
  },

  pushMessage(msg) {
    this.setData({ messages: this.data.messages.concat({ id: this.nextId(), ...msg }) });
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
    this.pushMessage({ role: 'user', content: text });

    // 「正在搜索」占位
    const typingId = this.nextId();
    this.setData({
      messages: this.data.messages.concat({ id: typingId, role: 'assistant', content: '', typing: true }),
    });
    this.scrollToBottom();

    // 按话题/分类/内容搜索笔记
    api.search(text).then((list) => {
      const notes = (list || []).slice(0, 6);
      const content = notes.length
        ? `为你找到 ${notes.length} 篇与「${text}」相关的笔记：`
        : `没有找到与「${text}」相关的笔记，换个关键词（话题/分类/内容）试试～`;
      const messages = this.data.messages.map((m) =>
        m.id === typingId ? { ...m, content, typing: false, notes } : m
      );
      // 追加企业微信推广 + 二维码
      messages.push({ id: this.nextId(), role: 'assistant', promo: true, content: PROMO_TEXT, qr: config.vipQr });
      this.setData({ messages, loading: false });
      this.scrollToBottom();
    });
  },

  goNote(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` });
  },

  previewQr(e) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.previewImage({ urls: [url], current: url });
  },

  scrollToBottom() {
    this.setData({ scrollTo: '' });
    wx.nextTick(() => this.setData({ scrollTo: 'bottom' }));
  },
});
