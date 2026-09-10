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
          content: `股票代码：${order.stockCode}\n数据日期：${order.compactTradeDate}\n以下为本次查询的暗盘资金数据。`,
          images: [],
          author: { name: 'NiuLai' },
        };
        this.setData({ order: { ...order, snapshot, note, amountText: (Number(order.amount || 0) / 100).toFixed(2), paidAtText: formatTime(order.paidAt) } });
      })
      .catch(() => wx.showToast({ title: '订单加载失败', icon: 'none' }))
      .finally(() => this.setData({ loading: false }));
  },
});
