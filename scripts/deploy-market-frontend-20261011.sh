#!/bin/bash
# 集市前端页面部署（20261011）
#
# 前置：本地已执行 bash scripts/build-frontend.sh，并把产物打成
#   $STAGE/dist.tgz       （frontend/dist 内容）
#   $STAGE/dist-ssr.tgz   （frontend/dist-ssr 内容）
# 同时带上本次一起上线的两处后端改动（评价管理接口 + 通知事件映射）。
#
# 步骤：备份现有产物与数据库 → 替换后端两文件 + 前端产物 → 清理并重建 SSG 静态页 → 重启 → 健康检查
set -e
APP=/var/www/xuanjian-guild
STAGE=/root/deploy-market-frontend-20261011
TAG=20261011-market-fe

cd "$APP"

echo "[1/6] 备份数据库与现有前端产物..."
sqlite3 data/guild.db "PRAGMA wal_checkpoint(TRUNCATE);" || true
cp data/guild.db "data/guild.db.bak-$TAG"
[ -f frontend/dist/.national-day ] && echo "    (!) 当前 dist 是国庆主题产物，本脚本会按仓库现状替换为普通主题"
rm -rf "frontend/dist.bak-$TAG" "frontend/dist-ssr.bak-$TAG"
[ -d frontend/dist ] && cp -a frontend/dist "frontend/dist.bak-$TAG"
[ -d frontend/dist-ssr ] && cp -a frontend/dist-ssr "frontend/dist-ssr.bak-$TAG"
ls -d frontend/dist.bak-$TAG frontend/dist-ssr.bak-$TAG

echo "[2/6] 后端增量（评价管理接口）..."
cp "$STAGE/routes/market.js" routes/market.js
cp "$STAGE/lib/market-notify.js" lib/market-notify.js
node --check routes/market.js && node --check lib/market-notify.js
echo "    + routes/market.js lib/market-notify.js 语法通过"

echo "[3/6] 替换前端产物..."
rm -rf frontend/dist.new && mkdir -p frontend/dist.new
tar -xzf "$STAGE/dist.tgz" -C frontend/dist.new
[ -f frontend/dist.new/index.html ] || { echo "    新产物缺少 index.html，中止"; exit 1; }
rm -rf frontend/dist && mv frontend/dist.new frontend/dist
rm -rf frontend/dist-ssr && mkdir -p frontend/dist-ssr
tar -xzf "$STAGE/dist-ssr.tgz" -C frontend/dist-ssr
ls -lh frontend/dist/index.html frontend/dist-ssr/entry-server.js | awk '{print "    " $NF, $5}'
echo -n "    dist 里的集市代码命中次数: "; grep -c "market" frontend/dist/assets/index-*.js || true

echo "[4/6] 重建 SSG 静态页..."
rm -rf frontend/prerender
node scripts/prerender.js --clean >/tmp/market-prerender.log 2>&1 || { echo "    (!) prerender 失败，见 /tmp/market-prerender.log"; tail -5 /tmp/market-prerender.log; }
echo "    SSG 产物：$(ls frontend/prerender 2>/dev/null | wc -l) 个"

echo "[5/6] 重启并健康检查..."
pm2 restart xuanjian-guild --update-env
sleep 6
CHECK=("/" "/market" "/market/orders" "/market/merchant" "/market/map" "/market/admin" "/api/market/config" "/api/market/merchant/reviews?store_id=1")
for u in "${CHECK[@]}"; do
  echo "    $u -> $(curl -s -o /dev/null -w '%{http_code}' "https://xuanjian.top$u")"
done
echo -n "    前端入口引用的资源: "
curl -s https://xuanjian.top/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.\(js\|css\)' | sort -u | tr '\n' ' '; echo

echo "[6/6] 现状核对..."
echo -n "    /market 页面 HTML 含「紫雪坊市」: "
curl -s https://xuanjian.top/market | grep -c "紫雪坊市" || true
echo -n "    dist 哈希是否已更新（应不再是 index-CYJFv775.js）: "
ls frontend/dist/assets/index-*.js | xargs -n1 basename | tr '\n' ' '; echo
echo "前端部署完成 ✓（回滚：rm -rf frontend/dist frontend/dist-ssr && mv frontend/dist.bak-$TAG frontend/dist && mv frontend/dist-ssr.bak-$TAG frontend/dist-ssr && rm -rf frontend/prerender && node scripts/prerender.js --clean && pm2 restart xuanjian-guild）"
