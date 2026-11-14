#!/bin/bash
# 玄剑 GIS 方块彩色地图上线（服务端数据接口 + 浏览器端 Canvas 渲染前端）
# 由本地 scripts/deploy-gis-canvasmap.ps1 上传到 /root/deploy-<TAG> 后执行。
set -u
APP=/var/www/xuanjian-guild
TAG=20261115-gis-canvasmap
STAGE=/root/deploy-20261115-gis-canvasmap
BACKUP=/root/backups/gis-$TAG
DIST_BAK="frontend/dist.bak-$TAG"
SSR_BAK="frontend/dist-ssr.bak-$TAG"

cd "$APP" || exit 1
mkdir -p "$BACKUP"

echo "================ [0/9] 迁移 dry-run（预期 0 pending；本功能无迁移） ================"
node migrations/run.js --dry-run || { echo "!! dry-run 失败"; exit 1; }

echo "================ [1/9] 备份 ================"
[ -d "$DIST_BAK" ] && rm -rf "$DIST_BAK"
[ -d "$SSR_BAK" ] && rm -rf "$SSR_BAK"
cp -a frontend/dist "$DIST_BAK" && cp -a frontend/dist-ssr "$SSR_BAK" || exit 1
for f in lib/gis/map.js lib/gis/map-palette.js lib/gis/terrain.js lib/gis/client.js lib/gis/constants.js lib/gis/index.js routes/gis.js; do
  mkdir -p "$BACKUP/$(dirname $f)"; cp "$f" "$BACKUP/$f" 2>/dev/null || true
done
sqlite3 data/guild.db "SELECT id,world_key,server_key,status,is_current FROM gis_worlds ORDER BY id;" > "$BACKUP/worlds-before.txt"
sqlite3 data/guild.db "SELECT id,server_key,dimension,x,y,z,updated_at FROM market_store_locations ORDER BY id;" > "$BACKUP/market-before.txt"
echo "  备份: $DIST_BAK $SSR_BAK $BACKUP"

echo "================ [2/9] 后端文件 ================"
for f in lib/gis/map.js lib/gis/map-palette.js lib/gis/terrain.js lib/gis/client.js lib/gis/constants.js lib/gis/index.js routes/gis.js; do
  mkdir -p "$(dirname $f)"
  cp "$STAGE/backend/$f" "$f" || { echo "!! 复制失败 $f"; exit 1; }
  node --check "$f" || { echo "!! 语法失败 $f"; exit 1; }
done
echo "  7 个后端文件已更新并通过 node --check"

echo "================ [3/9] 前端产物 ================"
rm -rf frontend/dist.new && mkdir -p frontend/dist.new
tar -xzf "$STAGE/dist.tgz" -C frontend/dist.new || exit 1
[ -f frontend/dist.new/index.html ] || { echo "!! 缺 index.html"; exit 1; }
rm -rf frontend/dist && mv frontend/dist.new frontend/dist
rm -rf frontend/dist-ssr && mkdir -p frontend/dist-ssr
tar -xzf "$STAGE/dist-ssr.tgz" -C frontend/dist-ssr || exit 1
[ -f frontend/dist-ssr/entry-server.js ] || { echo "!! 缺 entry-server.js"; exit 1; }
echo -n "  新入口: "; grep -o 'assets/index-[A-Za-z0-9_-]*\.js' frontend/dist/index.html | head -1

echo "================ [4/9] 重建 SSG ================"
rm -rf frontend/prerender
node scripts/prerender.js --clean >/tmp/gis-prerender-canvasmap.log 2>&1 || { echo "  (!) prerender 失败"; tail -3 /tmp/gis-prerender-canvasmap.log; }
echo "  SSG: $(ls frontend/prerender 2>/dev/null | wc -l) 个"

echo "================ [5/9] 重启 ================"
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1 || exit 1
sleep 7
pm2 describe xuanjian-guild | grep -E "status|restarts" | head -2

echo "================ [6/9] 页面与接口验证 ================"
for u in / /gis /market /market/merchant /admin; do
  echo "  $u -> $(curl -s -o /dev/null -w '%{http_code}' "https://xuanjian.top$u")"
done
for u in "/api/gis/map/palette" "/api/gis/map/index?worldId=3" \
         "/api/gis/map/chunks?worldId=3&dimension=overworld&bbox=2320,122976,2448,123120&lod=2" \
         "/api/gis/config" "/api/gis/market/locations" "/api/gis/market/locations/count" "/api/market/config"; do
  echo "  $u -> $(curl -s -o /dev/null -w '%{http_code}' "https://xuanjian.top$u")"
done
echo -n "  palette blocks 数量: "; curl -s "https://xuanjian.top/api/gis/map/palette" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log(Object.keys(j.blocks||{}).length)}catch(e){console.log('parse-fail')}})"
echo -n "  map/index 覆盖: "; curl -s "https://xuanjian.top/api/gis/map/index?worldId=3" | head -c 300; echo
echo -n "  chunks 抽样: "; curl -s "https://xuanjian.top/api/gis/map/chunks?worldId=3&dimension=overworld&bbox=2320,122976,2448,123120&lod=2" | head -c 260; echo

echo "================ [7/9] 前端 bundle 校验 ================"
JS=$(curl -s https://xuanjian.top/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
BODY=$(curl -s "https://xuanjian.top/$JS")
echo "  entry: $JS"
for k in gis-page gis-block-tiles Mc\ 方块地图 mapChunks gis-picker gis-inspector; do
  echo "  含 $k: $(echo "$BODY" | grep -c "$k")"
done

echo "================ [8/9] 数据核对（旧数据不变） ================"
printf "  gis_worlds:\n"; sqlite3 data/guild.db "SELECT id,world_key,server_key,status,is_current FROM gis_worlds ORDER BY id;"
sqlite3 data/guild.db "SELECT id,server_key,dimension,x,y,z,updated_at FROM market_store_locations ORDER BY id;" > "$BACKUP/market-after.txt"
if diff -u "$BACKUP/market-before.txt" "$BACKUP/market-after.txt" >/dev/null 2>&1; then
  echo "  ✅ 集市地点逐字节一致"
else
  echo "  !! 集市地点变化"; diff -u "$BACKUP/market-before.txt" "$BACKUP/market-after.txt"
fi
echo -n "  market 行数: "; sqlite3 data/guild.db "SELECT COUNT(*) FROM market_store_locations;"
echo -n "  elevation chunks: "; sqlite3 data/guild.db "SELECT COUNT(*) FROM gis_elevation_chunks;"
echo -n "  表结构未变（无 surface 列）: "; sqlite3 data/guild.db "PRAGMA table_info(gis_elevation_chunks);" | grep -ci surface

echo "================ [9/9] 错误日志 ================"
tail -60 /root/.pm2/logs/xuanjian-guild-error.log 2>/dev/null | grep -i -E "gis|map|terrain" | tail -8 || echo "  无 GIS 相关错误"

echo
echo "上线完成。回滚命令："
echo "  cd $APP && rm -rf frontend/dist frontend/dist-ssr frontend/prerender && mv $DIST_BAK frontend/dist && mv $SSR_BAK frontend/dist-ssr && cp -a $BACKUP/lib $BACKUP/routes . 2>/dev/null; node scripts/prerender.js --clean && pm2 restart xuanjian-guild"
