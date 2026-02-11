# Docker 镜像构建和部署指南

## 方法一：使用 Docker Compose（推荐）

### 1. 构建并启动
```bash
docker-compose up -d --build
```

### 2. 查看日志
```bash
docker-compose logs -f
```

### 3. 停止服务
```bash
docker-compose down
```

## 方法二：手动构建 Docker 镜像

### 1. 构建镜像
```bash
docker build -t xuanjian-guild:latest .
```

### 2. 运行容器
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

### 3. 查看运行状态
```bash
docker ps
docker logs xuanjian-guild-website
```

## 方法三：导出/导入镜像（离线部署）

### 1. 在能访问 Docker Hub 的机器上构建
```bash
docker build -t xuanjian-guild:latest .
```

### 2. 保存镜像为 tar 文件
```bash
docker save -o xuanjian-guild.tar xuanjian-guild:latest
```

### 3. 将 tar 文件传输到目标服务器
```bash
scp xuanjian-guild.tar user@server:/path/to/
```

### 4. 在目标服务器上加载镜像
```bash
docker load -i xuanjian-guild.tar
```

### 5. 运行容器
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

## 镜像说明

### 镜像信息
- **名称**: xuanjian-guild:latest
- **基础镜像**: node:18-alpine
- **暴露端口**: 3000
- **工作目录**: /app

### 包含的功能
- ✅ Node.js 18 运行环境
- ✅ Python3、make、g++（用于编译原生模块）
- ✅ 自动创建数据目录
- ✅ 健康检查
- ✅ 生产环境优化

### 环境变量
| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| NODE_ENV | 运行环境 | production |
| PORT | 服务端口 | 3000 |
| JWT_SECRET | JWT密钥 | your-secret-key-here |
| ADMIN_PASSWORD | 管理员密码 | xuanjian123 |

### 数据持久化
容器会创建以下卷映射：
- `./data` → `/app/data` (数据库)
- `./uploads` → `/app/uploads` (上传文件)

## 常见问题

### 1. 构建失败 - 网络问题
如果无法连接到 Docker Hub，可以使用国内镜像源：
```bash
# 配置 Docker 使用国内镜像
# 编辑 /etc/docker/daemon.json
{
  "registry-mirrors": [
    "https://docker.mirrors.ustc.edu.cn",
    "https://hub-mirror.c.163.com"
  ]
}
```

### 2. 权限问题
确保数据目录有正确的权限：
```bash
chmod -R 755 data/
chmod -R 755 uploads/
```

### 3. 端口冲突
如果 3000 端口被占用，可以修改映射：
```bash
-p 8080:3000  # 将主机的8080映射到容器的3000
```

### 4. 查看容器内部
```bash
docker exec -it xuanjian-guild-website sh
```

## 更新部署

### 1. 拉取最新代码
git pull

### 2. 重新构建
docker-compose up -d --build

### 3. 清理旧镜像
docker image prune -f
```

## 生产环境建议

1. **使用反向代理**（Nginx）
2. **配置 HTTPS**（Let's Encrypt）
3. **设置防火墙规则**
4. **定期备份数据**
5. **监控容器状态**

## 支持

如有问题，请查看日志：
```bash
docker-compose logs -f
```
