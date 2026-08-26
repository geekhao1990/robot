const store = require('../../utils/store');
const config = require('../../utils/config');

const PLANS = [
  {
    id: 'month',
    name: '月卡',
    price: 9.9,
    unit: '月',
    features: ['金手指（永久使用权）', '阴阳谱（永久使用权）'],
  },
  {
    id: 'year',
    name: '年卡',
    price: 99,
    unit: '年',
    badge: '最超值',
    features: ['金手指（永久使用权）', '阴阳谱（永久使用权）'],
  },
  {
    id: 'lifetime',
    name: '永久卡',
    price: 188,
    unit: '永久',
    badge: '一次开通',
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
    memberCode: '',
  },

  onShow() {
    const proceed = () => this.render(store.getUser());
    if (store.isLogin() && (config.useRemote || config.previewAuthRemote || config.wechatAuthRemote)) store.syncMe().then(proceed);
    else proceed();
  },

  render(user) {
    const now = Date.now();
    const vipActive = !!(user && (user.vipActive || (user.vip && user.vipExpire && user.vipExpire > now)));
    let vipStatusText;
    if (!user) vipStatusText = '登录后查看会员状态';
    else if (user.vipPermanent) vipStatusText = '永久会员';
    else if (vipActive) vipStatusText = '会员有效期至 ' + this.fmt(user.vipExpire);
    else if (user.vipExpire) vipStatusText = 'VIP 已过期，续费请联系企业微信';
    else vipStatusText = '开通会员，畅享专属权益';
    this.setData({ user, vipActive, vipStatusText, memberCode: user ? user.id : '' });
  },

  fmt(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  },

  copyMemberCode() {
    if (!this.data.memberCode) return wx.navigateTo({ url: '/pages/login/login' });
    wx.setClipboardData({ data: this.data.memberCode });
  },

  // 添加企业微信，添加后把会员编号发给客服，由后台手动开通。
  onContact() {
    if (!this.data.user) return wx.navigateTo({ url: '/pages/login/login' });
    wx.previewImage({ current: config.vipQr, urls: [config.vipQr] });
  },
});
