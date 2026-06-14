const store = require('../../utils/store');
const { toast } = require('../../utils/util');

const DEFAULT_AVATAR = 'https://i.pravatar.cc/150?img=68';

Page({
  data: {
    avatar: DEFAULT_AVATAR,
    name: '',
  },

  onChooseAvatar(e) {
    this.setData({ avatar: e.detail.avatarUrl });
  },

  onName(e) {
    this.setData({ name: e.detail.value });
  },

  onLogin() {
    const name = this.data.name.trim();
    if (!name) return toast('请输入昵称');
    this.doLogin({
      id: 'me_' + Date.now().toString().slice(-6),
      name,
      avatar: this.data.avatar,
      desc: '这个人很懒，什么都没留下',
      fans: 0,
      follows: 0,
      likes: 0,
      vip: false,
    });
  },

  onQuickLogin() {
    this.doLogin({
      id: 'me_demo',
      name: '小红薯_' + Math.floor(Math.random() * 9000 + 1000),
      avatar: DEFAULT_AVATAR,
      desc: '热爱生活，分享日常 ✨',
      fans: 128,
      follows: 56,
      likes: 1024,
      vip: true, // 演示账号为 VIP：获取课程时跳过广告
    });
  },

  doLogin(user) {
    store.setUser(user);
    wx.showToast({ title: '登录成功', icon: 'success' });
    setTimeout(() => {
      const pages = getCurrentPages();
      if (pages.length > 1) wx.navigateBack();
      else wx.switchTab({ url: '/pages/profile/profile' });
    }, 700);
  },
});
