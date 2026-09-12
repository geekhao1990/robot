const api = require('../../utils/api');

function formatTime(timestamp) {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

Page({
  data: { loading: true, order: null },
  onLoad(options) {
    const id = options && options.id;
    if (!id) return this.setData({ loading: false });
    api.getDarkFundOrder(id)
      .then((order) => {
        const snapshot = order.snapshot || {};
        const note = snapshot.note || {
          title: `${order.stockCode}｜${order.compactTradeDate}暗盘数据`,
          content: `本次暗盘资金查询结果正在整理，请稍后刷新历史订单。`,
          images: [],
          author: { name: 'NiuLai' },
        };
        this.setData({ order: { ...order, snapshot, note, amountText: (Number(order.amount || 0) / 100).toFixed(2), paidAtText: formatTime(order.paidAt) } });
      })
      .catch(() => wx.showToast({ title: '订单加载失败', icon: 'none' }))
      .finally(() => this.setData({ loading: false }));
  },
});
