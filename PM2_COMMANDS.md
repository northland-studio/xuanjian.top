# PM2 常用维护指令

## 基础命令

### 启动应用
```bash
# 启动应用
pm2 start server.js

# 指定名称启动
pm2 start server.js --name "xuanjian-guild"

# 启动多个实例（负载均衡）
pm2 start server.js -i max
```

### 停止应用
```bash
# 停止指定应用
pm2 stop xuanjian-guild

# 停止所有应用
pm2 stop all
```

### 重启应用
```bash
# 重启指定应用
pm2 restart xuanjian-guild

# 重启所有应用
pm2 restart all

# 零停机重启（平滑重启）
pm2 reload xuanjian-guild
```

### 删除应用
```bash
# 删除指定应用
pm2 delete xuanjian-guild

# 删除所有应用
pm2 delete all
```

## 查看状态

### 列表查看
```bash
# 查看所有应用状态
pm2 status
pm2 list
pm2 ls

# 查看指定应用详情
pm2 describe xuanjian-guild
```

### 实时监控
```bash
# 实时监控面板
pm2 monit

# 查看日志（实时）
pm2 logs

# 查看指定应用日志
pm2 logs xuanjian-guild

# 查看最近100行日志
pm2 logs xuanjian-guild --lines 100

# 只查看错误日志
pm2 logs xuanjian-guild --err
```

## 日志管理

### 查看日志
```bash
# 查看所有日志
pm2 logs

# 查看指定应用日志
pm2 logs xuanjian-guild

# 查看最近200行
pm2 logs --lines 200

# 清空日志
pm2 flush

# 清空指定应用日志
pm2 flush xuanjian-guild
```

### 日志文件位置
```bash
# 查看日志文件路径
pm2 show xuanjian-guild

# 默认日志位置
/root/.pm2/logs/
```

## 配置管理

### 保存和恢复
```bash
# 保存当前进程列表
pm2 save

# 开机自启设置
pm2 startup

# 取消开机自启
pm2 unstartup
```

### 配置文件（ecosystem.config.js）
```javascript
module.exports = {
  apps: [{
    name: 'xuanjian-guild',
    script: './server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
```

使用配置文件：
```bash
# 启动
pm2 start ecosystem.config.js

# 重启
pm2 restart ecosystem.config.js

# 重载
pm2 reload ecosystem.config.js
```

## 高级功能

### 环境变量
```bash
# 启动时指定环境变量
pm2 start server.js --name "app" --env production

# 查看环境变量
pm2 env xuanjian-guild
```

### 内存和性能
```bash
# 查看内存使用
pm2 status

# 查看详细性能信息
pm2 describe xuanjian-guild

# 设置内存限制（超过自动重启）
pm2 start server.js --max-memory-restart 500M
```

### 集群模式
```bash
# 启动4个实例
pm2 start server.js -i 4

# 根据CPU核心数启动
pm2 start server.js -i max

# 扩展实例数
pm2 scale xuanjian-guild +2

# 减少到2个实例
pm2 scale xuanjian-guild 2
```

## 更新部署

### 简单更新
```bash
# 拉取代码后重启
cd /var/www/xuanjian-guild
git pull
pm2 restart xuanjian-guild
```

### 零停机部署
```bash
# 重载应用（不中断服务）
pm2 reload xuanjian-guild

# 或者使用 ecosystem 配置
cd /var/www/xuanjian-guild
git pull
pm2 reload ecosystem.config.js
```

## 故障排查

### 查看错误
```bash
# 查看错误日志
pm2 logs xuanjian-guild --err

# 查看应用详情
pm2 describe xuanjian-guild

# 查看进程信息
pm2 show xuanjian-guild
```

### 重启卡住时
```bash
# 强制重启
pm2 restart xuanjian-guild --force

# 先删除再启动
pm2 delete xuanjian-guild
pm2 start server.js --name "xuanjian-guild"
```

## 常用组合命令

### 日常维护
```bash
# 快速查看状态
pm2 status

# 查看日志（最近20行）
pm2 logs xuanjian-guild --lines 20

# 重启应用
pm2 restart xuanjian-guild

# 保存配置
pm2 save
```

### 完整重启流程
```bash
# 1. 停止
pm2 stop xuanjian-guild

# 2. 更新代码（如果需要）
cd /var/www/xuanjian-guild
git pull
npm install --production

# 3. 启动
pm2 start server.js --name "xuanjian-guild"

# 4. 查看状态
pm2 status

# 5. 查看日志
pm2 logs xuanjian-guild --lines 50

# 6. 保存
pm2 save
```

## 快捷键

在 `pm2 monit` 监控界面中：
- `q` - 退出
- `↑/↓` - 切换应用
- `Enter` - 查看详情

## 常见问题

### 1. 应用不断重启
```bash
# 查看错误日志
pm2 logs xuanjian-guild --err

# 可能是端口被占用或代码错误
```

### 2. 内存占用过高
```bash
# 设置内存限制
pm2 restart xuanjian-guild --max-memory-restart 500M
```

### 3. 日志文件太大
```bash
# 清空日志
pm2 flush

# 或者手动删除
rm -f /root/.pm2/logs/*
```

### 4. PM2 自身出问题
```bash
# 杀死 PM2 守护进程
pm2 kill

# 重新启动应用
pm2 start server.js --name "xuanjian-guild"
```

## 完整示例

```bash
# 部署新应用
cd /var/www/xuanjian-guild
pm2 start server.js --name "xuanjian-guild" --max-memory-restart 500M
pm2 save
pm2 startup

# 日常查看
pm2 status                    # 查看状态
pm2 logs --lines 50           # 查看日志
pm2 monit                     # 实时监控

# 更新部署
cd /var/www/xuanjian-guild
git pull                      # 拉取新代码
npm install --production      # 安装依赖
pm2 reload xuanjian-guild     # 零停机重载
pm2 save                      # 保存配置

# 故障排查
pm2 logs xuanjian-guild --err # 查看错误
pm2 describe xuanjian-guild   # 查看详情
pm2 restart xuanjian-guild    # 重启应用
```
