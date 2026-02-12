# SSH 直接部署指南

## 一、连接服务器

### 1. 使用 SSH 连接

**Windows (PowerShell/CMD):**
```powershell
ssh root@你的服务器IP
```

**Mac/Linux:**
```bash
ssh root@你的服务器IP
```

**使用密钥连接:**
```bash
ssh -i ~/.ssh/your-key.pem root@你的服务器IP
```

## 二、服务器环境准备

### 1. 更新系统

```bash
# Ubuntu/Debian
sudo apt update && sudo apt upgrade -y

# CentOS/RHEL
sudo yum update -y
```

### 2. 安装必要软件

```bash
# Ubuntu/Debian
sudo apt install -y curl wget git nginx vim

# CentOS/RHEL
sudo yum install -y curl wget git nginx vim
```

## 三、安装 Node.js 18

```bash
# 使用 NodeSource 安装 Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证安装
node -v  # 应该显示 v18.x.x
npm -v   # 应该显示 9.x.x
```

## 四、上传项目文件

### 方法一：使用 SCP 命令（推荐）

**在本地执行:**

```powershell
# 进入项目目录
cd h:\程序源码夹\官网

# 打包项目（排除 node_modules 和 data）
tar -czvf xuanjian-guild.tar.gz --exclude='node_modules' --exclude='data' --exclude='.git' .

# 上传到服务器
scp xuanjian-guild.tar.gz root@你的服务器IP:/var/www/
```

**在服务器上解压:**

```bash
# 创建目录
sudo mkdir -p /var/www
cd /var/www

# 解压
sudo tar -xzvf xuanjian-guild.tar.gz
sudo mv xuanjian-guild xuanjian-guild-new  # 重命名（可选）

# 设置权限
sudo chown -R $USER:$USER /var/www/xuanjian-guild-new
```

### 方法二：使用 SFTP 工具

使用 FileZilla、WinSCP 等工具：
1. 主机：你的服务器IP
2. 用户名：root
3. 密码：你的密码（或密钥）
4. 端口：22

上传到 `/var/www/xuanjian-guild/`

## 五、安装依赖并配置

```bash
# 进入项目目录
cd /var/www/xuanjian-guild

# 安装依赖
npm install --production

# 初始化数据库
npm run init-db

# 创建环境变量文件
cp .env.example .env
nano .env
```

编辑 `.env` 文件：
```env
PORT=3000
NODE_ENV=production
JWT_SECRET=your-super-secret-key-change-this-now
ADMIN_PASSWORD=your-strong-admin-password
```

按 `Ctrl+O` 保存，`Ctrl+X` 退出。

## 六、使用 PM2 启动应用

### 1. 安装 PM2

```bash
sudo npm install -g pm2
```

### 2. 启动应用

```bash
cd /var/www/xuanjian-guild

# 启动
pm2 start server.js --name "xuanjian-guild"

# 查看状态
pm2 status

# 查看日志
pm2 logs xuanjian-guild

# 保存配置
pm2 save

# 设置开机自启
pm2 startup
# 执行显示的命令（如：sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u root --hp /root）
```

### 3. PM2 常用命令

```bash
# 查看状态
pm2 status

# 查看日志
pm2 logs xuanjian-guild
pm2 logs xuanjian-guild --lines 100

# 重启
pm2 restart xuanjian-guild

# 停止
pm2 stop xuanjian-guild

# 删除
pm2 delete xuanjian-guild

# 监控
pm2 monit
```

## 七、配置 Nginx 反向代理

### 1. 创建配置文件

```bash
sudo nano /etc/nginx/sites-available/xuanjian-guild
```

添加内容：

```nginx
server {
    listen 80;
    server_name your-domain.com;  # 替换为你的域名或服务器IP
    
    # 日志
    access_log /var/log/nginx/xuanjian-guild-access.log;
    error_log /var/log/nginx/xuanjian-guild-error.log;
    
    # 文件上传大小限制
    client_max_body_size 50M;
    
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
    
    # 静态文件缓存
    location /uploads/ {
        proxy_pass http://127.0.0.1:3000/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

### 2. 启用站点

```bash
# 创建符号链接
sudo ln -s /etc/nginx/sites-available/xuanjian-guild /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx

# 设置开机自启
sudo systemctl enable nginx
```

## 八、配置 HTTPS（SSL 证书）

### 使用 Let's Encrypt 免费证书

```bash
# 安装 Certbot
sudo apt install -y certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-domain.com

