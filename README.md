<div align="center">

# 🗡️ 我的世界玄剑公会官网

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-blue.svg)](https://expressjs.com/)
[![SQLite](https://img.shields.io/badge/SQLite-3-orange.svg)](https://www.sqlite.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**一个功能完善的 Minecraft 公会官网系统**

[在线演示](https://xuanjian.top) · [部署文档](#部署方式) · [API文档](#api接口)

</div>

---

## 📋 项目简介

玄剑公会官网是一个专为 Minecraft 公会设计的完整内容管理系统，支持内容发布、用户管理、社交互动、虚拟股市等功能。采用轻量级架构，无需复杂的数据库配置，适合中小型公会快速部署使用。

### ✨ 核心特性

- 📝 **内容管理** - 公会日报、决策公告、贴吧三大板块
- 📈 **虚拟股市** - 交易驱动价格、做市商机制、熔断保护
- 📅 **每日签到** - 连续签到奖励递增、补签卡系统
- 👥 **用户系统** - 三级权限体系，支持头像上传
- 💬 **社交互动** - 评论、点赞、内容搜索
- 🎨 **响应式设计** - 完美适配 PC 和移动端
- 🖥️ **多平台支持** - Web、桌面、移动端全覆盖
- 🔔 **通知系统** - 实时通知，不错过任何动态
- 🔐 **邮箱验证** - 企业邮箱验证码注册
- 🔄 **自动备份** - 系统定时备份，数据安全有保障
- 🚀 **一键部署** - 支持 Docker 和传统部署方式

---

## 📱 多平台版本

本项目提供三个版本，共享同一套后端 API：

### 🌐 Web 版（主站）

基于原生 HTML/CSS/JavaScript 开发的网页版，无需安装即可使用。

- **访问地址**: https://xuanjian.top
- **技术栈**: HTML5 + CSS3 + JavaScript
- **特点**: 无需安装，跨平台访问

### 🖥️ 桌面版（Desktop）

基于 Tauri 构建的跨平台桌面客户端，支持 Windows、macOS 和 Linux。

- **下载地址**: https://xuanjian.top/download/xuanjian-guild.exe
- **技术栈**: Tauri + TypeScript + Vite
- **特点**: 原生体验，离线可用，自动更新

<details>
<summary>📖 桌面版详细说明</summary>

#### 功能特性

- 🎮 直接访问玄剑公会官网
- 🖥️ 原生桌面应用体验
- ⌨️ 支持快捷键操作
- 🔍 页面缩放功能
- 🔄 自动更新检测
- 🔔 系统通知支持

#### 开发构建

```bash
cd apps/desktop

# 安装依赖
npm install

# 开发模式
npm run tauri dev

# 构建发布
npm run tauri build
```

#### 目录结构

```
apps/desktop/
├── src/                    # 前端源码
│   ├── assets/             # 静态资源
│   ├── config.ts           # 配置
│   ├── main.ts             # 主入口
│   ├── styles.css          # 样式
│   └── version-check.ts    # 版本检测
├── src-tauri/              # Tauri 配置
│   ├── src/                # Rust 源码
│   ├── icons/              # 应用图标
│   └── tauri.conf.json     # Tauri 配置
├── index.html
├── package.json
└── vite.config.ts
```

</details>

### 📲 移动版（Android）

基于 Capacitor 构建的移动端应用，支持 Android 平台。

- **技术栈**: Capacitor + TypeScript + Vite
- **特点**: 可收起侧边栏，原生相机支持，流畅体验

<details>
<summary>📖 移动版详细说明</summary>

#### 功能特性

- 📱 原生移动端体验
- 📷 支持相机拍照上传
- 🎨 可收起侧边栏导航
- 🌙 暗色/亮色主题切换
- 🔔 实时通知推送

#### 开发构建

```bash
cd apps/android

# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 添加Android平台
npm run cap:add

# 同步到Android
npm run cap:sync

# 打开Android Studio
npm run cap:open
```

#### 图片上传处理

移动端使用 Capacitor Camera 插件处理图片上传，将 Base64 转换为 File 对象后上传：

```typescript
import { Camera, CameraResultType } from '@capacitor/camera';

const photo = await Camera.getPhoto({
  quality: 90,
  resultType: CameraResultType.Base64
});

// 将 Base64 转换为 Blob/File
const byteCharacters = atob(photo.base64String!);
const byteNumbers = new Array(byteCharacters.length);
for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
}
const byteArray = new Uint8Array(byteNumbers);
const blob = new Blob([byteArray], { type: 'image/jpeg' });

// 创建 File 对象并上传
const file = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
const formData = new FormData();
formData.append('image', file);

await fetch('/api/upload/image', {
    method: 'POST',
    body: formData
});
```

#### 目录结构

```
apps/android/
├── src/
│   ├── assets/             # 静态资源
│   ├── config.ts           # 配置和类型定义
│   ├── main.ts             # 主入口
│   ├── styles.css          # 样式
│   └── vite-env.d.ts       # Vite类型
├── android/                # Android原生项目（cap add后生成）
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── capacitor.config.ts
```

</details>

---

## 🛠️ 技术栈

| 层级 | 技术 | 说明 |
|:---:|:---|:---|
| **前端** | HTML5 + CSS3 + JavaScript | 原生开发，无框架依赖 |
| **后端** | Node.js + Express | 轻量级 Web 框架 |
| **数据库** | SQLite3 | 本地文件存储，零配置 |
| **桌面应用** | Tauri 2.0 | Rust + WebView2 |
| **移动应用** | Capacitor 7 | 跨平台原生运行时 |
| **进程管理** | PM2 | 生产环境进程守护 |
| **反向代理** | Nginx | 高性能反向代理 |
| **容器化** | Docker | 快速部署方案 |

---

## 📁 项目结构

```
xuanjian-guild-website/
├── 📂 apps/                    # 多平台应用
│   ├── 📂 desktop/             # 桌面客户端
│   │   ├── 📂 src/             # 前端源码
│   │   ├── 📂 src-tauri/       # Tauri 配置
│   │   └── 📖 README.md        # 桌面版文档
│   └── 📂 android/             # 移动端
│       ├── 📂 src/             # 前端源码
│       └── 📖 README.md        # 移动版文档
├── 📂 data/                    # 数据目录
│   ├── 📂 uploads/             # 上传文件存储
│   └── 🗄️ guild.db             # SQLite 数据库
├── 📂 middleware/              # 中间件
│   └── 🔐 auth.js              # JWT 认证中间件
├── 📂 public/                  # 静态资源
│   ├── 📂 css/                 # 样式文件
│   ├── 📂 js/                  # JavaScript 文件
│   ├── 📂 pages/               # 页面文件
│   ├── 📂 download/            # 下载文件
│   └── 🏠 index.html           # 首页
├── 📂 routes/                  # API 路由
│   ├── 🔐 auth.js              # 认证接口
│   ├── 📝 posts.js             # 内容接口
│   ├── 👥 admin.js             # 管理接口
│   ├── 📈 stock.js             # 股票接口
│   ├── 📅 checkin.js           # 签到接口
│   ├── 📤 upload.js            # 上传接口
│   └── 🔔 notifications.js     # 通知接口
├── 📂 scripts/                 # 工具脚本
│   ├── 🗄️ init-db.js           # 数据库初始化
│   ├── 💾 backup.sh            # 自动备份脚本
│   └── ⚙️ install-backup.sh    # 备份系统部署
├── 🚀 server.js                # 服务器入口
├── 🗄️ database.js              # 数据库模块
├── 📦 package.json             # 项目配置
├── 🐳 Dockerfile               # Docker 配置
├── ⚙️ docker-compose.yml       # Docker Compose 配置
├── 📖 README.md                # 项目文档
└── 📈 股市机制.md              # 虚拟股市机制说明
```

---

## 🚀 快速开始

### 方式一：Docker 部署（推荐）

```bash
# 克隆项目
git clone https://github.com/yourusername/xuanjian-guild-website.git
cd xuanjian-guild-website

# 启动服务
docker-compose up -d

# 访问 http://localhost:3000
```

### 方式二：传统部署

```bash
# 1. 安装依赖
npm install --production

# 2. 初始化数据库
npm run init-db

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 设置 JWT_SECRET 和 ADMIN_PASSWORD

# 4. 启动服务
npm start

# 或使用 PM2 启动（推荐生产环境）
pm2 start server.js --name "xuanjian-guild"
pm2 save
pm2 startup
```

### 方式三：开发模式

```bash
npm install
npm run dev
```

---

## ⚙️ 环境变量

创建 `.env` 文件：

```env
# 服务器配置
PORT=3000
NODE_ENV=production

# JWT 密钥（请修改为随机字符串）
JWT_SECRET=your-super-secret-key-here

# 管理员初始密码（部署后请立即修改）
ADMIN_PASSWORD=xuanjian123

# 邮箱配置（企业微信邮箱）
SMTP_HOST=smtp.exmail.qq.com
SMTP_PORT=465
SMTP_USER=your-email@domain.com
SMTP_PASS=your-password
```

---

## 🔑 默认账号

| 字段 | 值 |
|:---|:---|
| **用户名** | `admin` |
| **密码** | `xuanjian123` |
| **等级** | 超级管理员 (2级) |

> ⚠️ **安全提示**: 部署后请立即修改默认密码！

---

## 📡 API 接口

### 🔐 认证接口

| 方法 | 路径 | 说明 |
|:---:|:---|:---|
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 用户登录 |
| GET | `/api/auth/me` | 获取当前用户信息 |
| PUT | `/api/auth/profile` | 更新用户资料 |
| POST | `/api/auth/send-code` | 发送邮箱验证码 |

### 📝 内容接口

| 方法 | 路径 | 说明 |
|:---:|:---|:---|
| GET | `/api/posts` | 获取内容列表 |
| GET | `/api/posts/:id` | 获取内容详情 |
| POST | `/api/posts` | 发布内容 |
| PUT | `/api/posts/:id` | 更新内容 |
| DELETE | `/api/posts/:id` | 删除内容 |
| POST | `/api/posts/:id/like` | 点赞 |
| POST | `/api/posts/:id/comments` | 发表评论 |

### 🔔 通知接口

| 方法 | 路径 | 说明 |
|:---:|:---|:---|
| GET | `/api/notifications` | 获取通知列表 |
| PUT | `/api/notifications/:id/read` | 标记已读 |
| PUT | `/api/notifications/read-all` | 全部已读 |
| DELETE | `/api/notifications/:id` | 删除通知 |

### 📤 上传接口

| 方法 | 路径 | 说明 |
|:---:|:---|:---|
| POST | `/api/upload/image` | 上传单张图片 |
| POST | `/api/upload/images` | 上传多张图片 |

### 👥 管理接口

| 方法 | 路径 | 说明 |
|:---:|:---|:---|
| GET | `/api/admin/stats` | 获取统计数据 |
| GET | `/api/admin/users` | 获取用户列表 |
| PUT | `/api/admin/users/:id` | 更新用户信息 |
| GET | `/api/admin/posts` | 获取所有内容 |
| POST | `/api/admin/announcements` | 创建公告 |
| PUT | `/api/admin/announcements/:id` | 更新公告 |
| DELETE | `/api/admin/announcements/:id` | 删除公告 |

### 📈 股票接口

| 方法 | 路径 | 说明 |
|:---:|:---|:---|
| GET | `/api/stock/stocks` | 获取股票列表（活跃） |
| GET | `/api/stock/stocks/all` | 获取所有股票（管理） |
| GET | `/api/stock/stocks/:id` | 获取股票详情 |
| GET | `/api/stock/stocks/:id/history` | 获取股票历史价格 |
| POST | `/api/stock/stocks/:id/buy` | 买入股票 |
| POST | `/api/stock/stocks/:id/sell` | 卖出股票 |
| POST | `/api/stock/stocks/:id/restore` | 恢复停用股票 |
| DELETE | `/api/stock/stocks/:id` | 删除股票 |
| GET | `/api/stock/portfolio` | 获取投资组合 |
| GET | `/api/stock/transactions` | 获取交易记录 |
| POST | `/api/stock/stocks` | 创建股票（管理） |
| PUT | `/api/stock/stocks/:id` | 更新股票（管理） |
| POST | `/api/stock/trigger-update` | 触发价格更新（管理） |

### 📅 签到接口

| 方法 | 路径 | 说明 |
|:---:|:---|:---|
| GET | `/api/checkin/status` | 获取签到状态 |
| POST | `/api/checkin/checkin` | 执行签到 |
| POST | `/api/checkin/makeup` | 补签 |
| POST | `/api/checkin/buy-makeup-card` | 购买补签卡 |
| GET | `/api/checkin/rewards` | 获取签到奖励配置 |
| GET | `/api/checkin/ranking` | 获取签到排行榜 |

---

## 🌐 页面路由

| 路径 | 页面 | 说明 |
|:---|:---|:---|
| `/` | 首页 | 公会介绍、最新内容 |
| `/daily` | 公会日报 | 管理员发布，全员浏览 |
| `/decision` | 决策公告 | 重要决策公示 |
| `/forum` | 公会贴吧 | 全员可发帖交流 |
| `/social` | 社交媒体 | 社交账号链接 |
| `/stock` | 虚拟股票 | 股票市场、买卖交易 |
| `/checkin` | 每日签到 | 签到、补签、排行榜 |
| `/notifications` | 通知中心 | 查看所有通知 |
| `/post/:id` | 内容详情 | 查看具体内容 |
| `/editor` | 内容编辑器 | 发布/编辑内容 |
| `/profile` | 用户主页 | 个人资料管理 |
| `/profile/:username` | 用户档案 | 查看他人资料 |
| `/settings` | 账号设置 | 修改资料密码 |
| `/admin` | 管理后台 | 系统管理 |
| `/login` | 登录 | 用户登录 |
| `/register` | 注册 | 用户注册 |

---

## 📈 虚拟股市系统

### 核心机制

虚拟股市采用**交易驱动模型**，价格由用户买卖行为决定：

```
价格变动 = 交易驱动因子 × 60% + 随机因子 × 30% + 趋势因子 × 10%
```

### 风险控制

| 机制 | 说明 |
|:---|:---|
| **价格熔断** | 单次涨跌幅限制 10% |
| **交易上限** | 单次交易不超过总股本 5% |
| **交易冷却** | 同一股票买卖间隔 1 小时 |
| **做市商** | 系统自动提供基础流动性 |

### 交易规则

- **货币**: 贡献点（通过签到获取）
- **交易时间**: 24小时不间断
- **价格更新**: 每分钟自动更新
- **持仓限制**: 无上限

> 📖 详细机制说明请查看 [股市机制.md](./股市机制.md)

---

## 📦 部署文档

- [Docker 部署指南](./DOCKER_DEPLOY.md)
- [SSH 部署指南](./SSH_DEPLOY.md)
- [宝塔面板部署指南](./BT_PANEL_DEPLOY.md)
- [运维手册](./OPS_GUIDE.md)

---

## 🔧 常见问题

### Q: 头像上传失败？
**A:** 
- 检查 `data/uploads` 目录是否存在且有写入权限
- 确认文件大小不超过 5MB
- 确认文件格式为 JPG、PNG、GIF 或 WEBP

### Q: 时间显示不正确？
**A:** 
- 确保服务器时区设置正确
- 客户端会自动根据本地时区显示时间

### Q: 数据库错误？
**A:** 
- 运行 `npm run init-db` 初始化数据库
- 检查 `data` 目录权限

### Q: 如何备份数据？
**A:** 
- 数据库文件：`data/guild.db`
- 上传文件：`data/uploads/`
- 系统已配置自动备份，详见 [运维手册](./OPS_GUIDE.md)

### Q: 桌面应用如何更新？
**A:** 
- 桌面应用启动时会自动检测更新
- 也可手动下载最新版本覆盖安装

### Q: 股票交易提示冷却中？
**A:** 
- 同一股票买入后需等待 1 小时才能卖出
- 同一股票卖出后需等待 1 小时才能买入

---

## 🌟 社交媒体

- 🌐 **官网**: https://xuanjian.top
- 🎵 **抖音**: https://v.douyin.com/pNyb7PYyn3s/
- 📺 **B站**: https://space.bilibili.com/678742876
- 💬 **QQ群**: http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=_gw12An9YHGh949KbwjRv03G4FN8KC3p
- 📧 **邮箱**: xuanjian_guild@xuanjian.top

---

## 📝 更新日志

### v2.0.7 (2026-3-4)
#### 下设Alpha & Beta两个测试版
- 📈 **虚拟股市系统** - 交易驱动价格、做市商机制、熔断保护
- 📅 **每日签到** - 连续签到奖励递增、补签卡购买、签到排行榜
- 🎛️ **管理后台扩展** - 新增股票管理、签到奖励配置
- ⏰ **时区修复** - 修复数据库时间比北京时间慢8小时的问题
- 🎨 **UI优化** - 移除网页emoji改用SVG图标、优化按钮布局
- 🌙 **深色模式修复** - 修复股票页面深色模式下颜色不明显
- 🐛 **桌面版修复** - 修复Windows桌面版图片上传后未正确使用的问题
- 🔒 **交易冷却** - 同一股票买卖需间隔1小时

### v2.0.5 (2026-2-21)
- 🔔 **通知系统** - 新增通知中心，支持日报/决策更新、评论、点赞通知
- 📱 **桌面版通知** - 侧边栏添加通知入口，实时显示未读数量
- 📲 **移动端应用** - 新增 Android 版本，支持可收起侧边栏
- 🔄 **邮箱状态同步** - 修复桌面版邮箱验证状态不同步问题
- 🐛 **版本显示修复** - 修复桌面版版本号显示问题

### v2.0.4 (2026-2-21)
- 💬 **评论回复功能** - 支持楼中楼回复，最多3层嵌套
- ✉️ **邮箱验证码注册** - 新用户注册需验证邮箱，提升账号安全性
- 🔒 **邮箱验证限制** - 未验证邮箱用户无法评论、点赞、发布内容
- ⚙️ **邮箱绑定功能** - 已注册用户可在设置页面绑定/验证邮箱
- 📧 **企业邮箱集成** - 使用企业微信邮箱发送验证码

### v2.0.3 (2026-2-19)
- 🌙 **暗色主题** - 支持明暗两种主题切换
- 🔄 **自动检测** - 根据系统主题自动切换
- 💾 **记忆功能** - 保存用户主题偏好
- 🔘 **主题按钮** - 导航栏添加主题切换按钮
- 📤 **分享功能** - 帖子详情页添加分享按钮

### v2.0.2 (2026-2-19)
- ⚙️ **账号设置页面** - 新增独立的账号设置页面
- 🖼️ **修改头像** - 支持在设置页面更换头像
- 🔐 **修改密码** - 支持在设置页面修改密码
- 📝 **修改资料** - 支持修改昵称和邮箱
- 🐛 **修复退出登录** - 清除所有用户数据，导航栏正确显示登录按钮
- 🔒 **修复图片加载** - 使用相对路径解决 HTTPS 混合内容问题

### v2.0.1 (2026-2-19)
- 🐛 **修复档案页帖子加载** - 修复用户档案页最近发布显示为空的问题
- 🔧 **管理员快捷入口** - 管理员用户档案页显示管理系统按钮
- 🔗 **修复用户名显示** - 修复内容详情页作者用户名显示错误
- 📝 **富文本样式修复** - 修复换行、加粗等格式不显示的问题
- 🧹 **缩略信息优化** - 修复列表页显示 HTML 标签的问题
- 🎨 **发布按钮样式** - 使用独立紫色样式，更加醒目
- 💡 **编辑器悬停提示** - 富文本编辑器工具栏添加悬停功能说明

### v2.0.0 (2026-2-19)
- ✨ **富文本编辑器** - 支持格式化文本、图片插入、代码块等
- 📝 **帖子二次编辑** - 作者可随时编辑已发布的内容
- 👤 **用户档案系统** - 点击头像查看用户详细资料和发布历史
- 🔗 **@用户名格式** - 类似 Twitter 的用户标识方式
- 🖼️ **图片存储优化** - 将 Base64 图片转为文件存储，大幅提升性能
- 🚀 **API 优化** - 返回完整图片 URL，支持外部应用访问
- 🎨 **UI 优化** - 简化发布流程，移除发布到选择

### v1.1.0 (2026-2-16)
- 🖥️ 新增桌面客户端支持
- 💾 新增自动备份系统
- 🎨 优化弹窗按钮样式
- 📱 改进移动端适配
- 🐛 修复若干已知问题

### v1.0.0 (2026-2-11)
- ✨ 初始版本发布
- 📝 完整的内容管理系统
- 👥 用户权限管理
- 💬 评论和点赞功能
- 🐳 Docker 支持
- 📱 响应式设计

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

---

## 📄 开源协议

本项目基于 [MIT License](LICENSE) 开源。

---

<div align="center">

**🗡️ 我的世界玄剑公会** - 官方网站

*Made with ❤️ by 北域工作室网络工程组*

</div>
