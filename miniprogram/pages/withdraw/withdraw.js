const api = require('../../utils/api');
const store = require('../../utils/store');

const STATUS_TEXT = {
  PENDING: '待审核',
  APPROVED: '审核通过，待打款',
  REJECTED: '已拒绝，积分已退回',
  PAID: '已打款',
};

Page({
  data: {
    loading: true,
    submitting: false,
    balance: 0,
    cashValue: '0.00',
    pointsPerYuan: 200,
    minimumYuan: 1,
    amountYuan: '',
    pointsNeeded: 0,
    realName: '',
    contact: '',
    remark: '',
    list: [],
  },

  onLoad() {
    if (!store.isLogin()) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    this.loadData();
  },

  onShow() {
    if (store.isLogin() && !this.data.loading) this.loadData();
  },

  loadData() {
    this.setData({ loading: true });
    Promise.all([api.getPoints(), api.getWithdrawals()])
      .then(([summary, result]) => {
        const rules = result.rules || summary.rules || {};
        this.setData({
          loading: false,
          balance: Number(summary.balance) || 0,
          cashValue: Number(summary.cashValue || 0).toFixed(2),
          pointsPerYuan: Number(rules.pointsPerYuan) || 200,
          minimumYuan: Number(rules.minimumYuan) || 1,
          list: (result.list || []).map((item) => ({
            ...item,
            amountText: Number(item.amountYuan || 0).toFixed(2),
            statusText: STATUS_TEXT[item.status] || item.status,
            timeText: this.formatTime(item.createdAt),
          })),
        });
      })
      .catch(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '提现信息加载失败', icon: 'none' });
      });
  },

  onAmountInput(event) {
    const value = event.detail.value;
    const amount = Number(value) || 0;
    this.setData({ amountYuan: value, pointsNeeded: Math.round(amount * this.data.pointsPerYuan) });
  },

  onInput(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },

  submit() {
    if (this.data.submitting) return;
    const amountYuan = Number(this.data.amountYuan);
    if (!amountYuan || amountYuan < this.data.minimumYuan) {
      wx.showToast({ title: `最低提现${this.data.minimumYuan}元`, icon: 'none' });
      return;
    }
    if (!this.data.realName.trim() || !this.data.contact.trim()) {
      wx.showToast({ title: '请填写收款信息', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    api.createWithdrawal({
      amountYuan,
      realName: this.data.realName.trim(),
      contact: this.data.contact.trim(),
      remark: this.data.remark.trim(),
    }).then(() => {
      this.setData({ submitting: false, amountYuan: '', pointsNeeded: 0, remark: '' });
      wx.showToast({ title: '已提交审核', icon: 'success' });
      this.loadData();
    }).catch((error) => {
      const body = error && error.data;
      this.setData({ submitting: false });
      wx.showToast({ title: (body && (body.message || body.error)) || '提交失败', icon: 'none' });
    });
  },

  formatTime(timestamp) {
    const date = new Date(timestamp);
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },
});
