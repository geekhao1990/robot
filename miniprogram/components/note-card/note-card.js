const { formatCount } = require('../../utils/util');
const store = require('../../utils/store');

Component({
  properties: {
    note: {
      type: Object,
      value: {},
      observer(val) {
        // 基础点赞数（不含当前用户）：likes 已包含「已赞 +1」，反推出 base
        this.likeBase = (val.likes || 0) - (val.liked ? 1 : 0);
        this.setData({
          ratio: val.coverRatio || 1.3,
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
    likeText: '0',
  },

  methods: {
    onTap() {
      this.triggerEvent('tap', { id: this.data.note.id });
    },

    onDelete() {
      this.triggerEvent('delete', { id: this.data.note.id });
    },

    onLike() {
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
