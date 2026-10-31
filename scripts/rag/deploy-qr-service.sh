#!/bin/bash
# HK 部署：管理员号 QQ 实时二维码服务 + nginx 反代
set -eu
DIR=/opt/notice-qr
SECRET_FILE=$DIR/secret.txt

echo "=== 1. 建立目录与密钥 ==="
mkdir -p "$DIR"
if [ ! -f "$SECRET_FILE" ]; then
  openssl rand -hex 16 > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE"
  echo "  已生成随机路径密钥"
else
  echo "  已存在密钥"
fi
SECRET=$(cat "$SECRET_FILE")

echo
echo "=== 2. 安装服务文件 ==="
cp /root/notice-qr-server.mjs "$DIR/qr-server.mjs"
sed -i "s/change-me/$SECRET/" "$DIR/qr-server.mjs"

echo
echo "=== 3. pm2 托管 ==="
if pm2 describe notice-qr >/dev/null 2>&1; then
  pm2 restart notice-qr --update-env >/dev/null
  echo "  已重启"
else
  pm2 start "$DIR/qr-server.mjs" --name notice-qr --interpreter node >/dev/null
  echo "  已创建"
fi
pm2 save >/dev/null 2>&1 || true
sleep 2

echo
echo "=== 4. 本地自测 ==="
sleep 1
echo -n "  本地二维码响应: "
curl -s -o /tmp/qr-test.png -w '%{http_code} %{content_type} %{size_download}B\n' --max-time 20 "http://127.0.0.1:3911/$SECRET.png"
file /tmp/qr-test.png 2>/dev/null | head -1

echo
echo "=== 5. nginx 反代 /qr-admin/ ==="
NGX=/etc/nginx/sites-enabled/notice.xuanjian.top
if ! grep -q 'qr-admin' "$NGX"; then
  cp "$NGX" "$NGX.bak-$(date +%Y%m%d-%H%M%S)"
  python3 - "$NGX" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
block = '''    location /qr-admin/ {
        proxy_pass http://127.0.0.1:3911/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_read_timeout 30s;
        add_header Cache-Control "no-store" always;
    }

'''
s = s.replace('    location / {', block + '    location / {', 1)
open(p, 'w').write(s)
PY
  nginx -t >/dev/null 2>&1 && systemctl reload nginx && echo "  已添加并重载 nginx" || echo "  ⚠ nginx 配置校验失败，未重载"
else
  echo "  已存在"
fi

echo
echo "=== 6. 公网验证 ==="
echo -n "  公网二维码: "
curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}B\n' --max-time 25 "https://notice.xuanjian.top/qr-admin/$SECRET.png"
echo
echo "  ★ 二维码地址（随时打开都是最新）："
echo "  https://notice.xuanjian.top/qr-admin/$SECRET.png"
echo
echo "  该地址只读二维码，不含任何账号信息；如要作废，删除 $SECRET_FILE 并重启 notice-qr。"
