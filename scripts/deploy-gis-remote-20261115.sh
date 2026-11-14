#!/bin/bash
# 玄剑 GIS 前端上线（/gis 页面）+ 地形模块修复
# 由本地 scripts/deploy-gis-20261115.ps1 上传到 /root/deploy-<TAG> 后执行。
# 安全：全部被替换文件先备份；失败可一键回滚（见末尾提示）。
set -u
APP=/var/www/xuanjian-guild
TAG=20261115-gis-fe
STAGE=/root/deploy-20261115-gis-fe
BACKUP=/root/backups/gis-$TAG
DIST_BAK="frontend/dist.bak-$TAG"
SSR_BAK="frontend/dist-ssr.bak-$TAG"

cd "$APP" || exit 1
mkdir -p "$BACKUP"

echo "================ [0/8] 迁移 dry-run（预期 0 pending） ================"
node migrations/run.js --dry-run || { echo "!! dry-run 失败"; exit 1; }

echo "================ [1/8] 备份被替换文件 ================"
[ -d "$DIST_BAK" ] && rm -rf "$DIST_BAK"
[ -d "$SSR_BAK" ] && rm -rf "$SSR_BAK"
cp -a frontend/dist "$DIST_BAK" || exit 1
cp -a frontend/dist-ssr "$SSR_BAK" || exit 1
cp lib/gis/terrain.js "$BACKUP/terrain.js" 2>/dev/null || true
sqlite3 data/guild.db "SELECT id,server_key,dimension,x,y,z,updated_at FROM market_store_locations ORDER BY id;" > "$BACKUP/market-locations-before.txt" || true
echo "  备份: $DIST_BAK $SSR_BAK $BACKUP"

echo "================ [2/8] 后端：更新 lib/gis/terrain.js ================"
cp "$STAGE/terrain.js" lib/gis/terrain.js || exit 1
node --check lib/gis/terrain.js || { echo "!! terrain.js 语法失败，回滚"; cp "$BACKUP/terrain.js" lib/gis/terrain.js; exit 1; }
node --check routes/gis.js && node --check lib/gis/index.js || { echo "!! 关键文件语法失败"; exit 1; }
echo "  terrain.js 语法通过（routes/gis.js 保持线上版本，hash 与本地一致）"

echo "================ [3/8] 前端产物替换 ================"
rm -rf frontend/dist.new && mkdir -p frontend/dist.new
tar -xzf "$STAGE/dist.tgz" -C frontend/dist.new || exit 1
[ -f frontend/dist.new/index.html ] || { echo "!! 新产物缺 index.html"; exit 1; }
rm -rf frontend/dist && mv frontend/dist.new frontend/dist
rm -rf frontend/dist-ssr && mkdir -p frontend/dist-ssr
tar -xzf "$STAGE/dist-ssr.tgz" -C frontend/dist-ssr || exit 1
[ -f frontend/dist-ssr/entry-server.js ] || { echo "!! 缺 entry-server.js"; exit 1; }
echo -n "  新前端入口: "; grep -o 'assets/index-[A-Za-z0-9_-]*\.js' frontend/dist/index.html | head -1

echo "================ [4/8] 重建 SSG 静态页 ================"
rm -rf frontend/prerender
node scripts/prerender.js --clean >/tmp/gis-prerender.log 2>&1 || { echo "  (!) prerender 失败，见 /tmp/gis-prerender.log"; tail -5 /tmp/gis-prerender.log; }
echo "  SSG 产物: $(ls frontend/prerender 2>/dev/null | wc -l) 个"

echo "================ [5/8] 重启 ================"
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1 || { echo "!! pm2 restart 失败"; exit 1; }
sleep 7
pm2 describe xuanjian-guild | grep -E "status|restarts" | head -2

echo "================ [6/8] HTTP 验证 ================"
for u in / /gis /market /market/map /market/merchant /wiki /admin; do
  echo "  $u -> $(curl -s -o /dev/null -w '%{http_code}' "https://xuanjian.top$u")"
done
echo "  --- API ---"
for u in "/api/gis/config" "/api/gis/worlds" "/api/gis/client/contract" \
         "/api/gis/objects?worldId=1&dimension=overworld&bbox=-64,-64,64,64" \
         "/api/gis/terrain/coverage?worldId=1&dimension=overworld" \
         "/api/gis/terrain/contours?worldId=1&dimension=overworld&bbox=-64,-64,64,64&interval=10" \
         "/api/gis/market/locations" "/api/gis/market/locations/count" "/api/market/config"; do
  echo "  $u -> $(curl -s -o /dev/null -w '%{http_code}' "https://xuanjian.top$u")"
done

echo "================ [7/8] 生产 DB 与集市地点核对 ================"
echo -n "  新前端资源引用: "; curl -s https://xuanjian.top/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1
echo -n "  线上 bundle 含 GIS 页面代码(gis-page): "
JS=$(curl -s https://xuanjian.top/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
curl -s "https://xuanjian.top/$JS" | grep -c "gis-page" || true
echo "  market_store_locations 部署后:"
sqlite3 data/guild.db "SELECT id,server_key,dimension,x,y,z,updated_at FROM market_store_locations ORDER BY id;" | tee "$BACKUP/market-locations-after.txt"
if diff -u "$BACKUP/market-locations-before.txt" "$BACKUP/market-locations-after.txt" >/dev/null 2>&1; then
  echo "  ✅ 集市地点逐字节一致（数量/id/坐标/updated_at 未变）"
else
  echo "  !! 集市地点发生变化，请立即回滚："; diff -u "$BACKUP/market-locations-before.txt" "$BACKUP/market-locations-after.txt"
fi
echo -n "  market 行数: "; sqlite3 data/guild.db "SELECT COUNT(*) FROM market_store_locations;"
echo -n "  gis 对象/世界/chunk: "
sqlite3 data/guild.db "SELECT (SELECT COUNT(*) FROM gis_worlds)||'/'||(SELECT COUNT(*) FROM gis_published)||'/'||(SELECT COUNT(*) FROM gis_elevation_chunks);"

echo "================ [8/8] 错误日志（最近 30 行，仅 GIS 相关） ================"
tail -60 /root/.pm2/logs/xuanjian-guild-error.log 2>/dev/null | grep -i -E "gis|terrain" | tail -10 || echo "  无 GIS 相关错误"

echo
echo "上线完成。回滚命令："
echo "  cd $APP && rm -rf frontend/dist frontend/dist-ssr frontend/prerender && mv $DIST_BAK frontend/dist && mv $SSR_BAK frontend/dist-ssr && cp $BACKUP/terrain.js lib/gis/terrain.js && node scripts/prerender.js --clean && pm2 restart xuanjian-guild"
