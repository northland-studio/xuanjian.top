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

玄剑公会官网是一个专为 Minecraft 公会设计的完整内容管理系统，支持内容发布、用户管理、社交互动等功能。采用轻量级架构，无需复杂的数据库配置，适合中小型公会快速部署使用。

### ✨ 核心特性

- 📝 **内容管理** - 公会日报、决策公告、贴吧三大板块
- 👥 **用户系统** - 三级权限体系，支持头像上传
- 💬 **社交互动** - 评论、点赞、内容搜索
- 🎨 **响应式设计** - 完美适配 PC 和移动端
- 🖥️ **桌面应用** - 支持 Windows/macOS/Linux 桌面客户端
- � **自动备份** - 系统定时备份，数据安全有保障
- �🚀 **一键部署** - 支持 Docker 和传统部署方式

---

## 🛠️ 技术栈

| 层级 | 技术 | 说明 |
|:---:|:---|:---|
| **前端** | HTML5 + CSS3 + JavaScript | 原生开发，无框架依赖 |
| **后端** | Node.js + Express | 轻量级 Web 框架 |
| **数据库** | SQLite3 | 本地文件存储，零配置 |
| **进程管理** | PM2 | 生产环境进程守护 |
| **反向代理** | Nginx | 高性能反向代理 |
| **容器化** | Docker | 快速部署方案 |
| **桌面应用** | Electron / WebView2 | 跨平台桌面客户端 |

---

## 📁 项目结构

```
xuanjian-guild-website/
├── 📂 app/                     # 桌面应用源码
│   ├── 📂 electron/            # Electron 主进程
│   ├── 📂 src/                 # 前端源码
│   └── 📂 玄剑公会桌面客户端/   # 打包后的桌面应用
├── 📂 data/                    # 数据目录
│   ├── 📂 uploads/             # 上传文件存储
│   └── 🗄️ guild.db             # SQLite 数据库
├── 📂 middleware/              # 中间件
│   └── 🔐 auth.js              # JWT 认证中间件
├── 📂 public/                  # 静态资源
│   ├── 📂 css/                 # 样式文件
│   ├── 📂 js/                  # JavaScript 文件
│   ├── 📂 pages/               # 页面文件
│   └── 🏠 index.html           # 首页
├──  routes/                  # API 路由
│   ├── 🔐 auth.js              # 认证接口
│   ├── 📝 posts.js             # 内容接口
│   ├── 👥 admin.js             # 管理接口
│   └── 📤 upload.js            # 上传接口
├── 📂 scripts/                 # 工具脚本
│   ├── 🗄️ init-db.js           # 数据库初始化
│   ├── 💾 backup.sh            # 自动备份脚本
│   └── ⚙️ install-backup.sh    # 备份系统部署
├── 🚀 server.js                # 服务器入口
├── 🗄️ database.js              # 数据库模块
├── 📦 package.json             # 项目配置
├── 🐳 Dockerfile               # Docker 配置
├── ⚙️ docker-compose.yml       # Docker Compose 配置
└── 📖 README.md                # 项目文档
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

---

## 🌐 页面路由

| 路径 | 页面 | 说明 |
|:---|:---|:---|
| `/` | 首页 | 公会介绍、最新内容 |
| `/daily` | 公会日报 | 管理员发布，全员浏览 |
| `/decision` | 决策公告 | 重要决策公示 |
| `/forum` | 公会贴吧 | 全员可发帖交流 |
| `/post/:id` | 内容详情 | 查看具体内容 |
| `/editor` | 内容编辑器 | 发布/编辑内容 |
| `/profile` | 用户主页 | 个人资料管理 |
| `/admin` | 管理后台 | 系统管理 |
| `/login` | 登录 | 用户登录 |
| `/register` | 注册 | 用户注册 |

---

## �️ 桌面应用

项目提供跨平台桌面客户端，支持 Windows、macOS 和 Linux。

### 功能特性

- 🎮 直接访问玄剑公会官网
- 🖥️ 原生桌面应用体验
- ⌨️ 支持快捷键操作
- 🔍 页面缩放功能
- 🛠️ 开发者工具支持

### 获取方式

桌面应用位于 `app/玄剑公会桌面客户端/` 目录，双击运行即可。

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

---

## 🌟 社交媒体

- 🌐 **官网**: https://xuanjian.top
- 🎵 **抖音**: https://v.douyin.com/pNyb7PYyn3s/
- 📺 **B站**: https://space.bilibili.com/678742876
- 💬 **QQ群**: http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=_gw12An9YHGh949KbwjRv03G4FN8KC3p
- 📧 **邮箱**: xuanjian_guild@xuanjian.top

---

## 📝 更新日志

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
