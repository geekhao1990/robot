const store = require('../../utils/store');
const api = require('../../utils/api');
const config = require('../../utils/config');
const { toast, refreshTabBar } = require('../../utils/util');

const DRAFT_KEY = 'xhs_publish_draft';

// ---- 文字封面生成所需的小工具 ----
const THEMES = [
  { bg: '#FFE9EC', fg: '#E63462' },
  { bg: '#E8F3FF', fg: '#2B6CB0' },
  { bg: '#FFF4E0', fg: '#B4690E' },
  { bg: '#EAF7EE', fg: '#1E7B45' },
  { bg: '#F1ECFF', fg: '#6B46C1' },
  { bg: '#FFF0F6', fg: '#C2185B' },
  { bg: '#E7F6F8', fg: '#0E7490' },
];
const CAT_EMOJI = { '指标': '📈', '视频': '🎬', '其他': '📌' };
const EMOJI_POOL = ['✨', '💡', '🌟', '🔥', '💰', '🎯', '📊', '🍀', '📒', '🚀'];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function pickTheme(t) { return THEMES[hashStr(t || 'x') % THEMES.length]; }
function pickEmoji(cat, t) { return CAT_EMOJI[cat] || EMOJI_POOL[hashStr(t || 'y') % EMOJI_POOL.length]; }

