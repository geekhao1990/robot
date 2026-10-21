const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '../public/admin', name), 'utf8');

test('review and wording dependencies load before ladder entry with versioned URLs', () => {
  const html = read('index.html');
  for (const name of ['media-review', 'media-wording', 'ladder-layout']) {
    assert(html.indexOf(`/admin/${name}.js?v=`) < html.indexOf('/admin/ladder.js?v='));
    assert(html.includes(`/admin/${name}.js?v=20261021-review1`));
  }
});

test('missing review dependency does not crash ladder or dragon entry', () => {
  for (const kind of ['ladder', 'dragon']) {
    const content = { innerHTML: '' };
    const context = { document: { getElementById: () => content } };
    vm.runInNewContext(read('ladder.js'), context);
    assert.doesNotThrow(() => context.renderLadder(kind));
    assert.match(content.innerHTML, /绘图组件未加载完整/);
    assert.match(content.innerHTML, /刷新后台/);
  }
});

test('complete dependencies still render the review interface', () => {
  const content = { innerHTML: '' };
  const context = vm.createContext({
    document: { getElementById: () => content },
    api: async () => ({ deepseekConfigured: true, model: 'test' }),
    showAdminToast() {},
  });
  vm.runInContext(read('media-wording.js'), context);
  vm.runInContext(read('media-review.js'), context);
  vm.runInContext(read('ladder.js'), context);
  vm.runInContext('renderMediaReview = function() {}; resetMediaWording = function() {};', context);
  context.renderLadder('ladder');
  assert.match(content.innerHTML, /连板天梯图生成/);
  assert.match(content.innerHTML, /id="mediaReview"/);
});
