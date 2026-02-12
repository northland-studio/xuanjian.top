# 宝塔面板部署指南

## 一、准备工作

### 1. 登录宝塔面板
- 打开浏览器访问：`http://服务器IP:8888`
- 输入用户名和密码登录

### 2. 安装必要软件
在宝塔面板的 **软件商店** 中安装：
- ✅ Nginx（推荐 1.20+）
- ✅ PM2管理器（用于运行Node.js）
- ✅ Node.js版本管理器（安装Node.js 18）

## 二、上传项目文件

### 方法一：使用宝塔文件管理器

1. 进入宝塔面板 → **文件**
2. 进入 `/www/wwwroot/` 目录
3. 点击 **上传**，选择项目压缩包上传
4. 右键压缩包 → **解压**

### 方法二：使用SFTP（推荐）

```bash
# 在本地打包项目（排除 node_modules）
cd h:\程序源码夹\官网
tar -czvf xuanjian-guild.tar.gz --exclude='node_modules' --exclude='data' --exclude='.git' .

# 使用SFTP工具（如FileZilla）上传到服务器
# 上传到 /www/wwwroot/xuanjian-guild/
```

## 三、配置Node.js环境

### 1. 安装Node.js 18

在宝塔面板中：
1. 打开 **终端**
2. 执行以下命令：

```bash
# 安装Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# 验证安装
node -v
npm -v
```

### 2. 安装项目依赖

```bash
cd /www/wwwroot/xuanjian-guild
npm install --production
```

### 3. 初始化数据库

```bash
npm run init-db
```

### 4. 配置环境变量

```bash
cp .env.example .env
nano .env
```

编辑内容：
```env
PORT=3000
NODE_ENV=production
JWT_SECRET=your-super-secret-key-change-this
ADMIN_PASSWORD=your-admin-password
```

## 四、使用PM2启动项目

### 方法一：宝塔PM2管理器（推荐）

1. 进入宝塔面板 → **软件商店** → 找到 **PM2管理器**
2. 点击 **设置** → **添加项目**
3. 填写信息：
   - **项目名称**：xuanjian-guild
   - **项目路径**：`/www/wwwroot/xuanjian-guild`
   - **启动文件**：`server.js`
   - **端口**：`3000`
4. 点击 **提交**

### 方法二：命令行启动

```bash
cd /www/wwwroot/xuanjian-guild

# 使用PM2启动
pm2 start server.js --name "xuanjian-guild"

# 保存配置
pm2 save

# 查看状态
pm2 status
```

## 五、配置Nginx反向代理

### 1. 创建网站

1. 进入宝塔面板 → **网站**
2. 点击 **添加站点**
3. 填写信息：
   - **域名**：填写你的域名（如 `your-domain.com`），如果没有域名可以填写服务器IP
   - **根目录**：`/www/wwwroot/xuanjian-guild/public`（或保持默认）
   - **PHP版本**：选择 **纯静态**
4. 点击 **提交**

### 2. 配置反向代理

1. 在网站列表中找到刚创建的网站
2. 点击 **设置** → **反向代理**
3. 点击 **添加反向代理**
4. 填写信息：
   - **代理名称**：xuanjian-guild
   - **目标URL**：`http://127.0.0.1:3000`
   - **发送域名**：`$host`
5. 点击 **提交**

### 3. 配置文件详解（可选）

如需手动修改，点击 **配置文件**：

