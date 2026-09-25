# 玄剑公会官网 API 参考

> 本文件由 `scripts/gen-api-docs.js` 从 `server.js` 与 `routes/*.js` 自动生成，
> 请勿手工编辑：改完接口后在仓库根目录执行 `node scripts/gen-api-docs.js` 重新生成。
>
> 生成时间：2026-09-25 08:20:20 UTC ｜ 共 36 个模块、268 个端点

## 通用约定

| 项 | 说明 |
|---|---|
| Base URL | `https://xuanjian.top`（本地开发为 `http://127.0.0.1:3000`） |
| 请求/响应格式 | JSON（`Content-Type: application/json`）；文件上传用 `multipart/form-data` |
| 时间格式 | 字符串 `YYYY-MM-DD HH:MM:SS`，**UTC+8 本地时间**（服务端 `getLocalTimestamp()`） |
| 错误格式 | `{ "error": "中文原因" }`；HTTP 400 参数错误 / 401 未认证 / 403 无权限 / 404 不存在 / 429 触发限流 / 500 服务端异常 |
| 限流 | 全站 `/api/` 前缀有 express-rate-limit；登录、验证码等接口另有更严格的独立限流 |
| 鉴权-JWT | 请求头 `Authorization: Bearer <token>`（登录接口返回），用于官网前端 |
| 鉴权-Server-Key | 请求头 `X-Server-Key: <key>`，取自后台「服务器密钥」（`mod_servers.server_key`），用于模组/插件等服务端调用 |
| 鉴权-玩家级 | 模组接口在 Server-Key 之外还要求 `uuid`（query/body/header `X-Player-Uuid`）且该角色已绑定官网账号 |

## 模块索引

| 挂载路径 | 路由文件 | 端点数 | 备注 |
|---|---|---|---|
| `/api/admin` | `routes/admin.js` | 13 | — |
| `/api/announcements` | `routes/announcement.js` | 2 | — |
| `/api/auth` | `routes/auth.js` | 13 | — |
| `/api/banners` | `routes/banners.js` | 5 | — |
| `/api/chat` | `routes/chat.js` | 23 | — |
| `/api/checkin` | `routes/checkin.js` | 8 | — |
| `/api/claims` | `routes/claims.js` | 4 | — |
| `/api/contributions` | `routes/contributions.js` | 5 | — |
| `/api/discipline` | `routes/discipline.js` | 5 | — |
| `/api/donation` | `routes/donation.js` | 10 | — |
| `/api/economics` | `routes/economics.js` | 2 | — |
| `/api/favorites` | `routes/favorites.js` | 7 | — |
| `/api/generations` | `routes/generations.js` | 6 | — |
| `/api/gmirs` | `routes/gmirs.js` | 5 | — |
| `/launcher` | `routes/launcher.js` | 1 | — |
| `/api/mod` | `routes/mod.js` | 25 | — |
| `/api/notifications` | `routes/notifications.js` | 4 | — |
| `/api/oauth` | `routes/oauth.js` | 5 | — |
| `/api/password` | `routes/password.js` | 3 | — |
| `/api/pay-confirm` | `routes/pay-confirm.js` | 5 | — |
| `/api/pay` | `routes/pay.js` | 6 | — |
| `/api/paygate` | `routes/paygate.js` | 9 | — |
| `/api/player-tasks` | `routes/player-tasks.js` | 6 | — |
| `/api/posts` | `routes/posts.js` | 9 | — |
| `/api/projections` | `routes/projections.js` | 5 | — |
| `/api/push` | `routes/push.js` | 4 | — |
| `/api/qqbot` | `routes/qqbot.js` | 7 | — |
| `/api/rankings` | `routes/rankings.js` | 6 | — |
| `/api/shop` | `routes/shop.js` | 13 | — |
| `/api/skins` | `routes/skins.js` | 3 | — |
| `/api/stock` | `routes/stock.js` | 14 | （未挂载） |
| `/api/tasks` | `routes/tasks.js` | 9 | — |
| `/api/team` | `routes/team.js` | 10 | — |
| `/api/titles` | `routes/titles.js` | 8 | — |
| `/api/updates` | `routes/updates.js` | 4 | — |
| `/api/upload` | `routes/upload.js` | 4 | — |

## /api/admin

