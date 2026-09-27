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
        this._pendingNote = val || {};
        if (this._cardAttached) this.applyNote(this._pendingNote);
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
    likeText: '0',
    cardTitle: '',
    authorName: '',
    authorAvatar: '/images/niulai-logo.png',
  },

  lifetimes: {
    attached() {
      this._cardAttached = true;
      this.applyNote(this._pendingNote || this.data.note || {});
    },
    detached() {
      this._cardAttached = false;
    },
  },

  methods: {
    applyNote(value) {
      if (!this._cardAttached) return;
      const note = value || {};
      const author = note.author || {};
      const imageList = Array.isArray(note.images) && note.images.length
        ? note.images.filter(Boolean)
        : (note.cover ? [note.cover] : []);
      // 基础点赞数（不含当前用户）：likes 已包含「已赞 +1」，反推出 base
      this.likeBase = (Number(note.likes) || 0) - (note.liked ? 1 : 0);
      this.setData({
        ratio: displayRatio(note.coverRatio),
        imageList,
        likeText: formatCount(note.likes),
        cardTitle: String(note.title || ''),
        authorName: String(author.name || ''),
        authorAvatar: String(author.avatar || '/images/niulai-logo.png'),
      });
    },

    onCoverLoad(e) {
      if (!this._cardAttached) return;
      if (Number(e.currentTarget.dataset.index) !== 0) return;
      const width = Number(e.detail && e.detail.width);
      const height = Number(e.detail && e.detail.height);
      if (!width || !height) return;
      const ratio = displayRatio(height / width);
      if (Math.abs(ratio - this.data.ratio) > 0.01) this.setData({ ratio });
    },

    onAvatarError() {
      if (!this._cardAttached || this.data.authorAvatar === '/images/niulai-logo.png') return;
      this.setData({ authorAvatar: '/images/niulai-logo.png' });
    },

    onTap() {
      const id = this.data.note && this.data.note.id;
      if (!id) return;
      this.triggerEvent('open', { id });
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
