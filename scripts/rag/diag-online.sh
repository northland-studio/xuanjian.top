#!/bin/bash
# 诊断：官网「在线人数」为什么显示 0
cd /var/www/xuanjian-guild || exit 1

echo "=== 1. 环境变量 MC_* ==="
grep -E '^MC_' .env 2>/dev/null | sed -E 's/(PASSWORD[^=]*=).*/\1****/' || echo "  （未配置）"

echo
echo "=== 2. 白名单表（mod 上报用）==="
sqlite3 data/guild.db "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%white%' OR name LIKE '%mod%');"
echo "--- 白名单内容 ---"
sqlite3 data/guild.db "SELECT * FROM mod_server_whitelist;" 2>/dev/null || sqlite3 data/guild.db "SELECT * FROM server_whitelist;" 2>/dev/null || echo "  表名待确认"

echo
echo "=== 3. mod 在线上报记录 ==="
sqlite3 data/guild.db "SELECT COUNT(*) AS 在线记录数 FROM mod_online;" 2>/dev/null || echo "  无 mod_online 表"
sqlite3 data/guild.db "SELECT server_ip, COUNT(*) FROM mod_online GROUP BY server_ip;" 2>/dev/null
echo "--- 最近上报时间（若有大表）---"
sqlite3 data/guild.db "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%report%';" 2>/dev/null

echo
echo "=== 4. /api/mc/status 实际返回 ==="
curl -s --max-time 20 "http://127.0.0.1:3000/api/mc/status?server=s115" | head -c 400; echo

echo
echo "=== 5. /api/mod/online 实际返回 ==="
curl -s --max-time 20 "http://127.0.0.1:3000/api/mod/online" | head -c 300; echo

echo
echo "=== 6. 首页在线人数用的接口（前端）==="
grep -roh "api/[a-z/-]*\(status\|online\)[a-z/?=&]*" frontend/src --include=*.jsx 2>/dev/null | sort -u | head -10
