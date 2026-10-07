const api = require('./api');

function openGoldEntry(options = {}) {
  const source = String(options.source || 'goldEntry');
  return api.getAppSettings()
    .then((settings) => {
      if (settings && settings.reviewModeEnabled === true) {
        wx.showToast({ title: '功能暂未开放', icon: 'none' });
        return false;
      }
      if (settings && settings.goldFingerEntryEnabled === false) {
        wx.showToast({ title: '金手指入口暂未开放', icon: 'none' });
        return false;
      }
      const noteId = String((settings && settings.featuredNoteId) || '').trim();
      if (!noteId) {
        wx.showToast({ title: '金手指笔记暂未配置', icon: 'none' });
        return false;
      }
      if (typeof options.beforeNavigate === 'function') options.beforeNavigate(noteId);
      return new Promise((resolve) => {
        wx.navigateTo({
          url: `/pages/detail/detail?id=${encodeURIComponent(noteId)}&from=${encodeURIComponent(source)}`,
          success: () => resolve(true),
          fail: (error) => {
            if (typeof options.onNavigateFail === 'function') options.onNavigateFail(error);
            wx.showToast({ title: '页面打开失败，请重试', icon: 'none' });
            resolve(false);
          },
        });
      });
    })
    .catch(() => {
      wx.showToast({ title: '金手指笔记暂时无法打开', icon: 'none' });
      return false;
    });
}

module.exports = { openGoldEntry };
