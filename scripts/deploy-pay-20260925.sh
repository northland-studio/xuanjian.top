#!/bin/bash
# 贡献点扫码支付（阶段 2：数据表 + 收款码主扫闭环）生产部署
set -e
APP=/var/www/xuanjian-guild
STAGE=/root/deploy-pay-20260925
TAG=20260925-pay

cd "$APP"

echo "[1/6] 备份数据库..."
sqlite3 data/guild.db "PRAGMA wal_checkpoint(TRUNCATE);" || true
cp data/guild.db "data/guild.db.bak-$TAG"
ls -la "data/guild.db.bak-$TAG"

echo "[2/6] 同步文件并做语法检查..."
cp "$STAGE/migrate-pay.js" scripts/migrate-pay.js
cp "$STAGE/pay.js" routes/pay.js
cp "$STAGE/server.js" server.js
node --check routes/pay.js
node --check server.js
echo "    语法检查通过"

echo "[3/6] 执行数据库迁移..."
node scripts/migrate-pay.js

echo "[4/6] 重启服务..."
pm2 restart xuanjian-guild --update-env
sleep 6

echo "[5/6] 健康检查..."
curl -s -o /dev/null -w "    首页 %{http_code}\n" https://xuanjian.top/
curl -s -o /dev/null -w "  /api/pay/intents/bogus（未登录应 401）%{http_code}\n" https://xuanjian.top/api/pay/intents/bogus
curl -s -o /dev/null -w "  /api/pay/receive-code（未登录应 401）%{http_code}\n" -X POST https://xuanjian.top/api/pay/receive-code

echo "[6/6] 数据核对..."
sqlite3 data/guild.db "SELECT 'pay 表: ' || group_concat(name, ', ') FROM sqlite_master WHERE type='table' AND name LIKE 'pay_%';"
sqlite3 data/guild.db "SELECT '金库账户: id=' || id || ' ' || nickname || ' 余额=' || contribution FROM users WHERE username='guild_treasury';"
sqlite3 data/guild.db "SELECT '流水类型白名单: ' || (sql LIKE '%pay_out%') FROM sqlite_master WHERE name='contribution_logs';"
sqlite3 data/guild.db "SELECT '通知类型含 pay: ' || (sql LIKE '%''pay''%') FROM sqlite_master WHERE name='notifications';"
pm2 list | grep -E "xuanjian-guild|napcat" || true

echo "部署完成 ✓"