文件：`routes/admin.js`（13 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/admin/announcements` | 管理员（需 JWT） | 获取公告列表 |
| `POST` | `/api/admin/announcements` | 管理员（需 JWT） | 创建公告 |
| `DELETE` | `/api/admin/announcements/:id` | 管理员（需 JWT） | 删除公告 |
| `PUT` | `/api/admin/announcements/:id` | 管理员（需 JWT） | 更新公告 |
| `GET` | `/api/admin/dashboard` | 管理员（需 JWT） | 数据可视化看板（v2.2.0） |
| `GET` | `/api/admin/posts` | 管理员（需 JWT） | 获取所有内容（管理员） |
| `PUT` | `/api/admin/posts/:id/pin` | 管理员（需 JWT） | 置顶/取消置顶内容 |
| `GET` | `/api/admin/statistics` | 管理员（需 JWT） | 获取统计数据 |
| `GET` | `/api/admin/theme` | 公开 | 获取主题设置 |
| `PUT` | `/api/admin/theme` | 管理员（需 JWT） | 设置主题（管理员） |
| `GET` | `/api/admin/users` | 管理员（需 JWT） | 获取所有用户（管理员） |
| `PUT` | `/api/admin/users/:id` | 管理员（需 JWT） | 更新用户信息（管理员） |
| `PUT` | `/api/admin/users/:id/level` | 超级管理员（需 JWT） | 设置用户等级（超级管理员） |

## /api/announcements

文件：`routes/announcement.js`（2 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/announcements/` | 公开 | 获取所有活跃公告 |
| `GET` | `/api/announcements/popup` | 公开 | 获取当前弹窗公告 |

## /api/auth

文件：`routes/auth.js`（13 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `POST` | `/api/auth/login` | 公开 | 用户登录 |
| `GET` | `/api/auth/me` | JWT 登录 | 获取当前用户信息 |
| `PUT` | `/api/auth/password` | JWT 登录 | 修改密码 |
| `PUT` | `/api/auth/profile` | JWT 登录 | 更新用户信息（昵称/头像/封面） |
| `GET` | `/api/auth/qq/bind` | 公开 | QQ绑定：已登录用户绑定QQ（跳转到心月互联授权页） / 支持 Authorization header 或 ?token= 查询参数（浏览器直接跳转场景） |
| `GET` | `/api/auth/qq/callback` | 公开 | QQ登录回调：换取用户信息并登录/注册 |
| `GET` | `/api/auth/qq/login` | 公开 | QQ登录：跳转到心月互联授权页 |
| `POST` | `/api/auth/register` | 公开 | 用户注册（已关闭：新用户必须通过QQ登录注册） |
| `POST` | `/api/auth/send-bind-code` | JWT 登录 | 发送邮箱绑定验证码 |
| `POST` | `/api/auth/send-code` | 公开 | 发送验证码 |
| `GET` | `/api/auth/user/:username` | 公开 | 通过用户名获取用户信息（公开接口） |
| `PUT` | `/api/auth/username` | JWT 登录 | 修改自定义ID（用户名） |
| `POST` | `/api/auth/verify-email` | JWT 登录 | 绑定/验证邮箱 |

## /api/banners

文件：`routes/banners.js`（5 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/banners/` | 公开 | 获取启用的轮播图（公开） |
| `POST` | `/api/banners/` | 管理员（需 JWT） | 创建轮播图（管理员） |
| `DELETE` | `/api/banners/:id` | 管理员（需 JWT） | 删除轮播图（管理员） |
| `PUT` | `/api/banners/:id` | 管理员（需 JWT） | 更新轮播图（管理员） |
| `GET` | `/api/banners/all` | 管理员（需 JWT） | 获取全部轮播图（管理员） |

## /api/chat

文件：`routes/chat.js`（23 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/chat/admin/bubbles` | 管理员（需 JWT） | ============ 管理端：气泡管理 ============ |
| `POST` | `/api/chat/admin/bubbles` | 管理员（需 JWT） | — |
| `DELETE` | `/api/chat/admin/bubbles/:id` | 管理员（需 JWT） | — |
| `PUT` | `/api/chat/admin/bubbles/:id` | 管理员（需 JWT） | — |
| `DELETE` | `/api/chat/admin/messages/:id` | 管理员（需 JWT） | 管理端：公屏消息删除（治理用） |
| `GET` | `/api/chat/admin/stickers` | 管理员（需 JWT） | 公共表情包管理列表 / 删除（管理员） |
| `POST` | `/api/chat/admin/stickers` | 管理员（需 JWT） | 全站公共表情包上传（管理员） |
| `DELETE` | `/api/chat/admin/stickers/:id` | 管理员（需 JWT） | — |
| `GET` | `/api/chat/bubbles` | JWT 登录 | 气泡列表（标记是否已拥有） |
| `POST` | `/api/chat/bubbles/:id/buy` | JWT 登录 | 购买气泡 |
| `GET` | `/api/chat/bubbles/mine` | JWT 登录 | 已拥有的气泡 |
| `GET` | `/api/chat/dm/:id/messages` | JWT 登录 | 与某用户的私聊历史（走 REST，供独立私聊页使用） |
| `POST` | `/api/chat/dm/:id/read` | JWT 登录 | 标记与某用户的私聊为已读（WS 不可用时的兜底；会实时通知对方） |
| `GET` | `/api/chat/dm/conversations` | JWT 登录 | 我的会话列表 |
| `GET` | `/api/chat/dm/unread` | JWT 登录 | 我的私聊未读总数（供导航角标） |
| `GET` | `/api/chat/history/dm/:id` | JWT 登录 | 私聊历史 |
| `GET` | `/api/chat/history/public` | JWT 登录 | 公屏历史 |
| `GET` | `/api/chat/mentions` | JWT 登录 | @提及用户搜索（公屏 @ 选择器用） |
| `GET` | `/api/chat/online` | JWT 登录 | 在线人数 |
| `POST` | `/api/chat/stickers` | JWT 登录 | 上传表情包（压缩后存七牛） |
| `DELETE` | `/api/chat/stickers/:id` | JWT 登录 | 删除我的表情包（同时回收对象存储文件） |
| `GET` | `/api/chat/stickers/mine` | JWT 登录 | 我的表情包 + 全站公共表情包 |
| `POST` | `/api/chat/upload` | JWT 登录 | 上传聊天图片/语音（kind=voice 时走语音） |

