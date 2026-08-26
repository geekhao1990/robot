const CONTENT_TYPES = Object.freeze(['material', 'course', 'gold']);
const TYPE_LABELS = Object.freeze({
  material: '资料',
  course: '课程',
  gold: '金手指',
});

function normalizeType(value) {
  return CONTENT_TYPES.includes(value) ? value : 'material';
}

function typeLabel(value) {
  return TYPE_LABELS[normalizeType(value)];
}

function typeForCategory(category) {
  const entry = Object.entries(TYPE_LABELS).find(([, label]) => label === category);
  return entry ? entry[0] : 'material';
}

module.exports = { CONTENT_TYPES, TYPE_LABELS, normalizeType, typeLabel, typeForCategory };
