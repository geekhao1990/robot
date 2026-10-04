function confirmPurchase(name, amountText) {
  return new Promise((resolve) => {
    wx.showModal({
      title: '确认购买',
      content: `商品：${name}\n金额：${amountText}`,
      confirmText: '立即支付',
      cancelText: '取消',
      success: (result) => resolve(result.confirm === true),
      fail: () => resolve(false),
    });
  });
}

module.exports = { confirmPurchase };