## /api/checkin

文件：`routes/checkin.js`（8 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `POST` | `/api/checkin/buy-makeup-card` | JWT 登录 | — |
| `POST` | `/api/checkin/checkin` | JWT 登录 | — |
| `GET` | `/api/checkin/history` | JWT 登录 | — |
| `GET` | `/api/checkin/leaderboard` | 公开 | — |
| `POST` | `/api/checkin/makeup` | JWT 登录 | — |
| `GET` | `/api/checkin/rewards` | 公开 | — |
| `POST` | `/api/checkin/rewards` | 管理员（需 JWT） | — |
| `GET` | `/api/checkin/status` | JWT 登录 | — |

## /api/claims

文件：`routes/claims.js`（4 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/claims/` | JWT 登录 | — |
| `POST` | `/api/claims/` | JWT 登录 | — |
| `GET` | `/api/claims/:id` | JWT 登录 | — |
| `PUT` | `/api/claims/:id/review` | 管理员（需 JWT） | — |

## /api/contributions

文件：`routes/contributions.js`（5 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `PUT` | `/api/contributions/admin/:userId` | 超级管理员（需 JWT） | 管理端：手动调整用户贡献点（正负均可，记 admin 流水） |
| `GET` | `/api/contributions/all-logs` | 管理员（需 JWT） | 管理端：全部贡献点流水（可筛选用户/类型） |
| `GET` | `/api/contributions/all-transfers` | 管理员（需 JWT） | 管理端：全部转账记录 |
| `GET` | `/api/contributions/logs` | JWT 登录 | 我的贡献点流水 |
| `POST` | `/api/contributions/transfer` | JWT 登录 | 贡献点互转 |

## /api/discipline

文件：`routes/discipline.js`（5 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `POST` | `/api/discipline/` | 管理员（需 JWT） | ===== 管理员：新增处分 ===== |
| `POST` | `/api/discipline/:id/revoke` | 管理员（需 JWT） | ===== 管理员：撤销/解除处分 ===== |
| `GET` | `/api/discipline/list` | 管理员（需 JWT） | ===== 管理员：处分列表（可筛选） ===== |
| `GET` | `/api/discipline/query` | 公开 | ===== 面向用户：按用户名/昵称模糊查询处分记录（GDARS 前端，公开接口） ===== |
| `GET` | `/api/discipline/user/:userId` | 公开 | ===== 单个用户的处分记录（GMIRS 档案用，公开） ===== |

## /api/donation

文件：`routes/donation.js`（10 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `POST` | `/api/donation/admin/entry` | 管理员（需 JWT） | 新增账目 |
| `DELETE` | `/api/donation/admin/entry/:id` | 管理员（需 JWT） | 删除账目 |
| `PUT` | `/api/donation/admin/entry/:id` | 管理员（需 JWT） | 编辑账目 |
| `POST` | `/api/donation/admin/materials` | 管理员（需 JWT） | 上传材料 |
| `POST` | `/api/donation/admin/qr` | 管理员（需 JWT） | 上传/替换收款码 |
| `GET` | `/api/donation/admin/search-users` | 管理员（需 JWT） | 搜索成员（选捐赠人用） |
| `GET` | `/api/donation/donors` | 公开 | 捐赠者卡片 |
| `GET` | `/api/donation/export/xlsx` | 管理员（需 JWT） | ============ 导出 Excel ============ |
| `GET` | `/api/donation/ledger` | 登录可选 | 出入账明细 |
| `GET` | `/api/donation/summary` | 公开 | 公账汇总 + 收款码 |

## /api/economics

文件：`routes/economics.js`（2 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/economics/export` | 公开 | 导出 xlsx：贡献点总览表 + 账户余额公示（支持自选时间段，缺省本周） |
| `GET` | `/api/economics/overview` | 公开 | 经济观测总览 |

