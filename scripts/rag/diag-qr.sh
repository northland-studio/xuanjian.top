#!/bin/bash
set -u
echo "=== 1. 服务报错原文 ==="
SECRET=$(cat /opt/notice-qr/secret.txt)
curl -s --max-time 20 "http://127.0.0.1:3911/$SECRET.png" | head -c 300
echo
echo "=== 2. 手动执行 ssh 读取（验证密钥/连通）==="
timeout 15 ssh -i /root/.ssh/id_napcat -p 20043 -o StrictHostKeyChecking=no -o ConnectTimeout=6 -o BatchMode=yes root@43.248.3.161 \
  'ls -la /opt/napcat-admin/qq/napcat/cache/qrcode.png; base64 -w0 /opt/napcat-admin/qq/napcat/cache/qrcode.png | head -c 60' 2>&1 | head -5
echo
echo "=== 3. nginx 是否含 qr-admin ==="
nginx -T 2>/dev/null | grep -c 'qr-admin' || echo 0
echo "--- 配置片段 ---"
nginx -T 2>/dev/null | grep -A6 'qr-admin' | head -12
echo
echo "=== 4. notice 站点配置文件路径 ==="
ls -la /etc/nginx/sites-enabled/notice.xuanjian.top
grep -n 'location' /etc/nginx/sites-enabled/notice.xuanjian.top | head -8
