function clean(value) {
  return String(value || '').trim();
}

function legacyProvider(url) {
  return /(?:^|\.)quark\.cn(?:\/|$)/i.test(url) || /pan\.quark\.cn/i.test(url)
    ? 'quark'
    : 'baidu';
}

function normalizeResourceLinks(source, type, useLegacy = true) {
  if (type === 'gold' || type === 'ad') return { baiduUrl: '', quarkUrl: '', courseUrl: '' };
  let baiduUrl = clean(source && source.baiduUrl);
  let quarkUrl = clean(source && source.quarkUrl);
  const legacyUrl = clean(source && source.courseUrl);
  if (useLegacy && !baiduUrl && !quarkUrl && legacyUrl) {
    if (legacyProvider(legacyUrl) === 'quark') quarkUrl = legacyUrl;
    else baiduUrl = legacyUrl;
  }
  return { baiduUrl, quarkUrl, courseUrl: baiduUrl || quarkUrl };
}

function resourceList(note) {
  const links = normalizeResourceLinks(note, note && note.type, true);
  const list = [];
  if (links.baiduUrl) list.push({ provider: 'baidu', name: '百度网盘', url: links.baiduUrl });
  if (links.quarkUrl) list.push({ provider: 'quark', name: '夸克网盘', url: links.quarkUrl });
  return list;
}

module.exports = { normalizeResourceLinks, resourceList };
