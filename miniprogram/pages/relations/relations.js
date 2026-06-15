const api = require('../../utils/api');
const store = require('../../utils/store');

Page({
  data: {
    type: 'follow',
    list: [],
    emptyText: '暂无数据',
  },

  onLoad(options) {
    const type = options.type === 'fans' ? 'fans' : 'follow';
    this.setData({ type });
    wx.setNavigationBarTitle({ title: type === 'fans' ? '粉丝' : '关注' });
    this.load();
  },

  load() {
    const type = this.data.type;
    const req = type === 'fans' ? api.getFans() : api.getFollowing();
    req.then((users) => {
      const list = users.map((u) => ({ ...u, followed: store.isFollowed(u.id) }));
      this.setData({
        list,
        emptyText: type === 'fans' ? '还没有粉丝' : '还没有关注任何人',
      });
    });
  },

  toggleFollow(e) {
    const id = e.currentTarget.dataset.id;
    const followed = store.toggleFollow(id);
    const list = this.data.list.map((u) => (u.id === id ? { ...u, followed } : u));
    this.setData({ list });
  },

  goUser(e) {
    wx.navigateTo({ url: `/pages/user/user?id=${e.currentTarget.dataset.id}` });
  },
});