## /api/favorites

文件：`routes/favorites.js`（7 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/favorites/feed` | JWT 登录 | 关注动态流：我关注的人发布的帖子 |
| `GET` | `/api/favorites/posts` | JWT 登录 | 我的收藏列表（含帖子信息） |
| `POST` | `/api/favorites/posts/:postId` | JWT 登录 | 收藏 / 取消收藏（toggle） |
| `GET` | `/api/favorites/posts/:postId/check` | JWT 登录 | 检查是否已收藏（帖子详情页用） |
| `GET` | `/api/favorites/users` | JWT 登录 | 我关注的人 |
| `POST` | `/api/favorites/users/:userId` | JWT 登录 | 关注 / 取关（toggle） |
| `GET` | `/api/favorites/users/:userId/status` | JWT 登录 | 查看某用户：我是否关注 + 粉丝/关注数（个人主页用） |

## /api/generations

文件：`routes/generations.js`（6 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/generations/` | 公开 | 获取所有代系配置（公开） |
| `POST` | `/api/generations/` | 管理员（需 JWT） | 管理员：新增代系 |
| `DELETE` | `/api/generations/:id` | 管理员（需 JWT） | 管理员：删除代系 |
| `PUT` | `/api/generations/:id` | 管理员（需 JWT） | 管理员：修改代系 |
| `GET` | `/api/generations/user/:userId` | 公开 | 获取某用户代系（公开，用于档案/主页展示） |
| `PUT` | `/api/generations/user/:userId` | 管理员（需 JWT） | 管理员：手动设置某用户代系（传 null/空 则清空恢复自动判定） |

## /api/gmirs

文件：`routes/gmirs.js`（5 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/gmirs/export` | 公开 | ===== 一键导出所有成员档案（供前端批量生成 PDF/docx） ===== |
| `GET` | `/api/gmirs/proxy-image` | 公开 | ===== 图片代理：将 CDN 头像转同源，绕过浏览器 CORS 限制（仅允许七牛 CDN） ===== |
| `GET` | `/api/gmirs/query` | 公开 | ===== 模糊查询成员（返回结果列表，供前端展示） ===== |
| `GET` | `/api/gmirs/user/:id` | 公开 | ===== 单成员档案（贡献点明细分组 + 处分记录 + 防伪验证码） ===== |
| `GET` | `/api/gmirs/verify` | 公开 | ===== 验证码查伪：校验某档案上的验证码是否真实有效 ===== |

## /launcher

文件：`routes/launcher.js`（1 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/launcher/home.xaml` | 公开 | — |

## /api/mod

