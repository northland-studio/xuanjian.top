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
![Version](https://img.shields.io/badge/Version-v2.0.1-blue?style=flat-square)
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

- 四级等级体系：成员（0）/ 管理员（1）/ 超级管理员（2）/ 创始人（3）
- QQ 授权登录 + 邮箱绑定（验证码） + 用户名密码登录
- 自定义 ID（/profile/:id）、昵称、头像、个人主页封面
- 密码设置 / 修改、邮箱验证码

### 贡献点经济

- 贡献点商城：使用贡献点兑换称号与权限
- 称号系统：购买、装备、自定义称号
- 贡献点申报：用户提交申报，管理员审核发放
- 每日签到：连续签到奖励递增、补签卡、签到排行榜
- 排行榜：贡献点、帖子阅读 / 点赞、签到排行

### 管理后台

- 轮播图管理、用户管理（等级调整）、内容管理、公告管理（支持弹窗公告）
- 商城管理（商品上下架、库存、价格）、申报审核

### 系统能力

- 通知中心：日报 / 决策更新、评论、点赞、申报审核结果实时提醒
- 弹窗公告：管理后台发布后可全站弹窗展示，按公告 ID 记忆已读
- OAuth 2.0 授权码模式：第三方应用可使用公会账号登录
- 七牛云对象存储：前端 XHR 直传，实时上传进度回调
- 日志系统：控制台 + 按天滚动文件日志（data/logs/app-YYYYMMDD.log）
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
| /api/oauth/* | OAuth 2.0 授权 |
| /api/admin/* | 管理后台 |

---

## 更新日志

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
