# 修复大文件上传导致的 502 错误

## 问题原因

1. **Nginx 上传大小限制** - 默认可能只有 1MB
2. **Node.js 内存不足** - 处理大文件时崩溃
3. **上传超时** - 大文件上传时间太长

## 解决方案

### 1. 修改 Nginx 配置

```bash
sudo nano /etc/nginx/sites-available/xuanjian-guild
```

在 server 块中添加：

```nginx
server {
    listen 80;
    server_name xuanjian.top;
    
    # 增加上传大小限制（50MB）
    client_max_body_size 50M;
    
    # 增加超时时间
    proxy_connect_timeout 600s;
    proxy_send_timeout 600s;
    proxy_read_timeout 600s;
    
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

测试并重载：
```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 2. 修改 Node.js 上传限制

检查 `routes/upload.js`：

```javascript
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB
        files: 5 // 最多5个文件
    },
    fileFilter: fileFilter
});
```

### 3. 增加 PM2 内存限制

```bash
# 重启应用，增加内存限制
pm2 delete xuanjian-guild
pm2 start server.js --name "xuanjian-guild" --max-memory-restart 1G
pm2 save
```

### 4. 一键修复脚本

```bash
sudo tee /var/www/fix-upload.sh << 'EOF'
#!/bin/bash

echo "=== 修复大文件上传问题 ==="

# 1. 修改 Nginx 配置
echo "1. 修改 Nginx 配置..."
sudo tee /etc/nginx/sites-available/xuanjian-guild << 'NGINX'
server {
    listen 80;
    server_name xuanjian.top;
    
    # 上传大小限制 50MB
    client_max_body_size 50M;
    
    # 超时时间
    proxy_connect_timeout 600s;
    proxy_send_timeout 600s;
    proxy_read_timeout 600s;
    
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
NGINX

# 2. 测试 Nginx 配置
echo "2. 测试 Nginx 配置..."
sudo nginx -t

if [ $? -eq 0 ]; then
    sudo systemctl reload nginx
    echo "   Nginx 配置已更新"
else
    echo "   Nginx 配置有误"
    exit 1
fi

# 3. 重启 Node.js 应用（增加内存）
echo "3. 重启应用..."
cd /var/www/xuanjian-guild
pm2 delete xuanjian-guild 2>/dev/null
pm2 start server.js --name "xuanjian-guild" --max-memory-restart 1G
pm2 save

# 4. 检查状态
echo "4. 检查状态..."
pm2 status
sudo systemctl status nginx --no-pager

echo ""
echo "=== 修复完成 ==="
echo "现在可以上传最大 50MB 的文件"
EOF

chmod +x /var/www/fix-upload.sh
/var/www/fix-upload.sh
```

## 检查应用状态

```bash
# 查看 PM2 日志
pm2 logs xuanjian-guild --lines 50

# 查看 Nginx 错误日志
sudo tail -50 /var/log/nginx/error.log

# 测试上传
curl -X POST http://localhost:3000/api/upload/image \
  -F "image=@/path/to/test.jpg" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 预防措施

### 1. 前端添加文件大小检查

在编辑器页面添加：

```javascript
// 上传前检查文件大小
function checkFileSize(file) {
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
        showToast('文件大小不能超过 50MB', 'error');
        return false;
    }
    return true;
}
```

### 2. 图片压缩

建议在上传前压缩图片：

```javascript
// 使用 canvas 压缩图片
function compressImage(file, maxWidth = 1920) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                let width = img.width;
                let height = img.height;
                
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }
                
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                
                canvas.toBlob((blob) => {
                    resolve(new File([blob], file.name, { type: file.type }));
                }, file.type, 0.8);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}
```

## 快速修复命令

```bash
# 1. 立即重启应用
pm2 restart xuanjian-guild

# 2. 查看错误日志
pm2 logs xuanjian-guild --err

# 3. 如果还是 502，强制重启
pm2 delete xuanjian-guild
pm2 start server.js --name "xuanjian-guild"
```

执行上面的修复脚本后，网站应该就能正常访问了！