文件：`routes/mod.js`（25 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/mod/active-count` | JWT 登录 | 活跃总人数统计（官网看板用） |
| `GET` | `/api/mod/admin/claims` | 公开 | 新申报轮询（功能10：管理员提醒） / 两种调用通道： /  - 服务器模组：带 X-Server-Key，返回 claims + adminUuids（全部管理员已绑定的游戏角色） /  - 客户端模组（管理员玩家）：带 uuid，非管理员返回 403 |
| `GET` | `/api/mod/balance` | X-Server-Key（可选）+ uuid 已绑定 | 余额查询 |
| `GET` | `/api/mod/bind/confirm` | 公开 | 邮件确认链接（浏览器访问） |
| `POST` | `/api/mod/bind/request` | 公开 | 发起绑定：向官网账号邮箱发送确认邮件（公开：需邮箱确认后才生效） |
| `GET` | `/api/mod/bind/status` | 公开 | 查询绑定状态（公开：仅按 uuid 返回其绑定状态） |
| `POST` | `/api/mod/checkin` | X-Server-Key（可选）+ uuid 已绑定 | 签到（模组登录后自动调用，玩家级：uuid 须已绑定） |
| `GET` | `/api/mod/checkin/status` | X-Server-Key（可选）+ uuid 已绑定 | 签到状态（今日是否已签） |
| `POST` | `/api/mod/claims` | X-Server-Key（可选）+ uuid 已绑定 | 提交申报 |
| `POST` | `/api/mod/heartbeat` | 公开 | 活跃心跳上报（玩家级：仅记录已绑定官网账号的活跃 uuid，防伪造） |
| `GET` | `/api/mod/online` | 公开 | 查询在线玩家（仅返回已绑定官网账号的玄剑玩家，且记录在 TTL 内未过期） / serverIp 可选：带则查指定服务器，不带则查全网各服务器 |
| `POST` | `/api/mod/online/join` | X-Server-Key（可选）+ uuid 已绑定 | 客户端上线上报（玩家级：uuid 须已绑定；server 须匹配管理后台配置的白名单 server_ip） |
| `POST` | `/api/mod/online/leave` | X-Server-Key（可选）+ uuid 已绑定 | 客户端下线上报 |
| `POST` | `/api/mod/online/report` | 公开 | 服务端「整表上报」在线名单（mod 心跳定时调用）。 / 与玩家级 join/leave 的区别：这是**快照语义** —— 一次上报即代表该服务器当前的完整在线名单， / 因此先清空该服务器的在线记录再按 players 重建，避免玩家异常退出（没发 leave）导致幽灵在线。 / 需要 serverIp 命中管理后台的白名单（与 join/leave 同一套 matchWhiteList）。 / body: { serverIp: "1.2.3.4", players: [{ uuid, name }] } |
| `GET` | `/api/mod/profile` | X-Server-Key（可选）+ uuid 已绑定 | 模组 GUI 聚合档案（一次拿全，避免模组发多个请求） / 返回内容全部是该玩家自己的数据或站内本就公开的信息： / 昵称/头像/贡献点/等级/排名/称号/代系/今日签到/连续天数/未读通知/待审申报/任务统计/在线人数 |
| `GET` | `/api/mod/servers` | 管理员（需 JWT） | 服务器列表 |
| `POST` | `/api/mod/servers` | 管理员（需 JWT） | 新增服务器 |
| `DELETE` | `/api/mod/servers/:id` | 管理员（需 JWT） | 删除服务器 |
| `PUT` | `/api/mod/servers/:id` | 管理员（需 JWT） | 更新服务器（名称/IP） |
| `GET` | `/api/mod/tasks` | X-Server-Key（可选）+ uuid 已绑定 | 任务列表 |
| `POST` | `/api/mod/tasks/:id/claim` | X-Server-Key（可选）+ uuid 已绑定 | 接取任务 |
| `POST` | `/api/mod/tasks/:id/complete` | X-Server-Key（可选）+ uuid 已绑定 | 提交验证码完成任务 |
| `GET` | `/api/mod/tasks/my` | X-Server-Key（可选）+ uuid 已绑定 | 我的任务 |
| `POST` | `/api/mod/transfer` | X-Server-Key（可选）+ uuid 已绑定 | 转账（玩家级：fromUuid 须已绑定） |
| `GET` | `/api/mod/updates` | 公开 | 增量拉取日报/决策（公开：官网帖子本就公开） |

## /api/notifications

文件：`routes/notifications.js`（4 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/notifications/` | JWT 登录 | 获取用户通知列表 |
| `DELETE` | `/api/notifications/:id` | JWT 登录 | 删除通知 |
| `PUT` | `/api/notifications/:id/read` | JWT 登录 | 标记通知为已读 |
| `PUT` | `/api/notifications/read-all` | JWT 登录 | 标记所有通知为已读 |

## /api/oauth

文件：`routes/oauth.js`（5 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/oauth/authorize` | 公开 | OAuth 授权页面 / GET /api/oauth/authorize / 参数：client_id, redirect_uri, response_type=code, state |
| `POST` | `/api/oauth/authorize` | 公开 | 同意授权，生成授权码 / POST /api/oauth/authorize |
| `POST` | `/api/oauth/token` | 公开 | 使用授权码换取访问令牌 / POST /api/oauth/token / 参数：code, client_id, client_secret, redirect_uri, grant_type=authorization_code |
| `GET` | `/api/oauth/userinfo` | 公开 | 获取用户详细信息 / GET /api/oauth/userinfo |
| `GET` | `/api/oauth/verify` | 公开 | 验证访问令牌 / GET /api/oauth/verify |

## /api/password

文件：`routes/password.js`（3 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `POST` | `/api/password/forgot-password` | 公开 | — |
| `POST` | `/api/password/reset-password` | 公开 | — |
| `GET` | `/api/password/verify-reset-token/:token` | 公开 | — |

## /api/pay-confirm

文件：`routes/pay-confirm.js`（5 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/pay-confirm/:token` | 公开 | 查询订单（公开，凭 token） |
| `POST` | `/api/pay-confirm/:token/confirm` | 登录可选 | 用户确认支付（公开，凭 token；公共单需登录后绑定当前用户） |
| `POST` | `/api/pay-confirm/admin/link` | 管理员（需 JWT） | 后台：生成缴费链接（管理员） |
| `GET` | `/api/pay-confirm/admin/orders` | 管理员（需 JWT） | 后台：缴费单列表 |
| `GET` | `/api/pay-confirm/admin/sites` | 管理员（需 JWT） | 后台：可选扣款主体列表（含「本站」虚拟项） |

