const store = require('../../utils/store');
const config = require('../../utils/config');

const PLANS = [
  {
    id: 'month',
    name: '月卡',
    price: 100,
    unit: '月',
    features: ['金手指（永久使用权）', '阴阳谱（永久使用权）'],
  },
  {
    id: 'year',
    name: '年卡',
    price: 1000,
    unit: '年',
    badge: '最超值',
    features: ['金手指（永久使用权）', '阴阳谱（永久使用权）'],
  },
];

// 用于对比展示的权益矩阵
const COMPARE = [
  { label: '金手指（永久使用权）', month: true, year: true },
  { label: '阴阳谱（永久使用权）', month: true, year: true },
];

Page({
  data: {
    user: null,
    plans: PLANS,
    compare: COMPARE,
    vipActive: false,
    vipStatusText: '',
    vipContact: config.vipContact,
  },

  onShow() {
    const proceed = () => this.render(store.getUser());
    if (store.isLogin() && config.useRemote) store.syncMe().then(proceed);
    else proceed();
  },

  render(user) {
    const now = Date.now();
    const vipActive = !!(user && (user.vipActive || (user.vip && user.vipExpire && user.vipExpire > now)));
    let vipStatusText;
    if (!user) vipStatusText = '登录后查看会员状态';
    else if (vipActive) vipStatusText = '会员有效期至 ' + this.fmt(user.vipExpire);
    else if (user.vipExpire) vipStatusText = 'VIP 已过期，续费请联系企业微信';
    else vipStatusText = '开通会员，畅享专属权益';
    this.setData({ user, vipActive, vipStatusText });
  },

  fmt(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  },

  // 联系企业微信开通
  onContact() {
    wx.setClipboardData({
      data: this.data.vipContact,
      success: () => {
        wx.showModal({
          title: '联系企业微信开通',
          content: `企业微信号「${this.data.vipContact}」已复制。\n请添加企业微信，由客服为你开通月卡 / 年卡会员。`,
          showCancel: false,
          confirmText: '我知道了',
        });
      },
      fail: () => {
        wx.showModal({
          title: '联系企业微信开通',
          content: `请添加企业微信「${this.data.vipContact}」，由客服为你开通会员。`,
          showCancel: false,
          confirmText: '我知道了',
        });
      },
    });
  },
});
