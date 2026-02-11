# 离线部署方案

由于网络问题无法连接到 Docker Hub，提供以下替代方案：

## 方案一：传统部署（推荐）

直接在服务器上运行 Node.js 应用，无需 Docker。

### 1. 环境要求
- Node.js 18+ 
- npm 或 yarn

### 2. 部署步骤

```bash
# 1. 上传项目文件到服务器
# 使用 scp 或 ftp 将项目文件上传到服务器

# 2. 进入项目目录
cd /path/to/xuanjian-guild

# 3. 安装依赖
npm install --production

# 4. 初始化数据库
npm run init-db

# 5. 配置环境变量
cp .env.example .env
# 编辑 .env 文件，设置 JWT_SECRET 和 ADMIN_PASSWORD

# 6. 使用 PM2 启动（推荐）
npm install -g pm2
pm2 start server.js --name "xuanjian-guild"
pm2 save
pm2 startup

# 或者使用 nohup 启动
nohup node server.js > app.log 2>&1 &
```

### 3. 使用 Nginx 反向代理

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 方案二：使用预构建的 Node.js 镜像

如果你有其他机器可以访问 Docker Hub，可以先在那台机器上构建镜像，然后导出导入。

### 在能访问 Docker Hub 的机器上：

```bash
# 1. 构建镜像
docker build -t xuanjian-guild:latest .

# 2. 保存镜像
docker save xuanjian-guild:latest > xuanjian-guild.tar

# 3. 压缩镜像（可选）
gzip xuanjian-guild.tar
```

### 在目标服务器上：

```bash
# 1. 传输镜像文件
scp xuanjian-guild.tar.gz user@target-server:/path/

# 2. 解压
gunzip xuanjian-guild.tar.gz

# 3. 加载镜像
docker load < xuanjian-guild.tar

# 4. 运行容器
docker run -d \
  --name xuanjian-guild \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/uploads:/app/uploads \
  xuanjian-guild:latest
```

## 方案三：使用国内镜像源

修改 Dockerfile 使用国内镜像源：

### 阿里云镜像
```dockerfile
FROM registry.cn-hangzhou.aliyuncs.com/nodejs/node:18-alpine
```

### 网易云镜像
```dockerfile
FROM hub-mirror.c.163.com/library/node:18-alpine
```

### DaoCloud 镜像
```dockerfile
FROM m.daocloud.io/docker.io/library/node:18-alpine
```

## 方案四：配置 Docker 镜像加速

在 Docker Desktop 设置中添加镜像加速：

1. 打开 Docker Desktop
2. 点击 Settings（设置）
3. 选择 Docker Engine
4. 编辑 JSON 配置，添加：

```json
{
  "registry-mirrors": [
    "https://docker.mirrors.ustc.edu.cn",
    "https://hub-mirror.c.163.com",
    "https://mirror.baidubce.com"
  ]
}
```

5. 点击 Apply & Restart

## 推荐方案

对于当前情况，**推荐直接使用方案一（传统部署）**：

1. 不需要 Docker
2. 部署简单快速
3. 资源占用更少
4. 更容易调试

### 快速部署脚本

创建 `deploy.sh`：

```bash
#!/bin/bash

# 安装 Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 安装 PM2
sudo npm install -g pm2

# 进入项目目录
cd /var/www/xuanjian-guild

# 安装依赖
npm install --production

# 初始化数据库
npm run init-db

# 启动服务
pm2 start server.js --name "xuanjian-guild"
pm2 save
pm2 startup

echo "部署完成！"
echo "访问地址: http://服务器IP:3000"
```

运行：
```bash
chmod +x deploy.sh
./deploy.sh
```

## 注意事项

1. **防火墙**：确保 3000 端口开放
2. **数据库**：定期备份 `data/guild.db` 文件
3. **上传文件**：定期备份 `data/uploads/` 目录
4. **日志**：使用 PM2 管理日志轮转

## 支持

如有问题，查看日志：
```bash
# PM2 日志
pm2 logs xuanjian-guild

# 直接运行的日志
tail -f app.log
```
