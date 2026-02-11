# 我的世界玄剑公会官网

## 项目概述

这是一个为"我的世界玄剑公会"开发的完整官网系统，包含内容发布、用户管理、社交互动等功能。

## 技术栈

- **前端**: HTML5 + CSS3 + JavaScript (原生，无框架依赖)
- **后端**: Node.js + Express
- **数据库**: SQLite3 (本地文件存储，无需云端数据库)
- **部署**: Nginx 反向代理 + PM2 进程管理 / Docker

## 项目结构

```
├── data/                   # 数据目录
│   ├── uploads/           # 上传文件存储
│   └── guild.db           # SQLite数据库文件
├── middleware/            # 中间件
│   └── auth.js           # 认证中间件
├── public/               # 静态文件
│   ├── css/             # 样式文件
│   │   └── style.css
│   ├── js/              # JavaScript文件
│   │   └── common.js    # 公共函数库
│   ├── pages/           # 页面文件
│   │   ├── admin.html      # 管理后台
│   │   ├── daily.html      # 公会日报
│   │   ├── decision.html   # 决策公告
│   │   ├── editor.html     # 内容编辑器
│   │   ├── forum.html      # 公会贴吧
│   │   ├── login.html      # 登录页
│   │   ├── post-detail.html # 内容详情页
│   │   ├── profile.html    # 用户主页
│   │   ├── register.html   # 注册页
│   │   └── social.html     # 社交媒体页
│   └── index.html       # 首页
├── routes/               # API路由
│   ├── admin.js         # 管理接口
│   ├── announcement.js  # 公告接口
│   ├── auth.js          # 认证接口
│   ├── posts.js         # 内容接口
│   └── upload.js        # 上传接口
├── scripts/              # 脚本
│   └── init-db.js       # 数据库初始化
├── database.js           # 数据库连接模块
├── server.js             # 服务器入口
├── package.json          # 项目配置
├── Dockerfile            # Docker镜像配置
├── docker-compose.yml    # Docker Compose配置
├── nginx.conf            # Nginx配置
├── 运维帮助文档.md        # 部署运维文档
└── DOCKER_DEPLOY.md      # Docker部署文档
```

## 功能特性

### 内容管理
- **公会日报**: 管理员可发布，普通用户可浏览
- **决策公示**: 管理员可发布，普通用户可浏览
- **公会贴吧**: 所有登录用户可发布和浏览

### 用户系统
- 三级权限体系: 普通用户(0级)、管理员(1级)、超级管理员(2级)
- 用户注册/登录/登出
- 用户资料管理（支持头像上传）
- 贡献点系统

### 交互功能
- 内容点赞
- 评论系统(支持回复)
- 内容搜索
- 弹窗公告
- 文件上传（头像、内容图片）

### 管理功能
- 内容管理(删除、置顶)
- 用户管理(修改信息、设置等级)
- 公告管理
- 数据统计

## 部署方式

### 方式一：Docker部署（推荐）

详见 [DOCKER_DEPLOY.md](./DOCKER_DEPLOY.md)

```bash
# 快速部署
docker-compose up -d
```

### 方式二：传统部署

详见 [运维帮助文档.md](./运维帮助文档.md)

#### 快速开始

1. 安装依赖
```bash
npm install
```

2. 初始化数据库
```bash
npm run init-db
```

3. 配置环境变量
```bash
cp .env.example .env
# 编辑 .env 文件，设置 JWT_SECRET 和 ADMIN_PASSWORD
```

4. 启动服务
```bash
npm start
# 或
npm run dev  # 开发模式
```

## 环境变量配置

创建 `.env` 文件：

```env
# 服务器配置
PORT=3000
NODE_ENV=production

# JWT密钥（请修改为随机字符串）
JWT_SECRET=your-secret-key-here

# 管理员初始密码（部署后请修改）
ADMIN_PASSWORD=xuanjian123
```

## 默认账号

- **用户名**: admin
- **密码**: xuanjian123
- **等级**: 超级管理员(2级)

**注意**: 部署后请立即修改默认密码！

## API接口

### 认证接口
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录
- `GET /api/auth/me` - 获取当前用户信息
- `PUT /api/auth/profile` - 更新用户资料

### 内容接口
- `GET /api/posts` - 获取内容列表
- `GET /api/posts/:id` - 获取内容详情
- `POST /api/posts` - 发布内容
- `PUT /api/posts/:id` - 更新内容
- `DELETE /api/posts/:id` - 删除内容
- `POST /api/posts/:id/like` - 点赞
- `POST /api/posts/:id/comments` - 发表评论

### 上传接口
- `POST /api/upload/image` - 上传单张图片
- `POST /api/upload/images` - 上传多张图片

### 管理接口
- `GET /api/admin/stats` - 获取统计数据
- `GET /api/admin/users` - 获取用户列表
- `PUT /api/admin/users/:id` - 更新用户信息
- `GET /api/admin/posts` - 获取所有内容

## 页面路由

- `/` - 首页
- `/daily` - 公会日报
- `/decision` - 决策公告
- `/forum` - 公会贴吧
- `/post/:id` - 内容详情
- `/editor` - 内容编辑器
- `/profile` - 用户主页
- `/login` - 登录
- `/register` - 注册
- `/admin` - 管理后台
- `/social` - 社交媒体

## 社交媒体链接

- 抖音: https://v.douyin.com/pNyb7PYyn3s/
- B站: https://space.bilibili.com/678742876
- QQ群: http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=_gw12An9YHGh949KbwjRv03G4FN8KC3p
- 邮箱: xuanjian_guild@xuanjian.top

## 注意事项

1. **安全**: 部署前请修改默认管理员密码和 JWT_SECRET
2. **权限**: 确保 `data/uploads` 目录有写入权限
3. **HTTPS**: 生产环境建议使用 HTTPS
4. **备份**: 定期备份数据库文件 (`data/guild.db`)
5. **上传**: 头像和内容图片存储在 `data/uploads` 目录

## 常见问题

### 头像上传失败
- 检查 `data/uploads` 目录是否存在且有写入权限
- 确认文件大小不超过 5MB
- 确认文件格式为 JPG、PNG、GIF 或 WEBP

### 时间显示不正确
- 确保服务器时区设置正确
- 客户端会自动根据本地时区显示时间

### 数据库错误
- 运行 `npm run init-db` 初始化数据库
- 检查 `data` 目录权限

## 更新日志

### v1.0.0
- 初始版本发布
- 完整的内容管理系统
- 用户权限管理
- 评论和点赞功能
- Docker 支持

## 开源协议

MIT License

---

**我的世界玄剑公会** - 官方网站
