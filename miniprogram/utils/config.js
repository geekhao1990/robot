// utils/config.js
// 后端接口开关。useRemote=true 时小程序改调真实后端(server/)，否则用本地 mock。
// 开发者工具需勾选「不校验合法域名」；真机需在小程序后台配置 request 合法域名。
module.exports = {
  useRemote: false,
  baseUrl: 'http://localhost:3000',
};
