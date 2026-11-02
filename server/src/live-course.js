function isLiveCourse(note) {
  return !!note && (note.resourceKind === 'live-course' || note.type === 'live' || note.category === '直播课');
}
function today(now = Date.now()) { return new Date(now + 28800000).toISOString().slice(0,10); }
function available(note, now = Date.now()) {
  const date = note?.liveDate || note?.liveStartTime?.slice(0,10) || (Number(note?.time) ? today(Number(note.time)) : '');
  return !isLiveCourse(note) || (!!date && date <= today(now));
}
module.exports = { isLiveCourse, today, available };