## /api/pay

文件：`routes/pay.js`（6 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/pay/admin/settings` | 管理员（需 JWT） | — |
| `PUT` | `/api/pay/admin/settings` | 管理员（需 JWT） | — |
| `GET` | `/api/pay/intents/:token` | JWT 登录 | 扫码后读取付款信息（主扫第二步） / 不暴露付款方隐私；付款人需登录（决策：必须本人登录确认） |
| `POST` | `/api/pay/intents/:token/confirm` | JWT 登录 | 付款人本人确认支付（主扫第三步） / body: { amount?: number, note?: string }  —— 收款码未定金额时由付款方填写 |
| `POST` | `/api/pay/receive-code` | JWT 登录 | 生成我的收款码（主扫第一步：收款方出示，付款方扫码） / body: { amount?: number, note?: string } |
| `GET` | `/api/pay/records` | JWT 登录 | — |

## /api/paygate

文件：`routes/paygate.js`（9 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/paygate/admin/logs` | 管理员（需 JWT） | 兑换关键日志（审计，pay_logs） |
| `GET` | `/api/paygate/admin/orders` | 管理员（需 JWT） | 订单列表（管理端，支持状态筛选） |
| `POST` | `/api/paygate/order/create` | 公开 | 外站发起兑换单（站点验签 + 幂等） |
| `POST` | `/api/paygate/order/execute` | 公开 | 外站确认执行（默认自动执行刚创建的单，可带 order_no） / 处理成功扣除/入账并异步回往外站 |
| `GET` | `/api/paygate/order/query` | 公开 | 外站查询订单状态 |
| `GET` | `/api/paygate/sites` | 管理员（需 JWT） | 站点列表 |
| `POST` | `/api/paygate/sites` | 管理员（需 JWT） | 新增站点（生成 api_key 与 secret） |
| `DELETE` | `/api/paygate/sites/:id` | 管理员（需 JWT） | 删除站点 |
| `PUT` | `/api/paygate/sites/:id` | 管理员（需 JWT） | 编辑站点 |

## /api/player-tasks

文件：`routes/player-tasks.js`（6 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/player-tasks/` | JWT 登录 | 任务列表（公开任务不含验证码；作者/管理员可见自己任务的 code） |
| `POST` | `/api/player-tasks/` | JWT 登录 | 发布玩家任务：校验贡献点足够 → 生成验证码 → 扣除贡献点 → 创建任务 |
| `POST` | `/api/player-tasks/:id/accept` | JWT 登录 | 接取任务（作者不可接取自己的任务；多人可接取，受 max_people 限制） |
| `POST` | `/api/player-tasks/:id/cancel` | JWT 登录 | 取消任务（发布者可取消待接取或进行中任务，退回贡献点） |
| `POST` | `/api/player-tasks/:id/complete` | JWT 登录 | 完成核实：接取者提交发布者提供的验证码 → 贡献点转账到账 |
| `GET` | `/api/player-tasks/mine` | JWT 登录 | 我的玩家任务：我发布的 + 我接取的（含 code、操作入口） |

## /api/posts

文件：`routes/posts.js`（9 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/posts/` | 公开 | — |
| `POST` | `/api/posts/` | JWT 登录 | — |
| `DELETE` | `/api/posts/:id` | JWT 登录 | — |
| `GET` | `/api/posts/:id` | 公开 | — |
| `PUT` | `/api/posts/:id` | JWT 登录 | — |
| `POST` | `/api/posts/:id/comments` | JWT 登录 | — |
| `POST` | `/api/posts/:id/like` | JWT 登录 | — |
| `DELETE` | `/api/posts/:postId/comments/:commentId` | JWT 登录 | — |
| `GET` | `/api/posts/public-stats` | 公开 | — |

