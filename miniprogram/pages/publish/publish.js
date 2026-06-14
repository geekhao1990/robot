const store = require('../../utils/store');
const { toast, refreshTabBar } = require('../../utils/util');

const DRAFT_KEY = 'xhs_publish_draft';

Page({
  data: {
    images: [],
    title: '',
    content: '',
    tags: [],
    categories: ['指标', '视频', '金手指'],
    catIndex: 0,
    noteType: 'normal', // normal | course(收费笔记)
    courseUrl: '',
  },

  onLoad() {
    // 恢复草稿
    const draft = wx.getStorageSync(DRAFT_KEY);
    if (draft && (draft.title || draft.content || (draft.images || []).length)) {
      this.setData({
        images: draft.images || [],
        title: draft.title || '',
        content: draft.content || '',
        catIndex: draft.catIndex || 0,
        noteType: draft.noteType || 'normal',
        courseUrl: draft.courseUrl || '',
      });
    }
  },

  onTypeChange(e) {
    this.setData({ noteType: e.currentTarget.dataset.type });
  },

  onCourseUrl(e) {
    this.setData({ courseUrl: e.detail.value });
  },

  onShow() {
    refreshTabBar(this, 2);
  },

  // 存草稿
  onSaveDraft() {
    const { images, title, content, catIndex, noteType, courseUrl } = this.data;
    if (!images.length && !title.trim() && !content.trim()) {
      return toast('草稿是空的~');
    }
    wx.setStorageSync(DRAFT_KEY, { images, title, content, catIndex, noteType, courseUrl });
    toast('已存草稿');
  },

  chooseImage() {
    const remain = 9 - this.data.images.length;
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const paths = res.tempFiles.map((f) => f.tempFilePath);
        this.setData({ images: this.data.images.concat(paths) });
      },
    });
  },

  removeImage(e) {
    const index = e.currentTarget.dataset.index;
    const images = this.data.images.slice();
    images.splice(index, 1);
    this.setData({ images });
  },

  preview(e) {
    wx.previewImage({ current: e.currentTarget.dataset.url, urls: this.data.images });
  },

  onTitle(e) { this.setData({ title: e.detail.value }); },
  onContent(e) { this.setData({ content: e.detail.value }); },

  onCat(e) {
    this.setData({ catIndex: Number(e.detail.value) });
  },

  onPublish() {
    if (!store.isLogin()) {
      return wx.showModal({
        title: '提示',
        content: '登录后才能发布笔记',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) wx.navigateTo({ url: '/pages/login/login' });
        },
      });
    }
    const { images, title, content, tags, categories, catIndex, noteType, courseUrl } = this.data;
    if (!images.length) return toast('请至少添加一张图片');
    if (!content.trim()) return toast('写点内容吧~');
    if (noteType === 'course' && !courseUrl.trim()) return toast('请填写课程资料地址');

    const user = store.getUser();
    const cover = images[0];

    const buildNote = (ratio) => {
      const note = {
        id: 'my_' + Date.now(),
        authorId: user.id,
        author: { id: user.id, name: user.name, avatar: user.avatar },
        category: categories[catIndex],
        type: noteType,
        courseUrl: noteType === 'course' ? courseUrl.trim() : '',
        title: title.trim() || content.trim().slice(0, 15),
        content: content.trim(),
        images,
        cover,
        coverRatio: ratio,
        tags,
        likes: 0,
        collects: 0,
        comments: 0,
        liked: false,
        collected: false,
        video: false,
        time: Date.now(),
        commentList: [],
      };
      store.addMyNote(note);
      wx.removeStorageSync(DRAFT_KEY); // 发布成功清除草稿
      wx.showToast({ title: '发布成功', icon: 'success' });
      // 重置表单
      this.setData({ images: [], title: '', content: '', tags: [], catIndex: 0, noteType: 'normal', courseUrl: '' });
      setTimeout(() => {
        wx.redirectTo({ url: `/pages/detail/detail?id=${note.id}` });
      }, 800);
    };

    // 用首图比例做封面比例
    wx.getImageInfo({
      src: cover,
      success: (info) => buildNote(+(info.height / info.width).toFixed(2) || 1),
      fail: () => buildNote(1),
    });
  },
});
