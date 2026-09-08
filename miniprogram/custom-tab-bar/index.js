const store = require('../utils/store');
const api = require('../utils/api');
const config = require('../utils/config');

const GOLD_FINGER_ICON = 'https://app.nankaitechschool.com/uploads/up_1787930384458_5f0008fd90bf8d07.png';

function makeList(user, settings = {}) {
  const middle = user && user.official
    ? { action: 'goldFingerManage', text: '金手指管理', plus: true }
    : (user && settings.goldFingerEntryEnabled
      ? { action: 'goldFinger', text: '金手指', finger: true, icon: GOLD_FINGER_ICON, rewardedAdEnabled: settings.rewardedAdEnabled === true }
      : { spacer: true, text: '空白' });
  return [
    { pagePath: '/pages/index/index', text: '首页' },
    middle,
    { pagePath: '/pages/profile/profile', text: '我' },
  ];
}

Component({
  data: { selected: 0, list: makeList(null) },

  lifetimes: {
    attached() { this.syncRole(); },
  },

  pageLifetimes: {
    show() { this.syncRole(); },
  },

  methods: {
    syncRole() {
      const user = store.getUser();
      const sequence = (this._syncSequence || 0) + 1;
      this._syncSequence = sequence;
      this.setData({ list: makeList(user) });
      if (!user || user.official) return;
      api.getAppSettings().then((settings) => {
        if (sequence !== this._syncSequence) return;
        this.setData({ list: makeList(store.getUser(), settings) });
      });
    },

    switchTab(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      if (!item || item.spacer) return;
      if (item.action === 'goldFingerManage') {
        if (!store.isLogin()) return wx.navigateTo({ url: '/pages/login/login' });
        if (!(store.getUser() || {}).official) {
          this.syncRole();
          return wx.showToast({ title: '请使用官方账号登录', icon: 'none' });
        }
        return wx.navigateTo({ url: '/pages/gold-finger-manage/gold-finger-manage' });
      }
      if (item.action === 'goldFinger') {
        if (!store.isLogin()) return wx.navigateTo({ url: '/pages/login/login' });
        return this.openGoldFinger(item);
      }
      const url = item.pagePath;
      this.setData({ selected: index });
      wx.switchTab({ url });
    },

    openGoldFinger(item) {
      const open = () => wx.navigateTo({ url: '/pages/gold-finger/gold-finger' });
      store.syncMe().then((user) => {
        if (user && Number(user.goldExpire) > Date.now()) return open();
        if (!item.rewardedAdEnabled) return open();
        return this.showGoldRewardedAd(open);
      });
    },

    showGoldRewardedAd(onComplete) {
      const adUnitId = config.rewardedVideoAdUnitId;
      if (!adUnitId || /x{4,}/i.test(adUnitId)) {
        return wx.showModal({ title: '暂时无法查看', content: '激励广告暂未配置完成，请稍后再试。', showCancel: false });
      }
      if (!wx.createRewardedVideoAd) return wx.showToast({ title: '当前微信版本不支持激励广告', icon: 'none' });
      if (!this.rewardAd) {
        this.rewardAd = wx.createRewardedVideoAd({ adUnitId });
        this.rewardAd.onClose((result) => {
          const complete = this._rewardedAdComplete;
          this._rewardedAdComplete = null;
          if ((!result || result.isEnded) && complete) complete();
          else wx.showToast({ title: '看完广告后才能查看', icon: 'none' });
        });
        this.rewardAd.onError(() => {
          this._rewardedAdComplete = null;
          wx.showToast({ title: '广告加载失败，请稍后再试', icon: 'none' });
        });
      }
      this._rewardedAdComplete = onComplete;
      this.rewardAd.show().catch(() => this.rewardAd.load().then(() => this.rewardAd.show()).catch(() => {}));
    },
  },
});
