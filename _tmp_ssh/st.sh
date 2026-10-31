#!/bin/bash
echo "=== 登录状态 ==="
ss -lntp 2>/dev/null | grep -E ':(3002|6100)' | head -3
TOKEN=$(cat /opt/napcat-admin/onebot-token.txt 2>/dev/null)
echo -n "  get_login_info: "
curl -s --max-time 8 -X POST "http://127.0.0.1:3002/get_login_info" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{}' | head -c 220
echo
echo "  最近日志："
pm2 logs napcat-admin --lines 20 --nostream 2>/dev/null | grep -aE '登录成功|上线|online|接收' | tail -3 | cut -c1-120