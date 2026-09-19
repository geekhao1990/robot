const { formatCount } = require('../../utils/util');
const store = require('../../utils/store');

function displayRatio(value) {
  const ratio = Number(value) || 1.3;
  return Math.max(0.72, Math.min(ratio, 1.5));
}

Component({
  properties: {
    note: {
      type: Object,
      value: {},
      observer(val) {
        const imageList = Array.isArray(val.images) && val.images.length
          ? val.images.filter(Boolean)
          : (val.cover ? [val.cover] : []);
        // 基础点赞数（不含当前用户）：likes 已包含「已赞 +1」，反推出 base
        this.likeBase = (val.likes || 0) - (val.liked ? 1 : 0);
        this.setData({
          ratio: displayRatio(val.coverRatio),
          imageList,
          currentImage: 0,
          likeText: formatCount(val.likes),
        });
      },
    },
    deletable: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    ratio: 1.3,
    imageList: [],
    currentImage: 0,
    likeText: '0',
  },

  methods: {
    onCoverLoad(e) {
      if (Number(e.currentTarget.dataset.index) !== 0) return;
      const width = Number(e.detail && e.detail.width);
      const height = Number(e.detail && e.detail.height);
      if (!width || !height) return;
      const ratio = displayRatio(height / width);
      if (Math.abs(ratio - this.data.ratio) > 0.01) this.setData({ ratio });
    },

    onImageChange(e) {
      this.setData({ currentImage: Number(e.detail.current) || 0 });
    },

    onTap() {
      this.triggerEvent('tap', { id: this.data.note.id });
    },

    onDelete() {
      this.triggerEvent('delete', { id: this.data.note.id });
    },

    onLike() {
      if (!store.isLogin()) {
        wx.navigateTo({ url: '/pages/login/login' });
        return;
      }
      const note = this.data.note;
      const liked = store.toggleLike(note.id);
      const likes = this.likeBase + (liked ? 1 : 0);
      this.setData({
        'note.liked': liked,
        'note.likes': likes,
        likeText: formatCount(likes),
      });
      this.triggerEvent('like', { id: note.id, liked, likes });
    },
  },
});
