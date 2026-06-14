const api = require('../../utils/api');
const store = require('../../utils/store');

const REPLIES = ['好的呀～', '收到！', '哈哈哈哈', '谢谢你！', '我看看哈', '可以的👌'];

Page({
  data: {
    peer: {},
    myAvatar: 'https://i.pravatar.cc/150?img=68',
    messages: [],
    draft: '',
    scrollTo: 'bottom',
  },

  _key: 0,
  nextKey() {
    return ++this._key;
  },

  onLoad(options) {
    store.markConvRead(options.id); // 查看后清除该会话未读
    const user = store.getUser();
    if (user && user.avatar) this.setData({ myAvatar: user.avatar });

    api.getConversation(options.id).then((c) => {
      if (!c) return;
      // mock 中按时间倒序存储，这里反转为正序展示
      const messages = c.messages.slice().reverse().map((m) => ({ ...m, _k: this.nextKey() }));
      this.setData({ peer: c.user, messages });
      wx.setNavigationBarTitle({ title: c.user.name });
      this.scrollToBottom();
    });
  },

  onInput(e) {
    this.setData({ draft: e.detail.value });
  },

  onSend() {
    const text = this.data.draft.trim();
    if (!text) return;
    const messages = this.data.messages.concat({ fromMe: true, text, time: 0, _k: this.nextKey() });
    this.setData({ messages, draft: '' });
    this.scrollToBottom();

    // 模拟对方自动回复
    setTimeout(() => {
      const reply = REPLIES[Math.floor(Math.random() * REPLIES.length)];
      this.setData({ messages: this.data.messages.concat({ fromMe: false, text: reply, time: 0, _k: this.nextKey() }) });
      this.scrollToBottom();
    }, 900);
  },

  scrollToBottom() {
    this.setData({ scrollTo: '' });
    wx.nextTick(() => this.setData({ scrollTo: 'bottom' }));
  },
});
