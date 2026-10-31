#!/bin/bash
echo "=== 1. 端口监听 ==="
ss -lntp 2>/dev/null | grep -E ':(3002|6100)' | head -3 || echo "  3002/6100 未监听"
echo
echo "=== 2. 进程 ==="
pm2 list 2>/dev/null | grep -E 'napcat-admin' | head -2
echo
echo "=== 3. 登录状态（OneBot get_login_info）==="
curl -s --max-time 8 -X POST http://127.0.0.1:3002/get_login_info -H 'Content-Type: application/json' -d '{}' | head -c 300
echo
echo
echo "=== 4. 日志尾部 ==="
pm2 logs napcat-admin --lines 25 --nostream 2>/dev/null | tail -12 | cut -c1-150
echo
echo "=== 5. OneBot WS 配置（找 token）==="
find /opt/napcat-admin/.config/QQ -maxdepth 5 -name 'onebot11*.json' 2>/dev/null | head -3
for f in $(find /opt/napcat-admin/.config/QQ -maxdepth 5 -name 'onebot11*.json' 2>/dev/null | head -2); do
  echo "  --- $f ---"
  cat "$f" | head -c 800
done