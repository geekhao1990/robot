// utils/config.js
// 后端接口开关。useRemote=true 时小程序改调真实后端(server/)。
// 开发者工具需勾选「不校验合法域名」；真机需在小程序后台配置 request 合法域名。
// 交互/发布/会员等数据均以后端为准；草稿仍存本地。
const vipContact = 'finance-vip-001';

module.exports = {
  useRemote: true,
  baseUrl: 'http://localhost:3000',
  // 开通会员的企业微信联系方式（展示用）
  vipContact,
  // 企业微信二维码图片（本地资源，真机/开发者工具均可显示）
  vipQr: '/images/vip-qr.jpg',
};
