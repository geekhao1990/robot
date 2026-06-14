// cloudfunctions/kbchat/retriever.js
// 轻量级检索：关键词命中 + 字符二元组重叠打分。
// 无需任何外部服务即可运行；后续可替换为 embedding 向量检索（见 README）。

const KB = require('./knowledge');

function score(question, doc) {
  const q = String(question || '').toLowerCase();
  let s = 0;
  // 关键词命中权重高
  (doc.keywords || []).forEach((kw) => {
    if (q.includes(String(kw).toLowerCase())) s += 3;
  });
  // 标题命中
  if (doc.title && q.includes(doc.title)) s += 2;
  // 字符二元组重叠（粗略的相似度）
  const text = (doc.title + doc.content).toLowerCase();
  for (let i = 0; i < q.length - 1; i++) {
    const bg = q.substr(i, 2);
    if (bg.trim().length === 2 && text.includes(bg)) s += 0.2;
  }
  return s;
}

function retrieve(question, k = 3) {
  return KB.map((doc) => ({ doc, s: score(question, doc) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.doc);
}

module.exports = { retrieve };
