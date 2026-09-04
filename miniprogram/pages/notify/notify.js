const api = require('../../utils/api');
const store = require('../../utils/store');
const { fromNow } = require('../../utils/util');

const ACTION = {
  like: '赞了你的笔记',
  collect: '收藏了你的笔记',
  follow: '关注了你',
};

Page({
  data: {
    tabs: [
      { key: 'like', label: '赞和收藏' },
      { key: 'follow', label: '新增关注' },
    ],
    type: 'like',
    list: [],
  },

  onLoad(options) {
    const type = options.type || 'like';
    this.setData({ type });
    this.load(type);
  },

  onTab(e) {
    const type = e.currentTarget.dataset.type;
    if (type === this.data.type) return;
    this.setData({ type });
    this.load(type);
  },

  load(type) {
    store.markNotifyRead(type); // 查看后标记该类已读
    // 「赞和收藏」合并 like 与 collect
    api.getNotifications('all').then((all) => {
      let list = all;
      if (type === 'like') list = all.filter((n) => n.type === 'like' || n.type === 'collect');
      else list = all.filter((n) => n.type === type);
      list = list.map((n) => ({
        ...n,
        actionText: ACTION[n.type],
        timeText: fromNow(Date.now() - n.time * 3600 * 1000),
      }));
      this.setData({ list });
    });
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.note;
    if (id) wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  goUser(e) {
    const uid = e.currentTarget.dataset.uid;
    if (uid) wx.navigateTo({ url: `/pages/user/user?id=${uid}` });
  },
});
