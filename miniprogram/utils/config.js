// utils/config.js
// 后端接口开关。useRemote=true 时小程序改调真实后端(server/)。
// 开发者工具需勾选「不校验合法域名」；真机需在小程序后台配置 request 合法域名。
// 交互/发布/会员等数据均以后端为准；草稿仍存本地。
const vipContact = 'finance-vip-001';

module.exports = {
  // 暂时使用本地数据：不发起 wx.request，不受微信合法域名校验影响。
  useRemote: false,
  // 配置真实 AppID/AppSecret 与 HTTPS 后端后改为 true。
  wechatAuthRemote: false,
  // 微信开发者工具本地调试地址。显式使用 IPv4，避免 localhost 被解析为 ::1。
  baseUrl: 'http://127.0.0.1:3000',
  // 开通会员的企业微信联系方式（展示用）
  vipContact,
  // 企业微信二维码图片（本地资源，真机/开发者工具均可显示）
  vipQr: '/images/vip-qr.jpg',
  // 本地预览兜底：红色加号打开的指定笔记。
  featuredNoteId: 'n13',
  // 后台不可用时的广告兜底状态；默认关闭，避免未配置广告位时阻塞领取。
  rewardedAdEnabled: false,
  // 微信公众平台创建的激励视频广告位 ID，上线前必须替换
  rewardedVideoAdUnitId: 'adunit-xxxxxxxxxxxxxxxx',
};
