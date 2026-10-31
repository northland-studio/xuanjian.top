#!/bin/bash
echo "=== 二维码文件状态 ==="
ls -la /opt/napcat-admin/qq/napcat/cache/qrcode.png 2>/dev/null
echo "=== 最近日志（找刷新/过期）==="
pm2 logs napcat-admin --lines 40 --nostream 2>/dev/null | tail -14 | cut -c1-160
echo "=== base64 ==="
base64 -w0 /opt/napcat-admin/qq/napcat/cache/qrcode.png 2>/dev/null | head -c 300000
echo
echo "=== 端口 ==="
ss -lntp 2>/dev/null | grep -E ':(3002|6100)' | head -3 || echo "  3002/6100 未监听"
