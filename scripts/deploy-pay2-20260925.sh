#!/bin/bash
# 扫码支付 阶段 3-6 生产部署：后端（pay/qqbot/server）+ 前端 dist
set -e
APP=/var/www/xuanjian-guild
STAGE=/root/deploy-pay2-20260925
TAG=20260925-pay2

cd "$APP"

echo "[1/7] 备份数据库..."
sqlite3 data/guild.db "PRAGMA wal_checkpoint(TRUNCATE);" || true
cp data/guild.db "data/guild.db.bak-$TAG"
ls -la "data/guild.db.bak-$TAG"

echo "[2/7] 同步后端文件..."
cp "$STAGE/pay.js" routes/pay.js
[ -f "$STAGE/qqbot.js" ] && cp "$STAGE/qqbot.js" routes/qqbot.js
[ -f "$STAGE/qqbot-pay.js" ] && cp "$STAGE/qqbot-pay.js" routes/qqbot-pay.js
[ -f "$STAGE/mc.js" ] && cp "$STAGE/mc.js" routes/mc.js
mkdir -p lib
[ -f "$STAGE/pay-render.js" ] && cp "$STAGE/pay-render.js" lib/pay-render.js
[ -f "$STAGE/mc-status.js" ] && cp "$STAGE/mc-status.js" lib/mc-status.js
cp "$STAGE/server.js" server.js

echo "[3/7] 语法检查..."
node --check routes/pay.js
node --check server.js
[ -f routes/qqbot-pay.js ] && node --check routes/qqbot-pay.js
[ -f routes/mc.js ] && node --check routes/mc.js
[ -f lib/pay-render.js ] && node --check lib/pay-render.js
[ -f lib/mc-status.js ] && node --check lib/mc-status.js
[ -f "$STAGE/qqbot.js" ] && node --check routes/qqbot.js
echo "    通过"

echo "[4/7] 替换前端产物（原子切换）..."
if [ -f "$STAGE/dist.tar.gz" ]; then
  rm -rf frontend/dist.new && mkdir -p frontend/dist.new
  tar -xzf "$STAGE/dist.tar.gz" -C frontend/dist.new
  [ -f frontend/dist/index.html ] || { echo "    新产物缺少 index.html，中止"; exit 1; }
  rm -rf "frontend/dist.bak-$TAG"
  mv frontend/dist "frontend/dist.bak-$TAG"
  mv frontend/dist.new frontend/dist
  ls frontend/dist | head -5
else
  echo "    （未提供 dist.tar.gz，跳过前端更新）"
fi

echo "[5/7] 重启服务..."
pm2 restart xuanjian-guild --update-env
sleep 6

echo "[6/7] 健康检查..."
curl -s -o /dev/null -w "    首页 %{http_code}\n" https://xuanjian.top/
for u in "/api/pay/intents/bogus" "/api/pay/payer-code/current" "/api/pay/admin/summary" "/api/pay/qr.png?text=https%3A%2F%2Fxuanjian.top%2Fpay%2Fabcdefghijklmnop"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://xuanjian.top$u")
  echo "    $u -> $code"
done
echo "    （以上未登录接口应为 401；qr.png 应为 200 或 400）"

echo "[7/7] 数据核对..."
sqlite3 data/guild.db "SELECT 'pay 表: ' || group_concat(name, ', ') FROM sqlite_master WHERE type='table' AND name LIKE 'pay_%';"
sqlite3 data/guild.db "SELECT '金库: id=' || id || ' ' || nickname || ' 余额=' || contribution FROM users WHERE username='guild_treasury';"
sqlite3 data/guild.db "SELECT '流水/意图/名单/主体: ' || (SELECT COUNT(*) FROM pay_transactions) || '/' || (SELECT COUNT(*) FROM pay_intents) || '/' || (SELECT COUNT(*) FROM pay_charges) || '/' || (SELECT COUNT(*) FROM pay_payees);"
pm2 list | grep -E "xuanjian-guild" || true
echo "部署完成 ✓"
