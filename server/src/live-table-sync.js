const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { fetchAuthenticatedJson, fetchAuthenticatedResponse } = require('./gold-finger-sync');
const { UPLOAD_DIR, detectedImageType, imageDimensions, normalizeImageBytes } = require('./upload');
const { isLiveCourse } = require('./live-course');
let timer, running = false;
function config() {
  return {
    enabled: String(process.env.LIVETABLE_SYNC_ENABLED || process.env.GOLD_FINGER_SYNC_ENABLED || '').toLowerCase() === 'true',
    baseUrl: process.env.LIVETABLE_SOURCE_URL || process.env.GOLD_FINGER_SOURCE_URL,
    username: process.env.LIVETABLE_SOURCE_USERNAME || process.env.GOLD_FINGER_SOURCE_USERNAME,
    password: process.env.LIVETABLE_SOURCE_PASSWORD || process.env.GOLD_FINGER_SOURCE_PASSWORD,
  };
}
function parseItems(payload) {
  const items = Array.isArray(payload) ? payload : payload?.items;
  if (!Array.isArray(items) || items.length > 500) throw new Error('直播课表数据格式错误');
  const seen = new Set();
  return items.map(item => {
    const room = String(item.room_id || '');
    if (!/^\d{1,16}$/.test(room) || seen.has(room)) throw new Error('直播课表房间标识无效或重复');
    seen.add(room);
    const link = item.link ? new URL(item.link) : null;
    if (link && (link.protocol !== 'https:' || link.hostname !== 'live.myhexin.com' || link.pathname !== '/player/' || link.username || link.password || link.searchParams.get('i') !== room)) throw new Error('直播播放地址无效');
    const startTime = String(item.start_time || '').replace('：', ':');
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(startTime) || !Number.isFinite(Date.parse(startTime.replace(' ','T')+':00+08:00'))) throw new Error('课程开课时间无效');
    const anchors = Array.isArray(item.anchors) ? item.anchors.filter(a=>typeof a==='string').map(a=>a.trim()).filter(Boolean) : [];
    const poster = String(item.poster || '');
    if (poster && !/^\/livetable\/posters\/\d+\.(?:jpg|jpeg|png|webp)$/i.test(poster)) throw new Error('课程海报地址无效');
    let title = String(item.title || '').trim();
    if (!title) {
      const date = String(item.start_time || '').match(/^\d{4}-(\d{2})-(\d{2})/);
      const anchors = Array.isArray(item.anchors) ? item.anchors.filter(a => typeof a === 'string').map(a => a.trim()).filter(Boolean) : [];
      if (!date || !anchors.length) throw new Error('空标题课程缺少日期或讲师');
      title = `${Number(date[1])}月${Number(date[2])}日${anchors.join('、')}课程`;
    }
    if (title.length > 300) throw new Error('直播课程标题过长');
    return { room, link: link?.href || '', title, startTime, anchors, poster, hasReplay: item.has_replay === 1, future: item.is_future === 1 };
  });
}
function applyItems(data, items, now = Date.now()) {
  const author = (data.users || []).find(u => u.name === 'THS复盘课');
  if (!author) throw new Error('请先创建作者账号“THS复盘课”');
  data.liveTableRooms ||= {};
  data.notes ||= [];
  let created = 0, updated = 0, skipped = 0;
  for (const item of items) {
    if (!item.title) { skipped++; continue; }
    const old = data.liveTableRooms[item.room];
    let note = old && data.notes.find(n => n.id === old.noteId);
    // Deleting a synchronized note in the admin must not resurrect it next minute.
    if (old && !note) { skipped++; continue; }
    if (!note) {
      note = { id: 'live_' + crypto.randomUUID(), authorId: author.id,
        author: { id: author.id, name: author.name, avatar: author.avatar },
        type: 'live', category: '直播课', content: '点击下方按钮播放视频',
        images: [], cover: '', coverRatio: 1, tags: ['课程'], likes: 0, collects: 0,
        riskDisclaimerEnabled: false, visible: true, free: true, video: false,
        resourceKind: 'live-course', courseUrl: '', baiduUrl: '', quarkUrl: '', time: now };
      data.notes.unshift(note); created++;
    } else if (note.title !== item.title || old.link !== item.link) { updated++; }
    note.title = item.title;
    Object.assign(note, { type:'live', category:'直播课', resourceKind:'live-course',
      authorId:author.id, author:{id:author.id,name:author.name,avatar:author.avatar},
      content:'点击下方按钮播放视频', baiduUrl:'',quarkUrl:'',courseUrl:'',
      liveDate:item.startTime.slice(0,10),liveStartTime:item.startTime, liveAnchors:item.anchors,livePlaybackAvailable:!!item.link,
      time:Date.parse(item.startTime.replace(' ','T')+':00+08:00') });
    if (!note.liveDefaultsV2) { note.free=true; note.liveDefaultsV2=true; }
    if (item.cover) { note.cover=item.cover; note.images=[item.cover]; note.coverRatio=item.coverRatio; }
    data.liveTableRooms[item.room] = { ...old, ...item, noteId: note.id };
  }
  data.notes.sort((a,b)=>(Number(b.time)||0)-(Number(a.time)||0));
  return { created, updated, skipped, total: items.length };
}
function playback(data, note) {
  if (!isLiveCourse(note)) return null;
  return Object.values(data.liveTableRooms || {}).find(r => r.noteId === note.id)?.link || note.liveUrl || null;
}
function parseAnchors(html) {
  return [...new Set([...String(html).matchAll(/data-anchor="([^"<>]{1,40})"/g)].map(m=>m[1].trim()).filter(Boolean))];
}
async function cachePoster(item, settings, old) {
  if (!item.poster) return;
  if (old?.poster === item.poster && old.title === item.title && old.cover) {
    const name = old.cover.split('/').pop();
    if (/^live-[a-f0-9]+\.(jpg|png|webp)$/.test(name) && fs.existsSync(path.join(UPLOAD_DIR,name))) {
      item.cover=old.cover; item.coverRatio=old.coverRatio; return;
    }
  }
  const response = await fetchAuthenticatedResponse(item.poster,settings);
  const chunks=[]; let length=0;
  for await (const chunk of response.body) { length+=chunk.length; if(length>5*1024*1024) { await response.body.cancel?.().catch(()=>{}); throw new Error('课程海报超过5MB'); } chunks.push(chunk); }
  const bytes=normalizeImageBytes(Buffer.concat(chunks));
  const type=detectedImageType(bytes), dims=imageDimensions(bytes,type);
  const ext={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'}[type];
  if(!ext || !dims || dims.width<=0 || dims.height<=0 || dims.width*dims.height>40000000) throw new Error('课程海报格式无效');
  const name='live-'+crypto.createHash('sha256').update(bytes).digest('hex')+ext;
  fs.mkdirSync(UPLOAD_DIR,{recursive:true});
  if(!fs.existsSync(path.join(UPLOAD_DIR,name))) fs.writeFileSync(path.join(UPLOAD_DIR,name),bytes,{flag:'wx',mode:0o644});
  item.cover=String(process.env.PUBLIC_BASE_URL || 'https://app.nankaitechschool.com').replace(/\/$/,'')+'/uploads/'+name;
  item.coverRatio=dims.height/dims.width;
}
function dueSlot(now = Date.now()) {
  const date = new Date(now + 8 * 3600000);
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  if (minutes < 510 || minutes > 1260) return null;
  const slot = Math.floor(minutes / 30) * 30;
  return `${date.toISOString().slice(0,10)} ${String(Math.floor(slot / 60)).padStart(2,'0')}:${String(slot % 60).padStart(2,'0')}`;
}
async function syncNow(slotKey) {
  if (running) throw new Error('直播课表正在同步');
  running = true;
  try {
    if (slotKey) {
      db.get().liveTableSyncState = { ...db.get().liveTableSyncState, lastSlotKey: slotKey };
      await db.save();
    }
    const settings=config();
    const items = parseItems(await fetchAuthenticatedJson('/livetable/data', settings));
    const data = db.get();
    for(const item of items) await cachePoster(item,settings,data.liveTableRooms?.[item.room]);
    try { data.liveTableAnchors=parseAnchors(await(await fetchAuthenticatedResponse('/livetable',settings)).text()); }
    catch(e) { console.warn('[课程讲师标签]',e.message); }
    const result = applyItems(data, items);
    data.liveTableSyncState = { ...data.liveTableSyncState, status: 'success', error: '', lastAttemptAt: Date.now(), lastSuccessAt: Date.now(), result };
    await db.save(); return result;
  } catch (e) {
    const data = db.get();
    data.liveTableSyncState = { ...data.liveTableSyncState, status: 'failed', lastAttemptAt: Date.now(), error: e.message };
    await db.save(); throw e;
  } finally { running = false; }
}
function getStatus() {
  const c = config();
  return { enabled: c.enabled, configured: !!(c.baseUrl && c.username && c.password), running, intervalMinutes: 30, startTime: '08:30', endTime: '21:00', timezone: 'Asia/Shanghai', state: db.get().liveTableSyncState || null };
}
async function tick(now = Date.now()) {
  const slot = dueSlot(now);
  if (!config().enabled || running || !slot || db.get().liveTableSyncState?.lastSlotKey === slot) return;
  return syncNow(slot);
}
function start() {
  if (!config().enabled || timer) return;
  const check = () => tick().catch(e => console.error('[直播课表同步]', e.message));
  timer = setInterval(check, 30000); timer.unref?.(); check();
}
function stop() { clearInterval(timer); timer = null; }
module.exports = { parseItems, parseAnchors, applyItems, playback, dueSlot, tick, syncNow, getStatus, start, stop };
