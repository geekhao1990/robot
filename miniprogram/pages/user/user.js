const api = require('../../utils/api');
const store = require('../../utils/store');
const { formatCount, toast } = require('../../utils/util');

Page({
  data: {
    user: null,
    notes: [],
    left: [],
    right: [],
    followed: false,
    fansText: '0',
    likesText: '0',
  },

  onLoad(options) {
    this.userId = options.id;
    api.getUserById(this.userId).then((user) => {
      if (!user) return toast('用户不存在');
      this.setData({
        user,
        followed: store.isFollowed(user.id),
        fansText: formatCount(user.fans),
        likesText: formatCount(user.likes),
      });
      wx.setNavigationBarTitle({ title: user.name });
    });

    api.getNotesByAuthor(this.userId).then((notes) => {
      const left = [], right = [];
      let lh = 0, rh = 0;
      notes.forEach((n) => {
        const h = n.coverRatio || 1.3;
        if (lh <= rh) { left.push(n); lh += h; }
        else { right.push(n); rh += h; }
      });
      this.setData({ notes, left, right });
    });
  },

  onFollow() {
    if (!store.isLogin()) {
      return wx.showModal({
        title: '提示',
        content: '登录后才能关注',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) wx.navigateTo({ url: '/pages/login/login' });
        },
      });
    }
    const followed = store.toggleFollow(this.userId);
    this.setData({ followed });
  },

  goDetail(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.detail.id}` });
  },
});
