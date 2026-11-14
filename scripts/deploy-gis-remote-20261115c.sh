#!/bin/bash
# 玄剑 GIS 第三次上线（仅前端产物）：集市选点器支持「已归档世界」坐标平面选点
# 由本地 scripts/deploy-gis-20261115c.ps1 上传后执行。
set -u
APP=/var/www/xuanjian-guild
TAG=20261115-gis-fe3
STAGE=/root/deploy-20261115-gis-fe3
BACKUP=/root/backups/gis-$TAG
DIST_BAK="frontend/dist.bak-$TAG"
SSR_BAK="frontend/dist-ssr.bak-$TAG"

cd "$APP" || exit 1
mkdir -p "$BACKUP"

echo "================ [0/7] 迁移 dry-run ================"
node migrations/run.js --dry-run || exit 1

echo "================ [1/7] 备份 ================"
[ -d "$DIST_BAK" ] && rm -rf "$DIST_BAK"
[ -d "$SSR_BAK" ] && rm -rf "$SSR_BAK"
cp -a frontend/dist "$DIST_BAK" && cp -a frontend/dist-ssr "$SSR_BAK" || exit 1
sqlite3 data/guild.db "SELECT id,server_key,dimension,x,y,z,updated_at FROM market_store_locations ORDER BY id;" > "$BACKUP/market-before.txt"
sqlite3 data/guild.db "SELECT id,world_key,status,is_current FROM gis_worlds ORDER BY id;" > "$BACKUP/worlds-before.txt"
echo "  备份完成: $DIST_BAK $SSR_BAK $BACKUP"

echo "================ [2/7] 替换前端产物 ================"
rm -rf frontend/dist.new && mkdir -p frontend/dist.new
tar -xzf "$STAGE/dist.tgz" -C frontend/dist.new || exit 1
[ -f frontend/dist.new/index.html ] || exit 1
rm -rf frontend/dist && mv frontend/dist.new frontend/dist
rm -rf frontend/dist-ssr && mkdir -p frontend/dist-ssr
tar -xzf "$STAGE/dist-ssr.tgz" -C frontend/dist-ssr || exit 1
[ -f frontend/dist-ssr/entry-server.js ] || exit 1
echo -n "  新入口: "; grep -o 'assets/index-[A-Za-z0-9_-]*\.js' frontend/dist/index.html | head -1

echo "================ [3/7] 重建 SSG ================"
rm -rf frontend/prerender
node scripts/prerender.js --clean >/tmp/gis-prerender3.log 2>&1 || { echo "  (!) prerender 失败"; tail -3 /tmp/gis-prerender3.log; }
echo "  SSG: $(ls frontend/prerender 2>/dev/null | wc -l) 个"

echo "================ [4/7] 重启 ================"
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1 || exit 1
sleep 7
pm2 describe xuanjian-guild | grep -E "status|restarts" | head -2

echo "================ [5/7] 验证 ================"
for u in / /gis /market /market/merchant /admin; do
  echo "  $u -> $(curl -s -o /dev/null -w '%{http_code}' "https://xuanjian.top$u")"
done
for u in "/api/gis/config" "/api/gis/worlds" "/api/gis/market/locations" "/api/gis/market/locations/count" "/api/market/config"; do
  echo "  $u -> $(curl -s -o /dev/null -w '%{http_code}' "https://xuanjian.top$u")"
done
JS=$(curl -s https://xuanjian.top/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
BODY=$(curl -s "https://xuanjian.top/$JS")
echo "  entry: $JS"
for k in gis-page gis-picker gis-banner; do echo "  含 $k: $(echo "$BODY" | grep -c "$k")"; done
echo -n "  集市地点数: "; sqlite3 data/guild.db "SELECT COUNT(*) FROM market_store_locations;"
sqlite3 data/guild.db "SELECT id,server_key,dimension,x,y,z,updated_at FROM market_store_locations ORDER BY id;" > "$BACKUP/market-after.txt"
diff -u "$BACKUP/market-before.txt" "$BACKUP/market-after.txt" >/dev/null 2>&1 \
  && echo "  ✅ 集市地点逐字节一致" || { echo "  !! 集市地点变化"; diff -u "$BACKUP/market-before.txt" "$BACKUP/market-after.txt"; }
echo "  gis_worlds:"; sqlite3 data/guild.db "SELECT id,world_key,status,is_current FROM gis_worlds ORDER BY id;"

echo "================ [6/7] 归档世界语义回归 ================"
echo -n "  bootstrap(yl): "; curl -s "https://xuanjian.top/api/gis/client/bootstrap?serverKey=yl" | head -c 200; echo

echo "================ [7/7] 错误日志 ================"
tail -40 /root/.pm2/logs/xuanjian-guild-error.log 2>/dev/null | grep -i -E "gis|terrain" | tail -5 || echo "  无 GIS 错误"
echo
echo "完成。回滚："
echo "  cd $APP && rm -rf frontend/dist frontend/dist-ssr frontend/prerender && mv $DIST_BAK frontend/dist && mv $SSR_BAK frontend/dist-ssr && node scripts/prerender.js --clean && pm2 restart xuanjian-guild"
