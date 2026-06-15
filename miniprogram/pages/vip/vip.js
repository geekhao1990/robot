const store = require('../../utils/store');

const PLANS = [
  {
    id: 'month',
    name: '月卡',
    price: 100,
    unit: '月',
    days: 30,
    features: ['朱杨张等老师服务包', '免广告观看课程权限'],
  },
  {
    id: 'year',
    name: '年卡',
    price: 1000,
    unit: '年',
    days: 365,
    badge: '最超值',
    features: [
      '朱杨张等老师服务包',
      '免广告观看课程权限',
      '金融大师软件一台主机一年使用权',
    ],
  },
];

Page({
  data: {
    user: null,
    plans: PLANS,
    selected: 1, // 默认选中年卡
    vipExpireText: '',
  },

  onShow() {
    const user = store.getUser();
    this.setData({
      user,
      vipExpireText: user && user.vipExpire ? this.fmt(user.vipExpire) : '',
    });
  },

  fmt(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  },

  onSelect(e) {
    this.setData({ selected: Number(e.currentTarget.dataset.index) });
  },

  onPay() {
    const user = store.getUser();
    if (!user) {
      return wx.showModal({
        title: '提示',
        content: '请先登录后再开通会员',
        confirmText: '去登录',
        success: (r) => { if (r.confirm) wx.navigateTo({ url: '/pages/login/login' }); },
      });
    }
    const plan = this.data.plans[this.data.selected];
    wx.showModal({
      title: '确认开通',
      content: `确认支付 ¥${plan.price} 开通「${plan.name}」？（演示，不会真实扣款）`,
      confirmText: '确认支付',
      success: (r) => {
        if (!r.confirm) return;
        // 以现有有效期为基础叠加（续费）
        const now = Date.now();
        const base = user.vip && user.vipExpire && user.vipExpire > now ? user.vipExpire : now;
        const vipExpire = base + plan.days * 24 * 3600 * 1000;
        store.setUser({ ...user, vip: true, vipPlan: plan.id, vipExpire });
        wx.showToast({ title: '开通成功', icon: 'success' });
        setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/profile/profile' }) }), 800);
      },
    });
  },
});
