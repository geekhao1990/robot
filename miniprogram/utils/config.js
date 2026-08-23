// utils/config.js
// 后端接口开关。useRemote=true 时小程序改调真实后端(server/)。
// 开发者工具需勾选「不校验合法域名」；真机需在小程序后台配置 request 合法域名。
// 交互/发布/会员等数据均以后端为准；草稿仍只存本地。
const vipContact = 'finance-vip-001';

module.exports = {
  // 当前先使用本地 mock 数据；后端联调完成后改为 true。
  useRemote: false,
  // 尚未配置 AppID 时，登录仍连接本地后端完成注册并生成用户记录。
  previewAuthRemote: true,
  // 使用 wx.login 获取临时 code，由后端换取 openid 并签发登录 token。
  wechatAuthRemote: true,
  // 正式后端地址；需在微信公众平台配置为 request 合法域名。
  baseUrl: 'https://h5.nankaitechschool.com',
  // 开通会员的企业微信联系方式（展示用）
  vipContact,
  // 企业微信二维码图片（本地资源，真机/开发者工具均可显示）
  vipQr: '/images/vip-qr.jpg',
  // 本地预览兜底：红色加号打开的指定笔记。
  featuredNoteId: 'n3',
  // 后台不可用时的广告兜底状态；默认关闭，避免未配置广告位时阻塞领取。
  rewardedAdEnabled: false,
  // 微信公众平台创建的激励视频广告位 ID，上线前必须替换
  rewardedVideoAdUnitId: 'adunit-xxxxxxxxxxxxxxxx',
};
