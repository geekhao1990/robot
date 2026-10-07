const api = require('../../utils/api');
const store = require('../../utils/store');

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatTime(timestamp) {
  if (!Number(timestamp)) return '—';
  const date = new Date(Number(timestamp));
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function statusClass(status) {
  if (status === 'SUCCESS') return 'success';
  if (['FAILED', 'PAYERROR', 'CLOSED', 'REVOKED'].includes(status)) return 'failed';
  return 'pending';
}

Page({
  data: {
    loading: true,
    orders: [],
    page: 1,
    pages: 1,
    total: 0,
  },
  onLoad() {
    if (!store.isLogin()) return wx.redirectTo({ url: '/pages/login/login' });
    this.loadOrders(1);
  },
  onPullDownRefresh() {
    this.loadOrders(1, true);
  },
  loadOrders(page, refreshing = false) {
    if (this._loading) return Promise.resolve();
    this._loading = true;
    this.setData({ loading: !refreshing });
    return api.getPaymentOrders(page, 20)
      .then((result) => {
        const orders = (result.list || []).map((order) => ({
          ...order,
          amountText: (Number(order.amount || 0) / 100).toFixed(2),
          createdTime: formatTime(order.createdAt),
          paidTime: formatTime(order.paidAt),
          statusClass: statusClass(order.status),
        }));
        this.setData({
          orders,
          page: Number(result.page) || 1,
          pages: Number(result.pages) || 1,
          total: Number(result.total) || 0,
        });
      })
      .catch((error) => {
        const message = (error && error.data && error.data.error) || '订单加载失败，请稍后再试';
        wx.showToast({ title: message, icon: 'none' });
      })
      .finally(() => {
        this._loading = false;
        this.setData({ loading: false });
        wx.stopPullDownRefresh();
      });
  },
  previousPage() {
    if (this.data.page > 1) this.loadOrders(this.data.page - 1);
  },
  nextPage() {
    if (this.data.page < this.data.pages) this.loadOrders(this.data.page + 1);
  },
});
