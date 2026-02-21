<div align="center">

<img src="src/assets/icon.png" alt="玄剑公会 Logo" width="128" height="128">

# 玄剑公会桌面客户端

**玄剑公会官方桌面应用程序**

[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8D8?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-1.75+-DEA584?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

[功能特性](#-功能特性) • [快速开始](#-快速开始) • [开发指南](#-开发指南) • [构建发布](#-构建发布)

</div>

---

## ✨ 功能特性

### 📝 内容管理

| 功能 | 描述 |
|:---:|:---|
| 📰 帖子浏览 | 浏览首页、日报、决策、贴吧等多种类型内容 |
| ✏️ 发布帖子 | 支持发布不同类型的帖子，包含标题、内容、标签 |
| 🔍 搜索功能 | 搜索帖子标题、内容或标签 |
| 🛠️ 编辑帖子 | 编辑自己发布的帖子内容 |

### 💬 社交互动

| 功能 | 描述 |
|:---:|:---|
| 💭 评论系统 | 在帖子下发表评论，支持回复 |
| ❤️ 点赞功能 | 为喜欢的帖子点赞 |
| 🔗 分享功能 | 一键分享帖子链接 |

### 👤 用户系统

| 功能 | 描述 |
|:---:|:---|
| 🔐 账号认证 | 完整的用户注册/登录系统 |
| 👤 个人主页 | 查看用户信息、发布的帖子、统计数据 |
| ⚙️ 资料设置 | 修改昵称、邮箱、密码 |
| 🌓 主题切换 | 支持明暗主题切换 |

### ⚙️ 管理后台

| 功能 | 描述 |
|:---:|:---|
| 📊 数据统计 | 查看用户数、帖子数、评论数等统计数据 |
| 📌 帖子管理 | 置顶、删除帖子 |
| 👥 用户管理 | 查看用户列表，超级管理员可设置用户等级 |
| 📢 公告管理 | 管理弹窗公告 |

### 🔒 安全特性

- 🚫 禁用右键菜单
- 🚫 禁用开发者工具快捷键 (F12, Ctrl+Shift+I 等)
- 🖼️ 无边框窗口设计，自定义标题栏

---

## 🚀 快速开始

### 📋 前置要求

| 依赖 | 版本要求 | 下载链接 |
|:---:|:---:|:---:|
| Node.js | >= 18 | [nodejs.org](https://nodejs.org/) |
| Rust | latest | [rust-lang.org](https://www.rust-lang.org/tools/install) |
| npm / pnpm | latest | [npmjs.com](https://www.npmjs.com/) |

### 📥 安装

```bash
# 克隆项目
git clone https://github.com/xuanjian-guild/desktop.git
cd desktop

# 安装依赖
npm install
```

### 🏃 运行

```bash
# 启动开发服务器
npm run tauri dev
```

---

## 🛠️ 开发指南

### 📁 项目结构

```
apps/desktop/
├── 📂 src/                    # 前端源代码
│   ├── 📄 main.ts            # 主入口文件
│   ├── 🎨 styles.css         # 全局样式
│   ├── ⚙️ config.ts          # 配置文件
│   └── 📂 assets/            # 静态资源
├── 📂 src-tauri/              # Tauri 后端
│   ├── 📂 src/               # Rust 源代码
│   ├── 📄 Cargo.toml         # Rust 依赖配置
│   └── 📄 tauri.conf.json    # Tauri 配置
├── 📄 index.html              # HTML 入口
├── 📄 package.json            # Node.js 配置
└── 📄 vite.config.ts          # Vite 配置
```

### 🔧 配置

编辑 `src/config.ts` 文件配置 API 地址：

```typescript
export const API_BASE = 'http://your-api-server/api';
export const STATIC_BASE = 'http://your-api-server';
```

### 🎨 主题定制

应用支持明暗主题切换，主题变量定义在 `src/styles.css`：

```css
:root {
    --primary: #6366f1;      /* 主色调 */
    --bg: #ffffff;           /* 背景色 */
    --text: #1e293b;         /* 文字色 */
}

[data-theme="dark"] {
    --primary: #818cf8;
    --bg: #0f172a;
    --text: #f1f5f9;
}
```

---

## 📦 构建发布

### 🔨 构建

```bash
# 构建生产版本
npm run tauri build
```

构建完成后，安装包位于 `src-tauri/target/release/bundle/` 目录。

### 🖥️ 支持平台

| 平台 | 格式 |
|:---:|:---:|
| Windows | `.msi`, `.exe` |
| macOS | `.dmg`, `.app` |
| Linux | `.deb`, `.AppImage` |

---

## 🛡️ 技术栈

<table>
<tr>
<td width="50%">

### 前端

- **[Tauri 2.0](https://tauri.app/)** - 跨平台桌面应用框架
- **[TypeScript](https://www.typescriptlang.org/)** - 类型安全
- **[Vite](https://vitejs.dev/)** - 构建工具

</td>
<td width="50%">

### 后端

- **[Rust](https://www.rust-lang.org/)** - Tauri 后端语言
- **[Tauri API](https://tauri.app/v2/api/)** - 系统接口

</td>
</tr>
</table>

---

## 👥 作者

<table>
<tr>
<td align="center">
<img src="https://img.shields.io/badge/玄剑公会-官方-blue?style=for-the-badge" alt="玄剑公会">
<br>
<a href="https://xuanjian.top">🌐 官方网站</a>
</td>
<td align="center">
<img src="https://img.shields.io/badge/北域工作室-开发-green?style=for-the-badge" alt="北域工作室">
<br>
<a href="https://github.com/northlandstudio">📦 GitHub</a>
</td>
</tr>
</table>

---

## 📄 许可证

本项目采用 **MIT 许可证** - 详见 [LICENSE](LICENSE) 文件。

---

<div align="center">

**Made with ❤️ by 玄剑公会 & 北域工作室**

[⬆ 返回顶部](#玄剑公会桌面客户端)

</div>
