const { formatCount } = require('../../utils/util');
const store = require('../../utils/store');

Component({
  properties: {
    note: {
      type: Object,
      value: {},
      observer(val) {
        this.setData({
          ratio: val.coverRatio || 1.3,
          likeText: formatCount(val.likes),
        });
      },
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

    onLike() {
      const note = this.data.note;
      const liked = store.toggleLike(note.id);
      const likes = note.likes + (liked ? 1 : -1);
      this.setData({
        'note.liked': liked,
        'note.likes': likes,
        likeText: formatCount(likes),
      });
      this.triggerEvent('like', { id: note.id, liked, likes });
    },
  },
});