```nginx
server {
    listen 80;
    server_name your-domain.com;  # 你的域名
    
    # 日志
    access_log /www/wwwlogs/xuanjian-guild.log;
    error_log /www/wwwlogs/xuanjian-guild.error.log;
    
    # 文件上传大小限制
    client_max_body_size 50M;
    
    # 反向代理
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
    
    # 静态文件缓存（可选）
    location /uploads/ {
        proxy_pass http://127.0.0.1:3000/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

## 六、配置HTTPS（SSL证书）

### 方法一：使用宝塔免费证书（推荐）

1. 在网站列表中点击 **设置**
2. 选择 **SSL** → **Let's Encrypt**
3. 勾选域名，点击 **申请**
4. 开启 **强制HTTPS**（可选）

### 方法二：使用自己的证书

1. 选择 **SSL** → **其他证书**
2. 粘贴证书内容（.crt文件内容）和密钥内容（.key文件内容）
3. 点击 **保存**

## 七、防火墙和安全组配置

### 1. 宝塔防火墙

1. 进入宝塔面板 → **安全**
2. 放行以下端口：
   - ✅ 80/80 (HTTP)
   - ✅ 443/443 (HTTPS)
   - ✅ 3000/3000 (Node.js应用，可选)
   - ✅ 8888/8888 (宝塔面板，默认已放行)

### 2. 云服务器安全组

**阿里云ECS：**
1. 登录阿里云控制台
2. 进入 **ECS实例** → **安全组**
3. 添加安全组规则：
   - 入方向：允许 80/443/3000 端口

**腾讯云CVM：**
1. 登录腾讯云控制台
2. 进入 **安全组** → **修改规则**
3. 添加入站规则：允许 80/443/3000 端口

## 八、域名解析

在你的域名服务商处添加解析记录：

| 记录类型 | 主机记录 | 记录值 | TTL |
|---------|---------|--------|-----|
| A | @ | 你的服务器IP | 600 |
| A | www | 你的服务器IP | 600 |

## 九、访问网站

部署完成后，可以通过以下地址访问：

- **HTTP**: http://your-domain.com
- **HTTPS**: https://your-domain.com（配置SSL后）
- **IP访问**: http://服务器IP

## 十、日常管理

### 查看应用状态

1. **宝塔PM2管理器**：
   - 进入 **软件商店** → **PM2管理器** → **设置**
   - 可以看到所有运行中的Node.js项目

2. **命令行**：
   ```bash
   pm2 status
   pm2 logs xuanjian-guild
   ```

### 重启应用

1. **宝塔面板**：
   - PM2管理器 → 找到项目 → 点击 **重启**

2. **命令行**：
   ```bash
   pm2 restart xuanjian-guild
   ```

### 查看日志

1. **应用日志**：
   ```bash
   pm2 logs xuanjian-guild
   ```

2. **Nginx日志**：
   - 宝塔面板 → **网站** → 找到网站 → **日志**

## 十一、备份配置

### 1. 数据库备份

```bash
# 手动备份
cp /www/wwwroot/xuanjian-guild/data/guild.db /www/backup/guild_$(date +%Y%m%d).db
```

### 2. 宝塔自动备份

1. 宝塔面板 → **计划任务**
2. 点击 **添加计划任务**
3. 选择 **备份网站** 或 **备份数据库**
4. 设置执行周期（如每天凌晨2点）

## 十二、故障排查

### 1. 网站无法访问

检查清单：
- [ ] PM2中应用是否运行中
- [ ] Nginx配置是否正确
- [ ] 宝塔防火墙是否放行80/443端口
- [ ] 云服务器安全组是否放行
- [ ] 域名解析是否正确

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
ls -la /www/wwwroot/xuanjian-guild/data/uploads/

# 修复权限
chmod -R 755 /www/wwwroot/xuanjian-guild/data/uploads/
```

### 4. 端口被占用

```bash
# 查看3000端口占用
netstat -tlnp | grep 3000

# 修改应用端口（编辑.env文件）
PORT=3001

# 然后重启应用并修改Nginx反向代理配置
```

## 十三、性能优化建议

### 1. 启用Gzip压缩

在Nginx配置中添加：
```nginx
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_types text/plain text/css text/xml application/json application/javascript;
```

### 2. 配置缓存

宝塔面板 → **网站** → **设置** → **反向代理** → **缓存**
- 开启反向代理缓存
- 设置缓存时间（如30分钟）

---

**部署完成后，访问 http://your-domain.com 即可使用网站！**
