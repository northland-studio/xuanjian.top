#!/bin/bash
# 扫码支付 阶段 3-5 后端部署（仅 routes/pay.js，不动 server.js —— 已含 /api/pay 挂载）
set -e
APP=/var/www/xuanjian-guild
STAGE=/root/deploy-pay2-20260925
TAG=20260925-pay2-be

cd "$APP"

echo "[1/4] 备份数据库..."
sqlite3 data/guild.db "PRAGMA wal_checkpoint(TRUNCATE);" || true
cp data/guild.db "data/guild.db.bak-$TAG"
ls -la "data/guild.db.bak-$TAG"

echo "[2/4] 替换 routes/pay.js 并检查..."
cp "$STAGE/pay.js" routes/pay.js
node --check routes/pay.js
echo "    语法通过（$(wc -l < routes/pay.js) 行）"

echo "[3/4] 重启并健康检查..."
pm2 restart xuanjian-guild --update-env
sleep 6
curl -s -o /dev/null -w "    首页 %{http_code}\n" https://xuanjian.top/
for u in "/api/pay/intents/bogus" "/api/pay/payer-code/current" "/api/pay/admin/summary" "/api/pay/charges"; do
  echo "    $u -> $(curl -s -o /dev/null -w '%{http_code}' "https://xuanjian.top$u")"
done

echo "[4/4] 现状核对..."
sqlite3 data/guild.db "SELECT '金库: id=' || id || ' ' || nickname || ' 余额=' || contribution FROM users WHERE username='guild_treasury';"
sqlite3 data/guild.db "SELECT '流水/意图/名单/主体: ' || (SELECT COUNT(*) FROM pay_transactions) || '/' || (SELECT COUNT(*) FROM pay_intents) || '/' || (SELECT COUNT(*) FROM pay_charges) || '/' || (SELECT COUNT(*) FROM pay_payees);"
echo "后端部署完成 ✓"
