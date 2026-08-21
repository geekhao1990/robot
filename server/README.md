# 仿小红书 后端 API + 管理后台

独立的 Node(Express) 服务，给小程序提供真实接口，并自带一个网页版**管理后台**用于维护数据。
骨架阶段使用 JSON 文件作为数据库（`data/db.json`，首次启动自动用种子数据初始化），
可平滑替换为 MongoDB / MySQL。

## 运行

零依赖，无需 `npm install`，需 Node ≥ 18：

1. 复制 `.env.example` 为 `.env`。本地开发者工具可直接使用预览登录；接入真实微信登录时再填写 AppID 和 AppSecret：

```env
NODE_ENV=development
DEV_PREVIEW_LOGIN=true
WECHAT_APP_ID=你的小程序AppID
WECHAT_APP_SECRET=你的小程序AppSecret
WECHAT_PAY_MCH_ID=微信支付商户号
WECHAT_PAY_CERT_SERIAL=商户API证书序列号
WECHAT_PAY_PRIVATE_KEY_PATH=./certs/apiclient_key.pem
WECHAT_PAY_API_V3_KEY=32字节APIv3密钥
WECHAT_PAY_NOTIFY_URL=https://你的域名/api/payments/notify
WECHAT_PAY_PLATFORM_SERIAL=微信支付平台公钥ID或平台证书序列号
WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH=./certs/wechatpay_public_key.pem
```

2. 接入真实微信登录时，将项目根目录 `project.config.json` 的 `appid` 改为同一个 AppID。
3. 启动服务：

```bash
cd server
npm start      # 或 node src/index.js
```

启动后：
- 管理后台： http://localhost:3000/admin  （账号 `admin` / 密码 `admin123`）
- 小程序接口： http://localhost:3000/api/...

## 管理后台功能（模仿小红书后台）

- 📊 数据概览：笔记/收费笔记/用户/VIP/分类 数量
- 📝 笔记管理：资料 / 课程 / 金手指固定分类；仅官方账号可作为作者；图片支持拖拽排序
- 👤 用户管理：新用户标签、会员编号搜索、官方账号标记、手动开通月卡 / 年卡 / 永久卡
- 💳 会员支付：月卡 10 元、年卡 99 元、永久卡 188 元；微信支付 V3 JSAPI 下单、查单、回调验签后自动开通
- 🏷️ 分类管理：查看资料 / 课程 / 金手指三个固定分类及内容数量

数据改动实时写入 `data/db.json`，小程序拉取的接口随之变化。

## 接口一览

登录后读接口（小程序用，请求头需带 Bearer token）：
```
GET /api/feed?tab=&page=&size=
GET /api/notes/:id
GET /api/search?kw=
GET /api/users/:id
GET /api/users/:id/notes
GET /api/categories
GET /api/hotSearch
```

小程序登录与写操作（需先 POST /api/login 拿 token，请求头带 Authorization: Bearer <token>）：
```
POST   /api/login                 微信登录 { code }；本地预览 { preview:true }
GET    /api/me                    当前用户 + 赞/藏/关注 状态
POST   /api/payments/orders       创建会员支付订单 { plan: month|year|lifetime }
GET    /api/payments/orders/:id   服务端向微信查单并返回支付状态
POST   /api/payments/notify       微信支付成功回调（HTTPS 公网地址）
POST   /api/like/:noteId          点赞切换
POST   /api/collect/:noteId       收藏切换
GET    /api/me/collects           我收藏的
GET    /api/me/likes              我赞过的
POST   /api/upload                图片上传(multipart, 字段 file)，返回 { url }
GET    /api/messages/summary      未读汇总 { like, comment, follow, conv, total }
GET    /api/notifications         通知列表(已填充 actor/笔记)
POST   /api/notifications/read    标记某类通知已读 { type }
GET    /api/conversations         会话列表
GET    /api/conversations/:id     单个会话(消息正序)
POST   /api/conversations/:id/read       标记会话已读
POST   /api/conversations/:id/messages   发送私信 { text }，返回 { added:[我,自动回复] }
```

> AppSecret、APIv3 密钥、商户私钥和平台公钥文件只能放在服务器环境中，不能写入小程序代码或提交到 Git。会员只会在微信支付查单或回调验签、金额校验通过后开通，不能依赖前端支付回调。

管理（需先 POST /api/admin/login 拿 token）：
```
GET/POST/PUT/DELETE   /api/admin/notes[/:id]
GET/POST/PUT/DELETE   /api/admin/users[/:id]
PUT                   /api/admin/users/:id/vip   开通会员 { plan: month|year|none }
GET/PUT               /api/admin/categories
GET                   /api/admin/stats
```

> 会员（VIP）只能由管理后台开通：在「用户管理」点击「开通月卡 / 年卡 / 取消VIP」。
> 小程序内 VIP 页仅做月卡/年卡对比展示，开通引导用户联系企业微信。

## 让小程序连接真实后端

小程序 `miniprogram/utils/config.js` 当前默认使用 mock 内容，但预览登录会连接本地后端完成用户注册。需要联调真实内容时把 `useRemote` 改为 `true`；获得 AppID/AppSecret 后再把 `wechatAuthRemote` 改为 `true`：

```js
module.exports = { useRemote: false, previewAuthRemote: true, wechatAuthRemote: false, baseUrl: 'http://127.0.0.1:3000' };
```

- **必须先启动本服务**，小程序的登录、点赞、收藏、关注、发布、会员状态都依赖它。
- 开发者工具：勾选「详情 → 本地设置 → 不校验合法域名」。
- 真机：需把后端部署到 HTTPS 域名，并在小程序后台「开发设置 → request 合法域名」中配置。
- 搜索、列表、详情、点赞和收藏均直接读写后端；后端不可用时会明确提示失败，不再回退 mock 内容。
- 草稿箱仍只存本地。
- 发布图片会自动上传到后端 `public/uploads/`（生产建议改用对象存储 OSS/COS）。
- 消息（通知 + 私信）已后端化：每个用户首次访问时按模板懒初始化示例消息，
  已读状态、未读角标、发送私信均持久化到后端。

## 升级数据库（生产）

把 `src/db.js` 换成真正的数据库驱动（如 mongoose / mysql2），保持
`get()/save()` 语义或在各 route 中改为异步查询即可，路由与管理后台无需改动。