# 自动续期测试
sudo certbot renew --dry-run
```

### 手动配置（已有证书）

编辑配置文件：

```bash
sudo nano /etc/nginx/sites-available/xuanjian-guild
```

修改为：

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;  # HTTP 重定向到 HTTPS
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    # SSL 证书
    ssl_certificate /path/to/your/fullchain.pem;
    ssl_certificate_key /path/to/your/privkey.pem;
    
    # SSL 优化
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    
    # 日志
    access_log /var/log/nginx/xuanjian-guild-access.log;
    error_log /var/log/nginx/xuanjian-guild-error.log;
    
    client_max_body_size 50M;
    
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

然后重启 Nginx：

```bash
sudo nginx -t
sudo systemctl restart nginx
```

## 九、防火墙配置

### 使用 UFW（Ubuntu）

```bash
# 查看状态
sudo ufw status

# 允许 SSH
sudo ufw allow 22/tcp

# 允许 HTTP 和 HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 允许应用端口（可选）
sudo ufw allow 3000/tcp

# 启用防火墙
sudo ufw enable

# 查看状态
sudo ufw status verbose
```

### 使用 FirewallD（CentOS）

```bash
# 允许 HTTP 和 HTTPS
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https

# 重载
sudo firewall-cmd --reload

# 查看状态
sudo firewall-cmd --list-all
```

## 十、云服务器安全组配置

### 阿里云 ECS

1. 登录阿里云控制台
2. 进入 **ECS 实例** → **安全组**
3. 添加安全组规则：
   - 入方向：允许 80/443/3000 端口

### 腾讯云 CVM

1. 登录腾讯云控制台
2. 进入 **安全组** → **修改规则**
3. 添加入站规则：允许 80/443/3000 端口

## 十一、访问网站

部署完成后，可以通过以下地址访问：

- **HTTP**: http://your-domain.com 或 http://服务器IP
- **HTTPS**: https://your-domain.com（配置 SSL 后）
- **直接访问**: http://服务器IP:3000

## 十二、日常管理

### 查看应用状态

```bash
# PM2 状态
pm2 status

# 查看日志
pm2 logs xuanjian-guild

# Nginx 状态
sudo systemctl status nginx
```

### 重启服务

```bash
# 重启应用
pm2 restart xuanjian-guild

# 重启 Nginx
sudo systemctl restart nginx
```

### 更新部署

```bash
# 进入项目目录
cd /var/www/xuanjian-guild

# 拉取最新代码（如果使用 git）
git pull

# 或者重新上传文件

# 安装新依赖
npm install --production

# 重启应用
pm2 restart xuanjian-guild
```

## 十三、备份策略

### 创建备份脚本

```bash
sudo nano /var/backup/backup.sh
```

添加内容：

```bash
#!/bin/bash

BACKUP_DIR="/var/backup/xuanjian-guild"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# 备份数据库
cp /var/www/xuanjian-guild/data/guild.db $BACKUP_DIR/guild_$DATE.db

# 备份上传文件
tar -czvf $BACKUP_DIR/uploads_$DATE.tar.gz -C /var/www/xuanjian-guild data/uploads/

# 删除 7 天前的备份
find $BACKUP_DIR -name "*.db" -mtime +7 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete

echo "备份完成: $DATE"
```

设置定时任务：

```bash
chmod +x /var/backup/backup.sh

# 编辑 crontab
crontab -e

# 添加每天凌晨 2 点备份
0 2 * * * /var/backup/backup.sh >> /var/log/backup.log 2>&1
```

## 十四、故障排查

### 1. 无法访问网站

检查清单：

```bash
# 1. 检查应用是否运行
pm2 status

# 2. 检查端口监听
netstat -tlnp | grep 3000
# 或
ss -tlnp | grep 3000

# 3. 检查 Nginx 配置
sudo nginx -t

# 4. 查看 Nginx 错误日志
sudo tail -f /var/log/nginx/error.log

# 5. 查看防火墙
sudo ufw status

# 6. 检查安全组（云服务器）
```

### 2. 502 Bad Gateway

```bash
# 检查应用是否崩溃
pm2 logs xuanjian-guild

# 重启应用
pm2 restart xuanjian-guild
```

### 3. 图片无法显示

```bash
# 检查上传目录权限
ls -la /var/www/xuanjian-guild/data/uploads/

# 修复权限
sudo chmod -R 755 /var/www/xuanjian-guild/data/uploads/
```

### 4. 端口被占用

```bash
# 查看端口占用
sudo lsof -i :3000

# 结束占用进程
sudo kill -9 <PID>

# 或修改应用端口
nano /var/www/xuanjian-guild/.env
# 修改 PORT=3001

# 然后修改 Nginx 配置中的代理端口
```

## 十五、性能优化

### 1. 启用 Gzip 压缩

编辑 `/etc/nginx/nginx.conf`：

```nginx
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_types text/plain text/css text/xml application/json application/javascript;
```

然后重启 Nginx：

```bash
sudo systemctl restart nginx
```

### 2. 配置缓存

在 Nginx 站点配置中添加：

```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
    proxy_pass http://127.0.0.1:3000;
    expires 30d;
    add_header Cache-Control "public, immutable";
}
```

---

**部署完成后，访问 http://your-domain.com 即可使用网站！**