## /api/projections

文件：`routes/projections.js`（5 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/projections/` | 公开 | 投影列表（公开：标题/标签搜索，含作者信息与下载量） |
| `POST` | `/api/projections/` | JWT 登录 | 发布投影（需登录） |
| `DELETE` | `/api/projections/:id` | JWT 登录 | 删除投影（作者或管理员） |
| `GET` | `/api/projections/:id` | 公开 | 投影详情 |
| `POST` | `/api/projections/:id/download` | 公开 | 下载计数（公开，返回文件直链） |

## /api/push

文件：`routes/push.js`（4 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/push/status` | JWT 登录 | 查询当前用户订阅状态 |
| `POST` | `/api/push/subscribe` | JWT 登录 | 保存订阅 |
| `POST` | `/api/push/unsubscribe` | JWT 登录 | 取消订阅 |
| `GET` | `/api/push/vapid-public-key` | 公开 | VAPID 公钥 |

## /api/qqbot

文件：`routes/qqbot.js`（7 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `POST` | `/api/qqbot/bind` | 公开 | ===== 机器人：发起绑定（生成一次性码） ===== |
| `POST` | `/api/qqbot/confirm` | JWT 登录 | ===== 用户：确认绑定（登录态，输入一次性码） ===== |
| `POST` | `/api/qqbot/confirm-code` | 公开 | ===== 机器人：核销确认（管理员私聊操作，bot token） ===== |
| `GET` | `/api/qqbot/me` | JWT 登录 | ===== 用户：查询当前账号绑定状态（登录态） ===== |
| `POST` | `/api/qqbot/task-complete` | 公开 | ===== 机器人：玩家任务完成验证码（接取者私聊提交，bot token） ===== |
| `GET` | `/api/qqbot/user` | 公开 | ===== 机器人：按 QQ 查绑定用户（供 #查自己） ===== |
| `POST` | `/api/qqbot/verify-code` | 公开 | ===== 机器人：核销码验证（群内普通成员可查，bot token） ===== |

## /api/rankings

文件：`routes/rankings.js`（6 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/rankings/checkin` | 公开 | — |
| `GET` | `/api/rankings/contribution` | 公开 | — |
| `GET` | `/api/rankings/online-time` | 公开 | 上线时长排行榜（模组采集的在线时长累计，online_time 表） |
| `GET` | `/api/rankings/posts-likes` | 公开 | — |
| `GET` | `/api/rankings/posts-views` | 公开 | — |
| `GET` | `/api/rankings/stock` | 公开 | — |

## /api/shop

文件：`routes/shop.js`（13 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/shop/admin/items` | 管理员（需 JWT） | 管理端：获取全部商品（含停用） |
| `GET` | `/api/shop/admin/sales` | 管理员（需 JWT） | 商品营业额统计（管理端）：总营业额 + 近7天每日 + 按商品聚合 |
| `POST` | `/api/shop/confirm` | 管理员（需 JWT） | — |
| `GET` | `/api/shop/items` | 公开 | — |
| `POST` | `/api/shop/items` | 管理员（需 JWT） | — |
| `DELETE` | `/api/shop/items/:id` | 管理员（需 JWT） | — |
| `GET` | `/api/shop/items/:id` | 公开 | — |
| `PUT` | `/api/shop/items/:id` | 管理员（需 JWT） | — |
| `POST` | `/api/shop/items/:id/buy` | JWT 登录 | — |
| `GET` | `/api/shop/my-items` | JWT 登录 | — |
| `GET` | `/api/shop/my-permissions` | JWT 登录 | 我的有效权限（兑换的仓库/机器使用权限） |
| `GET` | `/api/shop/my-titles` | JWT 登录 | — |
| `POST` | `/api/shop/verify` | 管理员（需 JWT） | — |

## /api/skins

文件：`routes/skins.js`（3 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `DELETE` | `/api/skins/` | JWT 登录 | 移除自己的皮肤（清空 skin_path 并删除文件） |
| `POST` | `/api/skins/` | JWT 登录 | 上传自己的皮肤 |
| `GET` | `/api/skins/random` | 公开 | 随机皮肤池：返回一个随机用户的皮肤及其名字（游戏ID 留空时用用户名） |

## /api/stock （未挂载）