// 按宽度把文字折行，最多 maxLines 行，超出末行加省略号
function wrapText(ctx, text, maxWidth, maxLines) {
  const chars = Array.from(text || '');
  const lines = [];
  let line = '';
  for (let i = 0; i < chars.length; i++) {
    const test = line + chars[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = chars[i];
      if (lines.length === maxLines) { line = ''; break; }
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  // 还有剩余字符未放下 -> 末行省略号
  const used = lines.join('').length;
  if (used < chars.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = last + '…';
  }
  return lines;
}

Page({
  data: {
    images: [],
    title: '',
    content: '',
    tags: [],
    categories: ['指标', '视频', '其他'],
    catIndex: 0,
    noteType: 'normal', // normal | course(收费笔记)
    courseUrl: '',
    editing: false,
    editingId: null,
  },

  fillForm(src) {
    const idx = this.data.categories.indexOf(src.category);
    this.setData({
      images: src.images || [],
      title: src.title || '',
      content: src.content || '',
      catIndex: idx > -1 ? idx : (src.catIndex || 0),
      noteType: src.type || src.noteType || 'normal',
      courseUrl: src.courseUrl || '',
    });
  },

  onTypeChange(e) {
    this.setData({ noteType: e.currentTarget.dataset.type });
  },

  onCourseUrl(e) {
    this.setData({ courseUrl: e.detail.value });
  },

  onShow() {
    refreshTabBar(this, 2);
    const app = getApp();
    // 从详情页「编辑」进入：载入该笔记，进入编辑模式
    if (app.globalData.editNoteId) {
      const id = app.globalData.editNoteId;
      app.globalData.editNoteId = null;
      const apply = (note) => {
        if (!note) return;
        this.fillForm(note);
        this.setData({ editing: true, editingId: note.id });
        wx.setNavigationBarTitle({ title: '编辑笔记' });
      };
      if (config.useRemote) api.getNoteById(id).then(apply);
      else apply(store.getMyNote(id));
      return;
    }
    // 从「我-草稿箱」进入：载入草稿
    if (app.globalData.openDraft) {
      app.globalData.openDraft = false;
      const draft = wx.getStorageSync(DRAFT_KEY);
      if (draft) {
        this.fillForm(draft);
        this.setData({ editing: false, editingId: null });
        wx.setNavigationBarTitle({ title: '编辑草稿' });
      }
    }
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
    if (!content.trim()) return toast('写点内容吧~');
    if (noteType === 'course' && !courseUrl.trim()) return toast('请填写课程资料地址');

    const user = store.getUser();
    const editing = this.data.editing;
    const editingId = this.data.editingId;

    const finish = (note) => {
      if (!editing) wx.removeStorageSync(DRAFT_KEY); // 发布成功清除草稿
      wx.showToast({ title: editing ? '已保存' : '发布成功', icon: 'success' });
      this.setData({
        images: [], title: '', content: '', tags: [], catIndex: 0,
        noteType: 'normal', courseUrl: '', editing: false, editingId: null,
      });
      wx.setNavigationBarTitle({ title: '发布笔记' });
      setTimeout(() => {
        wx.redirectTo({ url: `/pages/detail/detail?id=${note.id}` });
      }, 800);
    };

    const submit = (ratio, finalImages) => {
      const payload = {
        category: categories[catIndex],
        type: noteType,
        courseUrl: noteType === 'course' ? courseUrl.trim() : '',
        title: title.trim() || content.trim().slice(0, 15),
        content: content.trim(),
        images: finalImages,
        coverRatio: ratio,
        tags,
      };

      if (config.useRemote) {
        const p = editing ? api.updateNote(editingId, payload) : api.publishNote(payload);
        p.then(finish).catch(() => toast('发布失败，请检查网络后重试'));
        return;
      }

      // 本地模式
      const old = editing ? store.getMyNote(editingId) || {} : {};
      const note = {
        ...old,
        ...payload,
        id: editing ? editingId : 'my_' + Date.now(),
        authorId: user.id,
        author: { id: user.id, name: user.name, avatar: user.avatar },
        cover: finalImages[0],
        likes: editing ? old.likes || 0 : 0,
        collects: editing ? old.collects || 0 : 0,
        comments: editing ? old.comments || 0 : 0,
        liked: editing ? !!old.liked : false,
        collected: editing ? !!old.collected : false,
        video: false,
        time: editing ? old.time || Date.now() : Date.now(),
        commentList: editing ? old.commentList || [] : [],
      };
      if (editing) store.updateMyNote(note);
      else store.addMyNote(note);
      finish(note);
    };

    // 没有图片时，按标题/内容生成一张纯色文字封面（小红书同款效果）
    const ensureImages = () => {
      if (images.length) return Promise.resolve(images);
      const coverText = title.trim() || content.trim().slice(0, 24) || '新笔记';
      wx.showLoading({ title: '生成封面', mask: true });
      return this.generateCover(coverText, categories[catIndex])
        .then((tmp) => { wx.hideLoading(); return [tmp]; })
        .catch(() => { wx.hideLoading(); return []; });
    };

    ensureImages().then((workingImages) => {
      if (!workingImages.length) return toast('封面生成失败，请手动添加一张图片');
      const cover = workingImages[0];
      // 先按首图比例确定封面比例，再（远程时）上传图片，最后提交
      const run = (finalImages) => {
        wx.getImageInfo({
          src: cover,
          success: (info) => submit(+(info.height / info.width).toFixed(2) || 1, finalImages),
          fail: () => submit(1, finalImages),
        });
      };

      if (config.useRemote) {
        // 已是远程 URL 的跳过上传（编辑场景）；本地临时路径先上传换 URL
        wx.showLoading({ title: '上传中', mask: true });
        Promise.all(
          workingImages.map((p) => (/^https?:\/\//.test(p) ? Promise.resolve(p) : api.uploadImage(p)))
        )
          .then((urls) => { wx.hideLoading(); run(urls); })
          .catch(() => { wx.hideLoading(); toast('图片上传失败，请重试'); });
      } else {
        run(workingImages);
      }
    });
  },

  // 用 canvas 生成纯色底 + 标题文字 + emoji 的封面，返回临时文件路径
  generateCover(text, category) {
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .in(this)
        .select('#coverCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const node = res && res[0] && res[0].node;
          if (!node) return reject(new Error('no canvas'));
          const W = 375, H = 500;
          const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2) || 2;
          node.width = W * dpr;
          node.height = H * dpr;
          const ctx = node.getContext('2d');
          ctx.scale(dpr, dpr);

          const theme = pickTheme(text);
          ctx.fillStyle = theme.bg;
          ctx.fillRect(0, 0, W, H);

          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          // emoji
          ctx.font = '92px sans-serif';
          ctx.fillText(pickEmoji(category, text), W / 2, 150);

          // 标题（自动换行，最多 5 行）
          ctx.fillStyle = theme.fg;
          ctx.font = 'bold 30px sans-serif';
          const lines = wrapText(ctx, text, W - 70, 5);
          const lineH = 44;
          let y = 300 - ((lines.length - 1) * lineH) / 2;
          lines.forEach((ln) => { ctx.fillText(ln, W / 2, y); y += lineH; });

          // 角标
          ctx.globalAlpha = 0.55;
          ctx.font = '18px sans-serif';
          ctx.fillText('· 笔记 ·', W / 2, H - 42);
          ctx.globalAlpha = 1;

          setTimeout(() => {
            wx.canvasToTempFilePath({
              canvas: node,
              success: (r) => resolve(r.tempFilePath),
              fail: reject,
            });
          }, 50);
        });
    });
  },
});
