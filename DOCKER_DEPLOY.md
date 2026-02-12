# Docker 部署指南

## 项目结构

```
xuanjian-guild-website/
├── Dockerfile              # Docker镜像构建文件
├── docker-compose.yml      # Docker Compose配置文件
├── .dockerignore          # Docker忽略文件
├── package.json           # Node.js依赖
├── server.js              # 服务器入口
└── ...                    # 其他项目文件
```

## 快速开始

### 方法一：使用 Docker Compose（推荐）

1. **确保已安装 Docker 和 Docker Compose**

2. **设置环境变量（可选）**
   
   创建 `.env` 文件：
   ```env
   JWT_SECRET=your-secret-key-here
   ADMIN_PASSWORD=your-admin-password
   ```

3. **构建并启动容器**
   ```bash
   docker-compose up -d
   ```

4. **查看日志**
   ```bash
   docker-compose logs -f
   ```

5. **停止服务**
   ```bash
   docker-compose down
   ```

### 方法二：手动构建 Docker 镜像

1. **构建镜像**
   ```bash
   docker build -t xuanjian-guild:latest .
   ```

2. **运行容器**
   ```bash
   docker run -d \
     --name xuanjian-guild-website \
     -p 3000:3000 \
     -e JWT_SECRET=your-secret-key-here \
     -e ADMIN_PASSWORD=your-admin-password \
     -v $(pwd)/data:/app/data \
     -v $(pwd)/uploads:/app/uploads \
     --restart unless-stopped \
     xuanjian-guild:latest
   ```

3. **查看运行状态**
   ```bash
   docker ps
   docker logs xuanjian-guild-website
   ```

## 配置文件说明

### Dockerfile

```dockerfile
FROM node:18-alpine          # 使用Node.js 18 Alpine镜像
WORKDIR /app                 # 设置工作目录
COPY package*.json ./        # 复制依赖文件
RUN npm ci --only=production # 安装生产依赖
COPY . .                     # 复制项目文件
RUN mkdir -p data uploads    # 创建数据目录
EXPOSE 3000                  # 暴露3000端口
ENV NODE_ENV=production      # 设置环境变量
CMD ["npm", "start"]         # 启动命令
```

### docker-compose.yml

```yaml
version: '3.8'
services:
  xuanjian-guild:
    build: .                  # 从当前目录构建
    container_name: xuanjian-guild-website
    ports:
      - "3000:3000"          # 端口映射
    environment:
      - NODE_ENV=production
      - PORT=3000
      - JWT_SECRET=${JWT_SECRET:-default}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:-default}
    volumes:
      - ./data:/app/data     # 数据库持久化
      - ./uploads:/app/uploads # 上传文件持久化
    restart: unless-stopped   # 自动重启策略
    healthcheck:              # 健康检查
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3000/"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## 数据持久化

数据通过 Docker volumes 持久化到宿主机：

- `./data` - SQLite 数据库文件
- `./uploads` - 用户上传的图片文件

这样即使容器被删除，数据也不会丢失。

## 常用命令

```bash
# 查看运行中的容器
docker ps

# 查看容器日志
docker logs xuanjian-guild-website

# 进入容器内部
docker exec -it xuanjian-guild-website sh

# 停止容器
docker stop xuanjian-guild-website

# 删除容器
docker rm xuanjian-guild-website

# 删除镜像
docker rmi xuanjian-guild:latest

# 重新构建
docker-compose up -d --build

# 查看资源使用
docker stats xuanjian-guild-website
```

## 生产环境部署建议

### 1. 使用反向代理（Nginx）

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

### 2. 使用 HTTPS

推荐使用 Let's Encrypt 免费证书：

```yaml
# docker-compose.yml 添加
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
```

### 3. 环境变量安全

- 使用强密码
- 定期更换 JWT_SECRET
- 不要将 .env 文件提交到版本控制

### 4. 备份策略

```bash
# 备份数据库
cp data/guild.db data/guild.db.backup.$(date +%Y%m%d)

# 备份上传文件
tar -czf uploads-backup-$(date +%Y%m%d).tar.gz uploads/
```

### 5. 监控和日志

```bash
# 设置日志限制
docker run -d \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  ...
```

## 故障排查

### 容器无法启动

```bash
# 查看详细日志
docker logs xuanjian-guild-website

# 检查端口占用
netstat -tlnp | grep 3000
```

### 数据库权限问题

```bash
# 修复文件权限
chmod 777 data uploads
```

### 内存不足

```bash
# 查看容器内存使用
docker stats

# 限制容器内存
docker run -m 512m ...
```

## 更新部署

```bash
# 拉取最新代码
git pull

# 重新构建并启动
docker-compose up -d --build

# 清理旧镜像
docker image prune -f
```

## 支持

如有问题，请联系：
- 邮箱：admin@xuanjian.com
- QQ群：123456789
