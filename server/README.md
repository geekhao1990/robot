# 仿小红书 后端 API + 管理后台

独立的 Node(Express) 服务，给小程序提供真实接口，并自带一个网页版**管理后台**用于维护数据。
骨架阶段使用 JSON 文件作为数据库（`data/db.json`，首次启动自动用种子数据初始化），
可平滑替换为 MongoDB / MySQL。

## 运行

零依赖，无需 `npm install`，需 Node ≥ 18：

1. 复制 `.env.example` 为 `.env`，填写微信小程序配置：

```env
WECHAT_APP_ID=你的小程序AppID
WECHAT_APP_SECRET=你的小程序AppSecret
```

2. 将项目根目录 `project.config.json` 的 `appid` 改为同一个 AppID。
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
- 📝 笔记管理：列表 + 新增 / 编辑 / 删除（标题、正文、作者、分类、类型、收费资料地址、图片、互动数据）
- 👤 用户管理：列表 + 新增 / 编辑 / 删除 + 一键 VIP
- 🏷️ 分类管理：维护分类枚举（指标 / 视频 / 金手指 …）

数据改动实时写入 `data/db.json`，小程序拉取的接口随之变化。

## 接口一览

公开读接口（小程序用）：
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
POST   /api/login                 微信登录 { code }，返回 { token, user }
GET    /api/me                    当前用户 + 赞/藏/关注 状态
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

> `WECHAT_APP_SECRET` 只能放在服务器 `.env`，不能写入小程序代码或提交到 Git。

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

小程序 `miniprogram/utils/config.js` 已默认 `useRemote: true`：

```js
module.exports = { useRemote: true, baseUrl: 'http://localhost:3000', vipContact: 'finance-vip-001' };
```

- **必须先启动本服务**，小程序的登录、点赞、收藏、关注、发布、会员状态都依赖它。
- 开发者工具：勾选「详情 → 本地设置 → 不校验合法域名」。
- 真机：需把后端部署到 HTTPS 域名，并在小程序后台「开发设置 → request 合法域名」中配置。
- 后端不可用时：读接口自动回退本地 mock，登录走离线降级；写操作会提示失败。
- 草稿箱仍只存本地。
- 发布图片会自动上传到后端 `public/uploads/`（生产建议改用对象存储 OSS/COS）。
- 消息（通知 + 私信）已后端化：每个用户首次访问时按模板懒初始化示例消息，
  已读状态、未读角标、发送私信均持久化到后端。

## 升级数据库（生产）

把 `src/db.js` 换成真正的数据库驱动（如 mongoose / mysql2），保持
`get()/save()` 语义或在各 route 中改为异步查询即可，路由与管理后台无需改动。
