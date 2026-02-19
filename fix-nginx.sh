#!/bin/bash
# 修复 Nginx 配置脚本

echo "=== 修复 Nginx 配置 ==="

# 1. 备份并删除有问题的 default 配置
if [ -f /etc/nginx/sites-enabled/default ]; then
    echo "备份 default 配置..."
    cp /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/default.bak
    rm /etc/nginx/sites-enabled/default
fi

if [ -f /etc/nginx/sites-available/default ]; then
    echo "备份 sites-available/default..."
    cp /etc/nginx/sites-available/default /etc/nginx/sites-available/default.bak
    rm /etc/nginx/sites-available/default
fi

# 2. 确保我们的配置存在
if [ ! -f /etc/nginx/sites-available/xuanjian ]; then
    echo "错误: xuanjian 站点配置不存在"
    exit 1
fi

# 3. 创建软链接
ln -sf /etc/nginx/sites-available/xuanjian /etc/nginx/sites-enabled/xuanjian

# 4. 测试配置
echo "测试 Nginx 配置..."
nginx -t

if [ $? -eq 0 ]; then
    echo "配置测试通过，重载 Nginx..."
    systemctl reload nginx
    echo "=== 修复完成 ==="
else
    echo "配置测试失败，请检查错误"
    exit 1
fi
