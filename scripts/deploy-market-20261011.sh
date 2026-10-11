#!/bin/bash
# 「紫雪坊市公会集市」后端部署 + 数据迁移（20261011）
#
# 只部署集市相关文件（后端运行时不需要任何新依赖：二维码用已有 qrcode，出图用已有 sharp）：
#   lib/market.js lib/market-settle.js lib/market-notify.js lib/market-jobs.js lib/market-render.js
#   routes/market.js server.js scripts/migrate-marketplace.js scripts/test-market-e2e.js
#   scripts/test-market-qr.js docs/MARKET.md
#
# 步骤：备份数据库 → 覆盖文件 + 语法检查 → 跑迁移（幂等，自带备份）→ 重启 → 健康检查 → 现状核对
set -e
APP=/var/www/xuanjian-guild
STAGE=/root/deploy-market-20261011
TAG=20261011-market

cd "$APP"

echo "[1/6] 备份数据库..."
sqlite3 data/guild.db "PRAGMA wal_checkpoint(TRUNCATE);" || true
cp data/guild.db "data/guild.db.bak-$TAG"
ls -la "data/guild.db.bak-$TAG"

echo "[2/6] 覆盖集市相关文件并做语法检查..."
mkdir -p lib routes scripts docs
FILES="lib/market.js lib/market-settle.js lib/market-notify.js lib/market-jobs.js lib/market-render.js routes/market.js server.js scripts/migrate-marketplace.js scripts/test-market-e2e.js scripts/test-market-qr.js docs/MARKET.md"
for f in $FILES; do
  cp "$STAGE/$f" "$f"
  echo "    + $f ($(wc -l < "$f") 行)"
done
for f in lib/market.js lib/market-settle.js lib/market-notify.js lib/market-jobs.js lib/market-render.js \
         routes/market.js server.js scripts/migrate-marketplace.js; do
  node --check "$f"
done
echo "    语法全部通过 ✓"

echo "[3/6] 检查运行时依赖（二维码/出图）..."
node -e "require('qrcode'); require('sharp'); console.log('    qrcode + sharp 可用 ✓')"

echo "[4/6] 执行数据迁移（幂等，自动备份到 data/backups/）..."
node scripts/migrate-marketplace.js
echo "    二次执行验证幂等..."
node scripts/migrate-marketplace.js | tail -3

echo "[5/6] 重启并健康检查..."
pm2 restart xuanjian-guild --update-env
sleep 6
echo "    首页 $(curl -s -o /dev/null -w '%{http_code}' https://xuanjian.top/)"
for u in "/api/market/config" "/api/market/stores" "/api/market/products?limit=2" "/api/market/map"; do
  echo "    $u -> $(curl -s -o /dev/null -w '%{http_code}' "https://xuanjian.top$u")"
done

echo "[6/6] 现状核对..."
sqlite3 data/guild.db "SELECT '集市表数量: ' || COUNT(*) FROM sqlite_master WHERE type='table' AND name LIKE 'market_%';"
sqlite3 data/guild.db "SELECT '系统账号: ' || id || ' ' || username || ' level=' || level || ' 余额=' || COALESCE(contribution,0) || ' 头像=' || COALESCE(avatar,'') FROM users WHERE username LIKE 'market_%';"
sqlite3 data/guild.db "SELECT '残留财政账号(应为 无): ' || COALESCE(GROUP_CONCAT(username),'无') FROM users WHERE username = 'market_treasury';"
sqlite3 data/guild.db "SELECT '贡献点流水白名单已含集市类型: ' || (CASE WHEN sql LIKE '%market_escrow_in%' THEN '是' ELSE '否' END) FROM sqlite_master WHERE name='contribution_logs';"
sqlite3 data/guild.db "SELECT '站内通知白名单已含集市类型: ' || (CASE WHEN sql LIKE '%market_order%' THEN '是' ELSE '否' END) FROM sqlite_master WHERE name='notifications';"
node -e "require('./database').get(\"SELECT value FROM settings WHERE key='market_config'\").then(r=>{const c=JSON.parse(r.value);console.log('    费率: 开店费='+c.openFee+' 首店免='+c.openFeeFirstFree+' 续期费='+c.renewFee+'/'+c.cycleDays+'天 税率='+c.taxRateBp+'bp 承担方='+c.taxMode);process.exit(0)}).catch(e=>{console.log('    读取配置失败: '+e.message);process.exit(1)})"
echo "集市后端部署完成 ✓"
