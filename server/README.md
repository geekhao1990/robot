# 仿小红书 后端 API + 管理后台

独立的 Node(Express) 服务，给小程序提供真实接口，并自带一个网页版**管理后台**用于维护数据。
骨架阶段使用 JSON 文件作为数据库（`data/db.json`，首次启动自动用种子数据初始化），
可平滑替换为 MongoDB / MySQL。

## 运行

零依赖，无需 `npm install`，需 Node ≥ 14：

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

公开（小程序用）：
```
GET /api/feed?tab=&page=&size=
GET /api/notes/:id
GET /api/search?kw=
GET /api/users/:id
GET /api/users/:id/notes
GET /api/categories
GET /api/hotSearch
```

管理（需先 POST /api/admin/login 拿 token，请求头带 Authorization: Bearer <token>）：
```
GET/POST/PUT/DELETE   /api/admin/notes[/:id]
GET/POST/PUT/DELETE   /api/admin/users[/:id]
GET/PUT               /api/admin/categories
GET                   /api/admin/stats
```

## 让小程序连接真实后端

编辑小程序 `miniprogram/utils/config.js`：

```js
module.exports = { useRemote: true, baseUrl: 'http://localhost:3000' };
```

- 开发者工具：勾选「详情 → 本地设置 → 不校验合法域名」。
- 真机：需把后端部署到 HTTPS 域名，并在小程序后台「开发设置 → request 合法域名」中配置。
- `useRemote=false`（默认）时小程序仍用本地 mock；远程请求失败也会自动回退 mock，保证可跑。

## 升级数据库（生产）

把 `src/db.js` 换成真正的数据库驱动（如 mongoose / mysql2），保持
`get()/save()` 语义或在各 route 中改为异步查询即可，路由与管理后台无需改动。
