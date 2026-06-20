const api = require('../../utils/api');
const store = require('../../utils/store');
const config = require('../../utils/config');

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

    this.convId = options.id;
    api.getConversation(options.id).then((c) => {
      if (!c) return;
      // 远程：后端已是时间正序；mock：倒序存储需反转
      const ordered = config.useRemote ? (c.messages || []) : (c.messages || []).slice().reverse();
      const messages = ordered.map((m) => ({ ...m, _k: this.nextKey() }));
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
    // 先本地回显我的消息
    this.setData({ messages: this.data.messages.concat({ fromMe: true, text, time: 0, _k: this.nextKey() }), draft: '' });
    this.scrollToBottom();

    if (config.useRemote) {
      // 回传后端，后端返回对方自动回复
      api.sendMessage(this.convId, text).then((res) => {
        const reply = (res && res.added || []).find((m) => !m.fromMe);
        if (reply) {
          this.setData({ messages: this.data.messages.concat({ ...reply, _k: this.nextKey() }) });
          this.scrollToBottom();
        }
      }).catch(() => {});
      return;
    }

    // 本地模拟对方自动回复
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
