const GOLD_FINGER_ICON = 'https://app.nankaitechschool.com/uploads/up_1787930384458_5f0008fd90bf8d07.png';
const SILVER_FINGER_ICON = 'https://app.nankaitechschool.com/uploads/up_1787930384616_32050eca372a0969.png';

function decorateGoldRecord(record) {
  const yang = Math.max(0, Math.min(100, Number(record.yang) || 0));
  const yin = 100 - yang;
  return {
    ...record, yang, yin,
    fingerIcon: record.finger === 'silver' ? SILVER_FINGER_ICON : GOLD_FINGER_ICON,
    trendIcon: record.trend === 'down' ? '/images/trend-down.png' : '/images/trend-up.png',
    yangClass: yang > 50 ? 'strong' : '',
    yinClass: yin > 50 ? 'strong' : '',
  };
}

module.exports = { decorateGoldRecord };
