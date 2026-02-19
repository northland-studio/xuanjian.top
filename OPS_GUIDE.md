# 玄剑公会官网运维手册

本文档提供玄剑公会官网的完整运维指南，包括服务管理、数据备份、故障排查等内容。

---

## 📋 目录

- [服务器信息](#服务器信息)
- [服务管理](#服务管理)
- [数据备份](#数据备份)
- [日志管理](#日志管理)
- [故障排查](#故障排查)
- [安全配置](#安全配置)
- [性能优化](#性能优化)
- [更新部署](#更新部署)

---

## 🖥️ 服务器信息

| 项目 | 信息 |
|------|------|
| **服务器系统** | Ubuntu 24.04 LTS |
| **项目目录** | `/var/www/xuanjian-guild/` |
| **数据目录** | `/var/www/xuanjian-guild/data/` |
| **备份目录** | `/var/beifen/` |
| **域名** | xuanjian.top |
| **备用IP** | 115.190.153.44 |

---

## ⚙️ 服务管理

### PM2 进程管理

```bash
# 查看应用状态
pm2 status

# 查看应用详情
pm2 show xuanjian-guild

# 启动应用
pm2 start server.js --name "xuanjian-guild"

# 重启应用
pm2 restart xuanjian-guild

# 停止应用
pm2 stop xuanjian-guild

# 查看实时日志
pm2 logs xuanjian-guild

# 查看最近日志
pm2 logs xuanjian-guild --lines 100

# 清空日志
pm2 flush

# 保存当前进程列表
pm2 save

# 设置开机自启
pm2 startup
```

### Nginx 管理

```bash
# 检查配置
sudo nginx -t

# 重载配置
sudo systemctl reload nginx

# 重启服务
sudo systemctl restart nginx

# 查看状态
sudo systemctl status nginx

# 查看访问日志
tail -f /var/log/nginx/access.log

# 查看错误日志
tail -f /var/log/nginx/error.log
```

### Node.js 服务

```bash
# 查看 Node 版本
node -v

# 查看 npm 版本
npm -v

# 更新依赖
cd /var/www/xuanjian-guild
npm install --production
```

---

## 💾 数据备份

### 自动备份系统

系统已配置自动备份，每天凌晨 3:00 执行。

```bash
# 查看备份定时器状态
systemctl status xuanjian-backup.timer

# 查看所有定时任务
systemctl list-timers

# 手动执行备份
systemctl start xuanjian-backup.service

# 查看备份日志
tail -f /var/log/xuanjian-backup.log

# 查看备份文件列表
ls -lh /var/beifen/
```

### 备份配置

| 配置项 | 值 |
|--------|-----|
| 备份时间 | 每天 03:00 |
| 备份源 | `/var/www/xuanjian-guild/data/` |
| 备份目标 | `/var/beifen/` |
| 保留天数 | 30 天 |
| 日志文件 | `/var/log/xuanjian-backup.log` |

### 手动备份

```bash
# 创建手动备份
cd /var/www/xuanjian-guild
tar -czf /var/beifen/manual_backup_$(date +%Y%m%d_%H%M%S).tar.gz data/

# 验证备份
tar -tzf /var/beifen/manual_backup_*.tar.gz
```

### 数据恢复

```bash
# 1. 停止应用
pm2 stop xuanjian-guild

# 2. 备份当前数据
mv /var/www/xuanjian-guild/data /var/www/xuanjian-guild/data.bak

# 3. 解压备份
tar -xzf /var/beifen/xuanjian_backup_YYYYMMDD_HHMMSS.tar.gz -C /var/www/xuanjian-guild/

# 4. 重启应用
pm2 start xuanjian-guild
```

---

## 📝 日志管理

### 日志位置

| 日志类型 | 路径 |
|----------|------|
| PM2 日志 | `~/.pm2/logs/` |
| Nginx 访问日志 | `/var/log/nginx/access.log` |
| Nginx 错误日志 | `/var/log/nginx/error.log` |
| 备份日志 | `/var/log/xuanjian-backup.log` |
| 系统日志 | `/var/log/syslog` |

### 日志查看命令

```bash
# 实时查看 PM2 日志
pm2 logs xuanjian-guild

# 查看 Nginx 访问日志（最近 100 行）
tail -100 /var/log/nginx/access.log

# 查看 Nginx 错误日志
tail -100 /var/log/nginx/error.log

# 搜索特定 IP 的访问记录
grep "183.227.38.27" /var/log/nginx/access.log

# 搜索特定时间段的日志
grep "16/Feb/2026" /var/log/nginx/access.log

# 统计访问量
awk '{print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head -10
```

### 日志清理

```bash
# 清空 PM2 日志
pm2 flush

# 清理旧日志（保留最近 7 天）
find /var/log/nginx -name "*.log" -mtime +7 -delete

# 清理备份日志（保留最近 30 天）
find /var/log -name "xuanjian-backup.log" -mtime +30 -delete
```

---

## 🔧 故障排查

### 网站无法访问

```bash
# 1. 检查 Nginx 状态
sudo systemctl status nginx

# 2. 检查 Node.js 应用状态
pm2 status

# 3. 检查端口占用
sudo netstat -tlnp | grep -E '80|3000'

# 4. 检查防火墙
sudo ufw status

# 5. 测试本地访问
curl http://localhost
curl http://localhost:3000
```

### 502 Bad Gateway

```bash
# 1. 检查 Node.js 应用是否运行
pm2 status

# 2. 重启应用
pm2 restart xuanjian-guild

# 3. 检查应用日志
pm2 logs xuanjian-guild --lines 50

# 4. 检查 Nginx 配置
sudo nginx -t
```

### 上传失败

```bash
# 1. 检查上传目录权限
ls -la /var/www/xuanjian-guild/data/uploads/

# 2. 修复权限
sudo chown -R www-data:www-data /var/www/xuanjian-guild/data/uploads/
sudo chmod -R 755 /var/www/xuanjian-guild/data/uploads/

# 3. 检查磁盘空间
df -h

# 4. 检查 Nginx 上传限制
grep client_max_body_size /etc/nginx/sites-available/xuanjian-guild
```

### 数据库错误

```bash
# 1. 检查数据库文件
ls -la /var/www/xuanjian-guild/data/guild.db

# 2. 检查数据库完整性
sqlite3 /var/www/xuanjian-guild/data/guild.db "PRAGMA integrity_check;"

# 3. 从备份恢复
pm2 stop xuanjian-guild
cp /var/beifen/latest/data/guild.db /var/www/xuanjian-guild/data/
pm2 start xuanjian-guild
```

---

## 🔒 安全配置

### 防火墙配置

```bash
# 查看防火墙状态
sudo ufw status

# 开放必要端口
sudo ufw allow 22      # SSH
sudo ufw allow 80      # HTTP
sudo ufw allow 443     # HTTPS

# 启用防火墙
sudo ufw enable
```

### SSH 安全

```bash
# 修改 SSH 端口（可选）
sudo nano /etc/ssh/sshd_config
# Port 22 改为其他端口

# 重启 SSH 服务
sudo systemctl restart sshd
```

### SSL 证书管理

```bash
# 检查证书状态
sudo certbot certificates

# 手动续期
sudo certbot renew

# 测试续期
sudo certbot renew --dry-run
```

### 定期安全更新

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装安全更新
sudo apt install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

---

## ⚡ 性能优化

### Nginx 优化

```nginx
# /etc/nginx/nginx.conf
worker_processes auto;
worker_connections 1024;

# 启用 Gzip 压缩
gzip on;
gzip_types text/plain text/css application/json application/javascript text/xml;

# 静态文件缓存
location ~* \.(jpg|jpeg|png|gif|ico|css|js)$ {
    expires 7d;
    add_header Cache-Control "public, immutable";
}
```

### Node.js 优化

```bash
# 设置内存限制
pm2 start server.js --name "xuanjian-guild" --max-memory-restart 1G

# 集群模式（多核 CPU）
pm2 start server.js --name "xuanjian-guild" -i max
```

### 数据库优化

```bash
# 定期清理过期数据
sqlite3 /var/www/xuanjian-guild/data/guild.db "VACUUM;"

# 分析数据库
sqlite3 /var/www/xuanjian-guild/data/guild.db "ANALYZE;"
```

---

## 🔄 更新部署

### 常规更新

```bash
# 1. 备份数据
systemctl start xuanjian-backup.service

# 2. 拉取最新代码
cd /var/www/xuanjian-guild
git pull

# 3. 更新依赖
npm install --production

# 4. 重启应用
pm2 restart xuanjian-guild

# 5. 验证
curl http://localhost:3000
```

### 完整部署

```bash
# 1. 停止应用
pm2 stop xuanjian-guild

# 2. 备份数据
cp -r /var/www/xuanjian-guild/data /var/beifen/pre_update_$(date +%Y%m%d)

# 3. 上传新代码
# (使用 scp 或其他方式)

# 4. 安装依赖
cd /var/www/xuanjian-guild
npm install --production

# 5. 设置权限
sudo chown -R www-data:www-data /var/www/xuanjian-guild

# 6. 启动应用
pm2 start xuanjian-guild

# 7. 验证
curl http://localhost
```

---

## 📞 联系方式

如有问题，请联系：

- **邮箱**: xuanjian_guild@xuanjian.top
- **QQ群**: 见官网首页

---

*最后更新: 2026-02-16*
