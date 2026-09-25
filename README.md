<div align="center">
  <img src="https://xuanjian.top/icon.png" width="200" height="200" alt="玄剑公会 Logo">
</div>

<div align="center">

# 我的世界玄剑公会官网

xuanjian.top 2.0 - React 重构版

![Node.js](https://img.shields.io/badge/Node.js-22-green?style=flat-square)
![Express](https://img.shields.io/badge/Express-4.x-blue?style=flat-square)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square)
![SQLite](https://img.shields.io/badge/SQLite-3-003B49?style=flat-square)
![Qiniu](https://img.shields.io/badge/Qiniu-Kodo-0080FF?style=flat-square)
![Version](https://img.shields.io/badge/Version-v2.4.0-blue?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

**在线地址**: https://xuanjian.top

</div>

---

## 项目介绍

玄剑公会官网（xuanjian.top 2.0）是面向 Minecraft 公会的完整内容管理系统，提供内容发布、用户体系、贡献点商城、签到排行、通知中心等核心能力。前端采用 React 19 + Vite 8 构建单页应用，后端基于 Node.js + Express + SQLite，图片通过七牛云对象存储（新加坡区域）分发，全站支持亮色 / 暗色主题与移动端适配。

## 功能特性

### 内容管理

- 三大板块：公会贴吧（全员发帖）、公会日报（管理权限）、决策公示（管理权限）
- Tiptap 富文本编辑器，支持标题、加粗、引用、列表、链接、代码块、图片插入
- 帖子二次编辑、点赞、评论（楼中楼回复）、搜索
- 图片查看器（Lightbox）：多图切换、键盘 / 滚轮操作、移动端手势
- 一键分享：复制帖子标题与链接

### 用户体系

- 三级等级体系：成员（0）/ 管理员（1）/ 超级管理员（2）
- QQ 授权登录 + 邮箱绑定（验证码） + 用户名密码登录
- 自定义 ID（/profile/:id）、昵称、头像、个人主页封面
- 密码设置 / 修改、邮箱验证码

### 贡献点经济

- 贡献点商城：使用贡献点兑换称号与权限
- 称号系统：购买、装备、自定义称号
- 贡献点申报：用户提交申报，管理员审核发放
- 每日签到：连续签到奖励递增、补签卡、签到排行榜
- 排行榜：贡献点、上线时长、帖子阅读 / 点赞、签到排行
- 贡献点显示统一保留两位小数（四舍五入），覆盖余额、价格、流水、排行等全站展示

### 管理后台

- 轮播图管理、用户管理（等级调整、代系分类）、内容管理、公告管理（支持弹窗公告）
- 商城管理（商品上下架、库存、价格）、申报审核
- 代系管理：配置代系区间（名称 / 日期 / 颜色 / 排序），成员按注册时间自动归代，可手动分类

### 成员代系

- 按注册时间自动判定所属代系，管理员可手动调整
- 代系展示于 GMIRS 档案系统、PDF 导出与个人主页

### 系统能力

- 通知中心：日报 / 决策更新、评论、点赞、申报审核结果实时提醒
- 弹窗公告：管理后台发布后可全站弹窗展示，按公告 ID 记忆已读
- 滚动公告：首页顶部无缝滚动展示全部启用公告（含弹窗 / 普通公告），悬停暂停
- OAuth 2.0 授权码模式：第三方应用可使用公会账号登录
- 七牛云对象存储：前端 XHR 直传，实时上传进度回调
- 日志系统：控制台 + 按天滚动文件日志（data/logs/app-YYYYMMDD.log）
- PWA：离线缓存、添加到主屏幕、iOS 描述文件安装
- 多端客户端：Electron 桌面版（自动更新）、Capacitor Android 版、iOS PWA（详见 applicant/）
- 亮色 / 暗色主题切换，SVG 图标，品牌色 #004AAD

---

## 技术栈

| 层级 | 技术 | 说明 |
|:---|:---|:---|
| 前端框架 | React 19 + Vite 8 | 单页应用（SPA） |
| 路由 | React Router 7 | 前端路由 |
| 富文本 | Tiptap 3 | 富文本编辑器 |
| 后端 | Node.js + Express 4 | REST API |
| 数据库 | SQLite (sqlite3) | 本地文件存储，WAL 模式 |
| 对象存储 | 七牛云 Kodo | 图片直传 + CDN 分发 |
| 图片处理 | sharp | 图片水印处理 |
| 认证 | JWT + QQ OAuth | 登录与第三方授权 |
| 进程管理 | PM2 | 生产环境守护 |
| 反向代理 | Nginx | 站点入口与缓存 |

---

## 项目结构

```
xuanjian-guild-website/
├── server.js                # 后端入口（Express + 静态托管）
├── database.js              # SQLite 数据库连接封装
├── routes/                  # API 路由
│   ├── auth.js              # 认证 / 用户 / QQ 登录 / 邮箱绑定
│   ├── posts.js             # 内容管理
│   ├── upload.js            # 图片上传（七牛凭证 + 传统上传）
│   ├── shop.js              # 商城
│   ├── titles.js            # 称号
│   ├── claims.js            # 贡献点申报
│   ├── checkin.js           # 每日签到
│   ├── rankings.js          # 排行榜
│   ├── banners.js           # 轮播图
│   ├── admin.js             # 管理接口
│   ├── oauth.js             # OAuth 2.0
│   └── notifications.js     # 通知中心
├── middleware/auth.js       # JWT 认证中间件
├── lib/qiniu.js             # 七牛云上传凭证（零依赖 HMAC）
├── lib/logger.js            # 日志系统（控制台 + 按天滚动文件）
├── scripts/                 # 初始化 / 迁移 / 备份脚本
├── frontend/                # React 前端工程（Vite）
│   ├── src/                 # 前端源码（pages / components / api）
│   └── dist/                # 构建产物
├── public/                  # 站点静态资源（横幅图、图标等）
└── data/                    # SQLite 数据库与上传目录
```

---

## 快速开始

### 本地开发

```bash
# 1. 安装后端依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 设置 JWT_SECRET、QQ_LOGIN_TOKEN 等

# 3. 初始化数据库
npm run init-db

# 4. 启动后端（开发模式）
npm run dev

# 5. 另开终端，安装并启动前端
cd frontend
npm install
npm run dev
```

### 生产构建

```bash
# 构建前端
cd frontend && npm run build

# 启动服务
pm2 start server.js --name "xuanjian-guild"
pm2 save
```

---

## 环境变量

```env
# 服务器配置
PORT=3000
NODE_ENV=production
SITE_URL=https://xuanjian.top

# JWT 密钥
JWT_SECRET=your-secret-key

# 管理员初始密码
ADMIN_PASSWORD=your-admin-password

# 邮件配置（腾讯企业邮箱）
SMTP_USER=xuanjian_guild@xuanjian.top
SMTP_PASS=your-smtp-password

# QQ 登录 Token
QQ_LOGIN_TOKEN=your-qq-login-token

# 七牛云对象存储
QINIU_ACCESS_KEY=your-access-key
QINIU_SECRET_KEY=your-secret-key
QINIU_BUCKET=xuanjian-top
QINIU_DOMAIN=https://cdn.xuanjian.top
QINIU_UPLOAD_URL=https://up-as0.qiniup.com
```

---

## 图片存储（七牛云）

- 域名：cdn.xuanjian.top（公开读），bucket：xuanjian-top，新加坡区域（as0）
- 前端通过 `POST /api/upload/token` 获取上传凭证，XHR 直传 `up-as0.qiniup.com`，`xhr.upload.onprogress` 实时回调上传进度
- 历史本地图片已通过 `scripts/migrate-to-qiniu.js` 迁移至七牛并更新数据库路径

---

## API 概览

| 模块 | 说明 |
|:---|:---|
| /api/auth/* | 登录、QQ 授权、用户资料、邮箱绑定、密码 |
| /api/posts/* | 内容发布、列表、详情、评论、点赞 |
| /api/upload/token | 七牛上传凭证 |
| /api/titles/* | 称号列表、购买、装备 |
| /api/shop/* | 商城商品、购买、我的库存 |
| /api/claims/* | 贡献点申报、审核 |
| /api/checkin/* | 签到、补签、排行 |
| /api/rankings/* | 各类排行榜 |
| /api/banners/* | 轮播图 |
| /api/notifications/* | 通知中心 |
| /api/announcements/* | 公告（/popup 弹窗公告） |
| /api/updates/* | 客户端更新源（latest.yml / files / release-notes / android） |
| /api/oauth/* | OAuth 2.0 授权 |
| /api/admin/* | 管理后台 |

---

## OAuth 第三方应用对接

玄剑官网本身可作为 **OAuth 2.0 授权服务器（Provider）**，让第三方应用（如 Nork 答题平台、北牖 northbooker、北域相关产品）复用玄剑公会账号登录，并按玄剑等级继承权限。

### 1. 授权码模式（Authorization Code Flow）

标准流程：

```
第三方前端 ──跳转──▶ 玄剑 /api/oauth/authorize（授权页，未登录先引去玄剑登录）
                    用户点「允许授权」
   ◀──302 code+state── 第三方 /callback（code 一次性、5 分钟有效）
第三方后端 ──POST──▶ 玄剑 /api/oauth/token（code 换 access_token，7 天有效）
第三方后端 ──GET──▶ 玄剑 /api/oauth/verify（校验 token，取用户含 level）
```

### 2. Provider 端点

| 端点 | 方法 | 说明 |
|:---|:---|:---|
| `/api/oauth/authorize` | GET | 授权页；query：`client_id`,`redirect_uri`,`response_type=code`,`state`；未登录会自动跳到玄剑 `/login` |
| `/api/oauth/authorize` | POST | 用户点“允许”后签发一次性 `code`（请求头 `Authorization: Bearer <玄剑登录token>`） |
| `/api/oauth/token` | POST | `code` 换 `access_token`；body：`grant_type=authorization_code`,`code`,`client_id`,`client_secret`,`redirect_uri` |
| `/api/oauth/verify` | GET | 校验 token 并返回用户；请求头 `Authorization: Bearer <access_token>` |
| `/api/oauth/userinfo` | GET | 用户详情（含称号、签到）；请求头同上 |

`verify` 返回（`user` 字段）：
```jsonc
{
  "id": 123,            // 玄剑用户 id（建议用作第三方 provider_uid）
  "username": "…",
  "avatar": "…",
  "level": 1,           // 0 成员 / 1 管理员 / 2 超级管理员 —— 用于第三方做权限继承
  "title": "…",
  "contribution": 0
}
```

### 3. 第三方接入要点

1. **申请一套 client 参数**：`client_id`（第三方唯一名，如 `nork`/`northbooker`）、`client_secret`（客户端机密，仅第三方后端持有）。
2. **redirect_uri 必须指向第三方后端的回调地址**（如 `https://nork.xuanjian.top/api/auth/oauth/xuanjian/callback`），且 authorize 与 token 两处要保持完全一致。
3. **state 防 CSRF**：发起 authorize 前随机生成 state，回调时比对；用后即弃、有过期时间。
4. **code 换 token 在服务端做**（切勿暴露 `client_secret` 给前端）。
5. **登录态与管理员继承**：`verify` 返回的 `level>=1` 即代表玄剑管理员/超管；第三方可用其把对应账号提升为本平台管理员（示例见下）。

### 4. 对接示例（Nork 答题平台）

Nork 已按本协议实现玄剑登录（其源码见北域项目 `Nork`）：

- 前端「使用玄剑账号登录」按钮 → `GET /nork /api/auth/oauth/xuanjian/start`
- 后端 `start`：生成 `state` 并 302 到玄剑 `authorize`
- 玄剑回调到 `callback`：`code` 换 `access_token` → `verify` 取 `{id,username,avatar,level}` → 创建/更新 Nork 会员（`provider_uid = id`, 落 `level`）→ 发 Nork 自身 JWT
- Nork 以 `oauth_users.level>=1` 作为管理员，实现 **玄剑管理员继承 Nork 管理权限**

Nork 相关 `.env` 参考：
```
XUANJIAN_PROVIDER_URL=https://www.xuanjian.top
XUANJIAN_CLIENT_ID=nork
XUANJIAN_CLIENT_SECRET=…
XUANJIAN_REDIRECT_URI=https://nork.xuanjian.top/api/auth/oauth/xuanjian/callback
```

> 说明：`code` 通过 `authCodes`（进程内存）保存，**重启会失效**；生产如需跨进程/高可用可改为数据库存储（可选用）。

---

## 更新日志

### v2.4.0（2026-08-29）

- **人员代系分化系统**：新增 generations 配置表（代系名称 / 起止日期 / 颜色 / 排序）与 users.generation 字段；按注册时间自动判定代系，管理员可手动分类；档案系统（GMIRS）、PDF 导出、个人主页均展示代系徽章
- **管理后台代系管理**：新增「代系管理」Tab（增删改代系区间配置）；成员管理 Tab 内可直接用下拉框为每位成员选择/恢复代系
- **修复模组自动签到连续天数**：模组签到接口不再硬编码连续天数=1，改为与官网一致（昨天已签则 +1，否则重置），连续签到正常累加
- **修复代系更新 500**：generations 表补充 updated_at 列，解决 PUT /api/generations/:id 报错

### v2.3.0（2026-08-23）

- **上线时长排行榜**：新增 online_time 累计表（模组 JOIN / 下线 / 心跳上报时自动累加在线时长，单次会话上限 90 分钟防虚高），新增 /api/rankings/online-time 接口，排行榜页新增「在线时长」Tab（X 小时 Y 分格式化）
- **首页滚动公告**：新增首页顶部无缝滚动公告条（AnnouncementMarquee 组件），复用公告系统、悬停暂停，风格与现有组件一致；管理面板修复公告列表接口返回结构（{ announcements }），弹窗公告历史现可正常查看
- **贡献点显示统一两位小数**：新增 utils.fmtPoints 统一格式化（minimumFractionDigits=2 四舍五入），全站贡献点 / 价格 / 奖励 / 流水 / 排行榜显示均改为 xx.xx 两位小数
- **商城购买上限调整**：不限量商品单次购买数量上限由 99 件取消（可批量购买任意数量），仓库同核销码堆叠无上限
- **商城数据维护**：公会地皮购买商品（含其购买记录与贡献点流水）下线并退回相关成员贡献点，恢复到上架前状态（直接改库、不写流水）
- **子域名反向代理**：新增 profiles.xuanjian.top → /gmirs、chufen.xuanjian.top → /gdars 的 Nginx 反代配置（Cloudflare 边缘 HTTPS 回源）
- **模组更新**：设置页改为 vanilla 自写 GUI（原生 Screen+EditBox+Button，移除 cloth-config 依赖，jar 大幅瘦身）；修复转账 playerAuth 鉴权（fromUuid 兼容）；新增 26.1 分支（支持 Minecraft 26.1.2），CI 三分支构建并发布 GitHub Release

### v2.2.0（2026-08-22）

Aug 15 与 Aug 22 两次批量提交合并记录：

- **GMIRS 成员档案查询系统**：模糊查询（用户名 / 昵称 / 游戏ID）、PDF / docx 导出（嵌入 CJK 等线字体、canvas 圆形头像）、一键 zip（每成员独立文件）、皮肤图渲染、验证码查伪、独立 /gmirs 前端；头像走 /api/gmirs/proxy-image 同源代理绕过 CORS；新增导出进度回调与进度条
- **GDARS 处分记录查询系统**：三级处分 + 冻结 / freeze、记录管理员、公开查询接口、独立 /gdars 前端，管理后台处分管理 Tab（撤销 / 解冻）
- **处分接口鉴权补全**：处分管理接口补全 authMiddleware；docx 改用 Packer.toBlob
- **异常登录邮件提醒**：login_attempts 表 + 陌生 IP 检测 + sendAbnormalLoginAlert，异地登录及时告警
- **贡献点全量流水日志**：contribution_logs type CHECK 扩展 discipline / post，带 balance_after / ref_id / note
- **申报入口迁移**：申报入口移至转账页，移除重复入口；修复 @number516567 申报可见性（claims.js 改用 fetchLatestLevel 实时读库判断管理员）
- **商城批量购买与整批核销**：管理端支持同批次商品数量查看（含已核销批次）、营业额统计
- **模组玩家接口**：routes/mod.js 扩充分绑定 / 签到 / 任务 / 转账 / 申报
- **称号购买修复**：购买价格为空时清空余额改为补记称号购买流水（补补偿 HOMO114514 63 点）
- **核销修复**：修复核销确认函数遮蔽 window.confirm 导致无限自递归循环发请求
- **接口限流调整**：限流阈值调整并返回友好提示
- **GMIRS / GDARS 页面**：移除昵称占位与横幅图片引用，字体 URL 加版本号
- **数据库迁移**：新增 scripts/migrate-20260822.js

### v2.1.0（2026-08-07）

- **PWA**：新增 manifest 与 Service Worker，支持离线缓存与添加到主屏幕；iOS 安装引导页与描述文件（applicant/iOS）
- **Electron 桌面版**（applicant/Desktop）：原生标题栏、托盘、开机自启，electron-updater 双源自动更新（GitHub + 七牛 CDN），CI 自动构建
- **Capacitor Android 版**（applicant/Android）：原生更新插件（检测 / 下载 APK / 系统安装），状态栏品牌色，CI 自动构建并发布 CDN
- **更新源**：新增 /api/updates/* 代理接口，更新包统一存放七牛 releases/ 目录

### v2.0.1（2026-08-07）

- **弹窗公告**：管理后台可发布弹窗公告（弹窗 / 启用开关），前端新增弹窗展示组件，全站公告发布后自动弹出，按公告 ID 记忆已读
- **贡献点修复**：修复 contribution 为 NULL 的用户（如 number516567）申报到账后贡献点仍为空的 bug，所有贡献点增减改为 COALESCE 处理，新注册用户默认 0
- **通知中心修复**：重建 notifications 表，CHECK 约束加入 claim_result，修复申报审核结果通知创建失败（SQLITE_CONSTRAINT）
- **日志系统**：新增 lib/logger.js（控制台 + 按天滚动文件日志），全项目替换 console.error，请求日志记录方法 / 地址 / 状态 / 耗时

### v2.0.0（2026-08-06）

- **React 重构**：前端由原生 HTML 重构为 React 19 + Vite 8 单页应用
- **七牛云对象存储**：图片迁移至 cdn.xuanjian.top，上传支持实时进度回调
- **上传进度**：编辑器、申报、设置、管理后台上传均展示百分比进度
- **贡献点商城**：标题更新为贡献点商城，使用贡献点兑换称号与权限
- **清理与基线**：移除旧版多页站、桌面 / 移动端旧应用源码，确立 2.0 基线（tag v2.0）

---

## 开发团队

北域工作室 Northland Studio

## 许可证

本项目基于 [MIT License](LICENSE) 开源。

<div align="center">

**我的世界玄剑公会** - 官方网站

*由 北域工作室 Northland Studio 出品*

</div>

## 贡献点金额口径（两位小数）

- 余额与所有金额按**两位小数**处理；展示与接口返回一律保留两位（如 `133.24`）。
- 历史遗留的浮点尾巴（如 `123.24000000000004`）已由 `scripts/migrate-contribution-2dp.js` 清理：
  一次性 `ROUND(x, 2)` + 数据库触发器 `trg_users_contribution_2dp` 兜底，
  任何写入（现有 30 余处 SQL 与新代码）都会自动取整到两位，无需逐个改造。
- 前端金额输入框已放开 `step="0.01"`。

## 贡献点扫码支付

设计契约见 `docs/PAY-QR-DESIGN.md`：收款码（主扫）+ 付款码（反扫，60 秒刷新）+ 缴费单码（一码多人），
付款必须由付款方在已登录会话中二次确认；单笔 ≤500、日累计 ≤2000、>200 需管理员审批；
收款方支持个人 / 活动摊位 / 公会官方（系统金库「玄剑财政」）；入口为官网 H5 与 QQ 机器人。

**进度**

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 表结构（`pay_payees` / `pay_intents` / `pay_transactions` / `pay_charges`）+ 系统金库账户 | ✅ 已上线 |
| 2 | 收款码「主扫」闭环（生成 → 扫码 → 本人确认 → 划转 / 审批 / 记录） | ✅ 已上线 |
| 3 | 付款码「反扫」（60 秒刷新）+ 站内相机扫码（相机 / 上传图片 / 手动输码三级降级） | ✅ 已上线 |
| 4 | 缴费单码（一码多人 + 截止时间 + 开放缴纳 + 未绑定玩家） | ✅ 已上线 |
| 5 | 审批台 + 对账页（CSV 导出）+ 阈值管理界面 | ✅ 已上线 |
| 6 | QQ 机器人指令入口（`/收款码` `/付款码` `/缴费单` `/转分`） | ✅ 已上线 |

**阶段 2 已提供接口**（挂载于 `server.js` → `/api/pay`，实现见 `routes/pay.js`）

- `POST /api/pay/receive-code`：生成我的收款码（任意登录用户；可带金额与备注，有效期 90 秒，一次性 token）。
- `GET /api/pay/intents/:token`：扫码后读取付款信息（收款方、金额、备注、阈值、我今日已付额度）。
- `POST /api/pay/intents/:token/confirm`：**付款人本人**确认支付。余额校验与「扣款 + 入账 + 流水 + 意图归位」在
  单个 `BEGIN IMMEDIATE` 事务内完成；金额 >200 只登记 `pending_approval` 流水，不动余额。
- `GET /api/pay/records`：我的收付款记录（含今日已付额度）。
- `GET|PUT /api/pay/admin/settings`：风控阈值（管理员），落 `settings` 表：`pay_single_limit` / `pay_daily_limit` / `pay_approval_threshold`。

**阶段 3-5 已提供接口**（同一路由文件 `routes/pay.js`）

- 付款码反扫：`GET /api/pay/payer-code/current`（60 秒刷新）、`POST /api/pay/scan`（收款方扫付款码发起收款；
  扫到收款码/缴费单码则返回 `mode:'direct'` 直达付款页）、`GET /api/pay/payer-code/pending`（付款方轮询待确认）。
- 缴费单：`POST /api/pay/charge`（管理员或认证成员）、`GET /api/pay/charge/:token`、`POST /api/pay/charge/:token/pay`、
  `POST /api/pay/charge/:token/close`、`GET /api/pay/charges`。
- 审批与对账：`GET /api/pay/admin/approvals`、`POST /api/pay/admin/approve/:id`（`action=approve|reject`）、
  `GET /api/pay/admin/records`（筛选 + `format=csv`）、`GET /api/pay/admin/summary`。
- 二维码图片：`GET /api/pay/qr.png?text=`（公开只读，仅接受本站 `/pay/<token>` 链接或纯 token，≤512 字符）。
- 机器人入口：`/api/qqbot/pay/*`（沿用机器人 token 鉴权与 QQ↔官网绑定关系，内部复用同一套出码/权限逻辑）。

**QQ 机器人指令**（群内 `#` 或 `/` 前缀均可；机器人只出码与提示，**扣款一律回官网由付款方本人确认**）

| 指令 | 说明 |
| --- | --- |
| `收款码 [金额] [备注]` | 代发指令者出 90 秒收款码图片 + 网页链接；未绑定提示先 `#绑定` |
| `付款码` | 60 秒付款码图片，让收款方在官网「支付中心 → 扫一扫」扫码填额，再由付款方本人确认 |
| `缴费单 <标题> <金额> [@某人…]` | 开单并回图片/链接/人数/截止；金额可留空（按人填）、写「全员」= 开放缴纳；权限由官网统一校验（管理员或认证成员） |
| `转分 @某人 <金额> [备注]` | 只生成「付给该成员」的收款码，不做扣款；对方未绑定时提示其先绑定 |

机器人源码：`xuanjian-group-bot`（TypeScript，独立仓库 `northland-studio/xuanjian-group-bot`），
生产部署在 NapCat 主机 `/var/www/xuanjian-group-bot`（systemd `xuanjian-group-bot.service`，`node dist/index.js`），
部署脚本 `scripts/deploy-bot-pay.sh`。

**两个易踩的坑（已修，别再踩）**

- `.env` 里 `QQBOT_TOKEN` 必须**独占一行赋值**：曾因注释与赋值挤在同一行导致 dotenv 读不到，线上所有
  `/api/qqbot/*`（含既有的 `#绑定`/`#查自己`/`#核销`/`#任务码`）恒返回 401；修复见 `scripts/fix-qqbottoken-20260925.sh`。
- 所有二维码/缴费单的倒计时**必须以服务端下发的 `remainSeconds` 为准**：服务器（HK=UTC）与浏览器时区不一致时，
  前端自行解析 `expiresAt` 字符串会把「未过期」误判成「已过期」（`routes/pay.js` 的 `remainSecOf()` 与
  `PayIntent.jsx` / `PayCharge.jsx` / `PayRecords.jsx` 的 `serverRemain()` 即为此约定）。
- 前端页面：`/pay`（支付中心：收款码 / 付款码 / 扫一扫）、`/pay/:token`（付款落地页）、`/pay/charge/:token`（缴费单）、
  `/pay/records`（我的记录）、`/pay/admin`（审批 + 对账 + 阈值，仅管理员）。

运维与联调：

- 迁移脚本 `scripts/migrate-pay.js`（幂等）：建表、登记金库账户、扩展
  `contribution_logs.type`（`pay_out` / `pay_in`）与 `notifications.type`（`pay`）的 CHECK 白名单。
- 闭环联调 `scripts/test-pay-e2e.js`（31 项断言：正常支付 / 重复支付 / 过期 / 超限 / 日累计 / 大额审批 / 记录 / 权限，
  结束后回滚余额并清理数据），生产可用 `PAY_TEST_USERS=<idA>,<idB>` 指定临时账号。
- 阶段 3-5 联调 `scripts/test-pay-e2e2.js`（57 项断言：付款码反扫闭环 / 扫收款码直付与占用拦截 / 缴费单名单与开放缴纳 /
  金库入账 / 大额审批通过与驳回 / 审批后名单同步 / 对账概览与 CSV / 阈值权限），同样会回滚余额、恢复阈值并清理数据。
- 部署脚本 `scripts/deploy-pay-20260925.sh`、`scripts/deploy-pay2-20260925.sh`（后端 + 前端 dist 原子切换）；
  生产联调 `scripts/deploy-pay-verify.sh`、`scripts/deploy-pay-verify2.sh`。

新模块的通知统一走既有 `createNotification()`（`routes/notifications.js`）：
付款成功/被拒/待审批、收到款项、缴费单开单与截止提醒，均按用户维度落一条通知，
并在 QQ 机器人侧可选播报（复用群机器人服务）。贡献点变动同时写入
`contribution_logs`（`pay_out` / `pay_in`），保证任何余额变化都可追溯。

