function isLiveCourse(note) {
  return !!note && (note.resourceKind === 'live-course' || note.type === 'live' || note.category === '直播课');
}
function today(now = Date.now()) { return new Date(now + 28800000).toISOString().slice(0,10); }
function available(note, now = Date.now()) {
  const date = note?.liveDate || note?.liveStartTime?.slice(0,10) || (Number(note?.time) ? today(Number(note.time)) : '');
  return !isLiveCourse(note) || (!!date && date <= today(now));
}
function courseTitle(title, startTime) {
  let text = String(title || '').trim();
  const match = String(startTime || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) return text;
  const hasDate = /\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}|\d{1,2}月\d{1,2}日/.test(text);
  const hasMinute = /(?:^|[^\d])(?:[01]?\d|2[0-3])[:：][0-5]\d(?!\d)/.test(text);
  const suffix = [hasDate ? '' : `${match[1]}-${match[2]}-${match[3]}`, hasMinute ? '' : `${match[4]}:${match[5]}`].filter(Boolean).join(' ');
  return suffix ? `${text} ${suffix}`.trim() : text;
}
function courseContent(content) {
  return String(content || '')
    .replace(/(?:点击下方按钮(?:播放视频|观看直播)|复制下方链接到浏览器观看直播)/g, '')
    .replace(/[（(][^（）()\n]*直播链接失效后[^（）()\n]*[）)]/g, '')
    .trim();
}
function courseState(note, now = Date.now()) {
  if (!isLiveCourse(note)) return {};
  const ready = require('./resource-links').resourceList(note).some(resource => resource.provider === 'quark');
  const status = note.liveSourceStatus == null ? null : Number(note.liveSourceStatus);
  // Legacy notes may not have upstream flags. Use the scheduled Beijing time,
  // not the last synchronization time or the availability of the replay page.
  const scheduled = String(note.liveStartTime || note.title || '').match(/(\d{4}-\d{2}-\d{2})[ T](\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?/);
  const startsAt = scheduled
    ? Date.parse(`${scheduled[1]}T${scheduled[2].padStart(2, '0')}:${scheduled[3]}:${scheduled[4] || '00'}+08:00`)
    : NaN;
  const started = status === 1 || status === 3 || (Number.isFinite(startsAt) && startsAt <= now);
  const tag = ready ? { key: 'replay', label: '可回放' }
    : started ? { key: 'recording', label: '录制中' }
    : { key: 'preview', label: '预告' };
  return { isLiveCourse: true, liveTags: [tag], livePlaybackAvailable: ready };
}
module.exports = { isLiveCourse, today, available, courseTitle, courseContent, courseState };
