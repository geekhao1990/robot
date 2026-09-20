function isDarkFundNote(note) {
  if (!note) return false;
  if (String(note.id || '').startsWith('dark_')) return true;
  return Array.isArray(note.tags) && note.tags.includes('暗盘资金');
}

function darkFundOwnerId(data, note) {
  if (!isDarkFundNote(note)) return '';
  if (note.ownerUserId) return String(note.ownerUserId);
  const order = (data.darkFundOrders || []).find((item) => (
    item.noteId === note.id
    || (item.snapshot && item.snapshot.note && item.snapshot.note.id === note.id)
    || `dark_${item.id}` === note.id
  ));
  return order ? String(order.userId || '') : '';
}

function canViewNote(data, note, reader) {
  if (!note || note.visible === false) return false;
  if (!isDarkFundNote(note)) return true;
  const ownerUserId = darkFundOwnerId(data, note);
  return Boolean(reader && ownerUserId && String(reader.id) === ownerUserId);
}

module.exports = { canViewNote, darkFundOwnerId, isDarkFundNote };
