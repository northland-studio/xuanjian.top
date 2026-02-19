#!/bin/bash
# 检查服务器配置状态

echo "=== 检查 Nginx 配置 ==="
echo "1. 测试配置语法:"
nginx -t

echo -e "\n2. 当前启用的站点:"
ls -la /etc/nginx/sites-enabled/

echo -e "\n3. Nginx 运行状态:"
systemctl status nginx --no-pager

echo -e "\n4. 监听端口:"
netstat -tlnp | grep -E 'nginx|3000'

echo -e "\n5. PM2 状态:"
pm2 status

echo -e "\n6. 测试 API 访问:"
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/posts/public-stats
echo " (本地)"
curl -s -o /dev/null -w "%{http_code}" http://115.190.153.44/api/posts/public-stats
echo " (公网)"

echo -e "\n7. 测试 CORS 头:"
curl -I -H "Origin: http://localhost" http://115.190.153.44/api/posts/public-stats 2>/dev/null | grep -i "access-control"

echo -e "\n8. Nginx 错误日志 (最近5行):"
tail -5 /var/log/nginx/xuanjian.error.log

echo -e "\n9. 当前 default 配置内容:"
cat /etc/nginx/sites-enabled/default 2>/dev/null | head -30
