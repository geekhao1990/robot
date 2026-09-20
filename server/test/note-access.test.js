const test = require('node:test');
const assert = require('node:assert/strict');
const { canViewNote, darkFundOwnerId, isDarkFundNote } = require('../src/note-access');

test('暗盘笔记只允许下单用户查看', () => {
  const note = { id: 'dark_DF001', visible: true, tags: ['暗盘资金'] };
  const data = { darkFundOrders: [{ id: 'DF001', userId: 'u1', noteId: note.id }] };
  assert.equal(isDarkFundNote(note), true);
  assert.equal(darkFundOwnerId(data, note), 'u1');
  assert.equal(canViewNote(data, note, { id: 'u1' }), true);
  assert.equal(canViewNote(data, note, { id: 'u2' }), false);
  assert.equal(canViewNote(data, note, null), false);
});

test('普通可见笔记不受暗盘隐私规则影响', () => {
  const data = { darkFundOrders: [] };
  assert.equal(canViewNote(data, { id: 'n1', visible: true }, null), true);
  assert.equal(canViewNote(data, { id: 'n2', visible: false }, { id: 'u1' }), false);
});
