const store = require('../../utils/store');
const { toast } = require('../../utils/util');

const DEFAULT_AVATAR = 'https://i.pravatar.cc/150?img=68';

Page({
  data: {
    avatar: DEFAULT_AVATAR,
    name: '',
  },

  // 微信授权登录：获取微信资料 + 登录态
  onWechatLogin() {
    // 先拿登录 code（接真实后端时用它换 openid；这里仅演示）
    wx.login({ complete: () => {} });

    if (!wx.getUserProfile) {
      return toast('当前微信版本不支持授权登录');
    }
    wx.getUserProfile({
      desc: '用于完善会员资料',
      success: (res) => {
        const info = res.userInfo || {};
        this.doLogin({
          id: 'wx_' + Date.now().toString().slice(-6),
          name: info.nickName || '微信用户',
          avatar: info.avatarUrl || DEFAULT_AVATAR,
          desc: '这个人很懒，什么都没留下',
          fans: 0,
          follows: 0,
          likes: 0,
        });
      },
      fail: () => toast('已取消授权'),
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
    });
  },

  // 登录走后端：换取 token 并同步会员/交互状态（会员是否开通以后端为准）
  doLogin(user) {
    wx.showLoading({ title: '登录中' });
    store.login(user).then((loggedInUser) => {
      wx.hideLoading();
      const approved = loggedInUser && loggedInUser.accessEnabled;
      wx.showToast({ title: approved ? '登录成功' : '已提交审核', icon: 'success' });
      setTimeout(() => {
        const pages = getCurrentPages();
        if (pages.length > 1) wx.navigateBack();
        else wx.switchTab({ url: '/pages/profile/profile' });
      }, 700);
    }).catch((err) => {
      wx.hideLoading();
      const detail = (err && (err.errMsg || (err.data && err.data.error))) || '未知网络错误';
      wx.showModal({
        title: '登录失败',
        content: `无法连接服务器。\n${detail}`,
        showCancel: false,
      });
    });
  },
});
