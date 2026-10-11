#!/bin/bash
# 集市前端第二轮上线（20261011）：导航归入「经济」、管理端并入管理后台、分类图标去 emoji
#
# 前置：本地已构建并打包
#   $STAGE/dist.tgz / $STAGE/dist-ssr.tgz      前端产物
#   $STAGE/migrate-marketplace.js              迁移脚本（本次用于清理分类里的 emoji 图标）
#
# 步骤：备份 → 跑迁移（清 emoji 分类图标）→ 替换产物 → 重建 SSG → 重启 → 核对
set -e
APP=/var/www/xuanjian-guild
STAGE=/root/deploy-market-frontend2-20261011
TAG=20261011-market-fe2

cd "$APP"

echo "[1/6] 备份数据库与现有前端产物..."
sqlite3 data/guild.db "PRAGMA wal_checkpoint(TRUNCATE);" || true
cp data/guild.db "data/guild.db.bak-$TAG"
rm -rf "frontend/dist.bak-$TAG" "frontend/dist-ssr.bak-$TAG"
[ -d frontend/dist ] && cp -a frontend/dist "frontend/dist.bak-$TAG"
[ -d frontend/dist-ssr ] && cp -a frontend/dist-ssr "frontend/dist-ssr.bak-$TAG"
echo "    备份完成"

echo "[2/6] 重跑迁移（幂等）：清理分类里的 emoji 图标..."
cp "$STAGE/migrate-marketplace.js" scripts/migrate-marketplace.js
node --check scripts/migrate-marketplace.js
node scripts/migrate-marketplace.js | tail -6

echo "[3/6] 替换前端产物..."
rm -rf frontend/dist.new && mkdir -p frontend/dist.new
tar -xzf "$STAGE/dist.tgz" -C frontend/dist.new
[ -f frontend/dist.new/index.html ] || { echo "    新产物缺少 index.html，中止"; exit 1; }
rm -rf frontend/dist && mv frontend/dist.new frontend/dist
rm -rf frontend/dist-ssr && mkdir -p frontend/dist-ssr
tar -xzf "$STAGE/dist-ssr.tgz" -C frontend/dist-ssr
echo -n "    新产物: "; ls frontend/dist/assets/index-*.js | xargs -n1 basename | tr '\n' ' '; echo

echo "[4/6] 重建 SSG 静态页..."
rm -rf frontend/prerender
node scripts/prerender.js --clean >/tmp/market-prerender2.log 2>&1 || { echo "    (!) prerender 失败"; tail -5 /tmp/market-prerender2.log; }
tail -2 /tmp/market-prerender2.log

echo "[5/6] 重启并健康检查..."
pm2 restart xuanjian-guild --update-env
sleep 6
for u in "/" "/market" "/market/map" "/market/orders" "/market/merchant" "/admin" "/api/market/config"; do
  echo "    $u -> $(curl -s -o /dev/null -w '%{http_code}' "https://xuanjian.top$u")"
done
echo "    /market/admin（旧独立入口，应回到 SPA 首页或 404）-> $(curl -s -o /dev/null -w '%{http_code}' https://xuanjian.top/market/admin)"

echo "[6/6] 现状核对..."
echo -n "    导航里是否还有独立「集市」分组（应为 0，已并入经济）: "
grep -c "key: 'market'" frontend/dist/assets/index-*.js || true
echo -n "    分类图标是否已清空（带 emoji 的分类数，应为 0）: "
sqlite3 data/guild.db "SELECT COUNT(*) FROM market_categories WHERE icon <> '';"
echo -n "    管理后台是否含集市管理 tab: "
grep -c "集市管理" frontend/dist/assets/index-*.js || true
echo -n "    头像菜单是否还有支付管理入口（应为 0）: "
grep -c "支付管理" frontend/dist/assets/index-*.js || true
echo "第二轮前端上线完成 ✓（回滚：rm -rf frontend/dist frontend/dist-ssr && mv frontend/dist.bak-$TAG frontend/dist && mv frontend/dist-ssr.bak-$TAG frontend/dist-ssr && rm -rf frontend/prerender && node scripts/prerender.js --clean && pm2 restart xuanjian-guild）"
