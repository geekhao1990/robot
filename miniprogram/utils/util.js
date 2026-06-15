// utils/util.js

/** 格式化数字：超过 1万 显示为 x.x万 */
function formatCount(n) {
  if (n == null) return '0';
  if (n < 10000) return String(n);
  return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
}

/** 相对时间 */
function fromNow(ts) {
  const diff = Date.now() - ts;
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return '刚刚';
  if (diff < hour) return Math.floor(diff / min) + '分钟前';
  if (diff < day) return Math.floor(diff / hour) + '小时前';
  if (diff < 30 * day) return Math.floor(diff / day) + '天前';
  const d = new Date(ts);
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

/** 轻提示 */
function toast(title, icon = 'none') {
  wx.showToast({ title, icon });
}

/** 自定义 tabBar：设置选中项并刷新消息角标。在 tab 页 onShow 调用 */
function refreshTabBar(page, index) {
  const tb = page.getTabBar && page.getTabBar();
  if (tb) {
    tb.setData({ selected: index });
    tb.refreshBadge();
  }
}

module.exports = { formatCount, fromNow, toast, refreshTabBar };
