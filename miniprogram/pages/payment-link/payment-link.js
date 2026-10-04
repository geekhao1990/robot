Page({
  data: { url: '' },
  onLoad(options) {
    let url = '';
    try { url = decodeURIComponent(String(options && options.url || '')); } catch (_) {}
    if (!/^https:\/\//i.test(url)) {
      wx.showToast({ title: '支付链接无效', icon: 'none' });
      return setTimeout(() => wx.navigateBack(), 600);
    }
    this.setData({ url });
  },
});