文件：`routes/stock.js`（14 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/stock/portfolio` | JWT 登录 | — |
| `GET` | `/api/stock/stocks` | 公开 | — |
| `POST` | `/api/stock/stocks` | 管理员（需 JWT） | — |
| `DELETE` | `/api/stock/stocks/:id` | 管理员（需 JWT） | — |
| `GET` | `/api/stock/stocks/:id` | 公开 | — |
| `PUT` | `/api/stock/stocks/:id` | 管理员（需 JWT） | — |
| `POST` | `/api/stock/stocks/:id/buy` | JWT 登录 | — |
| `GET` | `/api/stock/stocks/:id/history` | 公开 | — |
| `GET` | `/api/stock/stocks/:id/kline` | 公开 | 获取K线数据（OHLC） |
| `POST` | `/api/stock/stocks/:id/restore` | 管理员（需 JWT） | — |
| `POST` | `/api/stock/stocks/:id/sell` | JWT 登录 | — |
| `GET` | `/api/stock/stocks/all` | 管理员（需 JWT） | — |
| `GET` | `/api/stock/transactions` | JWT 登录 | — |
| `POST` | `/api/stock/trigger-update` | 管理员（需 JWT） | — |

## /api/tasks

文件：`routes/tasks.js`（9 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/tasks/` | JWT 登录 | 任务列表（普通用户看不到 code；1/2 级可见 code 以便核验） |
| `POST` | `/api/tasks/` | 管理员（需 JWT） | 创建任务（生成完成验证码，仅 1/2 级可见） |
| `GET` | `/api/tasks/:id` | JWT 登录 | 任务详情 |
| `PUT` | `/api/tasks/:id` | 管理员（需 JWT） | 管理端：编辑任务（标题/描述/奖励/上下线/人数限制） |
| `POST` | `/api/tasks/:id/claim` | JWT 登录 | 接取任务 |
| `GET` | `/api/tasks/:id/claims` | 管理员（需 JWT） | 管理端：任务领取/完成记录 |
| `POST` | `/api/tasks/:id/complete` | JWT 登录 | 提交完成验证码 → 完成任务并发放贡献点 |
| `GET` | `/api/tasks/admin/list` | 管理员（需 JWT） | 管理端：全部任务（含停用，1/2 级可见 code） |
| `GET` | `/api/tasks/my/all` | JWT 登录 | 我接取的任务 |

## /api/team

文件：`routes/team.js`（10 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/team/configs` | 管理员（需 JWT） | — |
| `POST` | `/api/team/configs` | 管理员（需 JWT） | — |
| `DELETE` | `/api/team/configs/:id` | 管理员（需 JWT） | — |
| `GET` | `/api/team/configs/:id` | 管理员（需 JWT） | — |
| `PUT` | `/api/team/configs/:id` | 管理员（需 JWT） | — |
| `GET` | `/api/team/export/:id` | X-Server-Key | — |
| `POST` | `/api/team/import` | X-Server-Key | — |
| `GET` | `/api/team/list` | X-Server-Key | — |
| `GET` | `/api/team/public` | 公开 | — |
| `GET` | `/api/team/public/:id` | 公开 | — |

## /api/titles

文件：`routes/titles.js`（8 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/titles/` | 公开 | — |
| `POST` | `/api/titles/` | 管理员（需 JWT） | — |
| `DELETE` | `/api/titles/:id` | 管理员（需 JWT） | — |
| `PUT` | `/api/titles/:id` | 管理员（需 JWT） | — |
| `POST` | `/api/titles/:id/buy` | JWT 登录 | — |
| `GET` | `/api/titles/all` | 管理员（需 JWT） | — |
| `PUT` | `/api/titles/equip` | JWT 登录 | — |
| `GET` | `/api/titles/my` | JWT 登录 | — |

## /api/updates

文件：`routes/updates.js`（4 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/api/updates/android/latest.json` | 公开 | Android 更新元数据 |
| `GET` | `/api/updates/files/*` | 公开 | 更新文件下载（302 到 CDN），支持多级路径如 android/xuanjian-guild-1.0.0.apk |
| `GET` | `/api/updates/latest.yml` | 公开 | Electron 更新清单：把文件 URL 改写为 CDN 完整地址 |
| `GET` | `/api/updates/release-notes.json` | 公开 | 更新公告 |

## /api/upload

文件：`routes/upload.js`（4 个端点）

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `POST` | `/api/upload/image` | JWT 登录 | 上传图片 |
| `POST` | `/api/upload/images` | JWT 登录 | 上传多张图片 |
| `POST` | `/api/upload/projection-token` | JWT 登录 | 生成投影文件（.litematic）上传凭证（前端 XHR 直传，最大 20MB） |
| `POST` | `/api/upload/token` | JWT 登录 | 生成七牛云上传凭证（前端 XHR 直传，带进度回调） |
