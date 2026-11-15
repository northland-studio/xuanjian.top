#!/bin/bash
# 玄剑 GIS 第二轮上线：数据区域聚类展示（工业区/紫雪城）+ 调色板全覆盖 + 未知 hash 诊断
# 由本地 scripts/deploy-gis-regions.ps1 上传到 /root/deploy-<TAG> 后执行。
set -u
APP=/var/www/xuanjian-guild
TAG=20261115-gis-regions
STAGE=/root/deploy-20261115-gis-regions
BACKUP=/root/backups/gis-$TAG
DIST_BAK="frontend/dist.bak-$TAG"
SSR_BAK="frontend/dist-ssr.bak-$TAG"
FILES="lib/gis/regions.js lib/gis/block-colors.json lib/gis/map-palette.js lib/gis/map.js routes/gis.js"

cd "$APP" || exit 1
mkdir -p "$BACKUP"

echo "================ [0/9] 迁移 dry-run（预期 0 pending；本功能无迁移） ================"
node migrations/run.js --dry-run || { echo "!! dry-run 失败"; exit 1; }

echo "================ [1/9] 备份 ================"
[ -d "$DIST_BAK" ] && rm -rf "$DIST_BAK"
[ -d "$SSR_BAK" ] && rm -rf "$SSR_BAK"
cp -a frontend/dist "$DIST_BAK" && cp -a frontend/dist-ssr "$SSR_BAK" || exit 1
for f in $FILES; do
  mkdir -p "$BACKUP/$(dirname $f)"; cp "$f" "$BACKUP/$f" 2>/dev/null || true
done
sqlite3 data/guild.db "SELECT id,world_key,server_key,status,is_current FROM gis_worlds ORDER BY id;" > "$BACKUP/worlds-before.txt"
sqlite3 data/guild.db "SELECT id,server_key,dimension,x,y,z,updated_at FROM market_store_locations ORDER BY id;" > "$BACKUP/market-before.txt"
echo "  备份: $DIST_BAK $SSR_BAK $BACKUP"

echo "================ [2/9] 后端文件 ================"
for f in $FILES; do
  mkdir -p "$(dirname $f)"
  cp "$STAGE/backend/$f" "$f" || { echo "!! 复制失败 $f"; exit 1; }
  if [ "${f##*.}" = "js" ]; then node --check "$f" || { echo "!! 语法失败 $f"; exit 1; }; fi
done
echo "  5 个后端文件已更新（js 均通过 node --check）"

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
node scripts/prerender.js --clean >/tmp/gis-prerender-regions.log 2>&1 || { echo "  (!) prerender 失败"; tail -3 /tmp/gis-prerender-regions.log; }
echo "  SSG: $(ls frontend/prerender 2>/dev/null | wc -l) 个"

echo "================ [5/9] 重启 ================"
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1 || exit 1
sleep 7
pm2 describe xuanjian-guild | grep -E "status|restarts" | head -2

echo "================ [6/9] 页面与接口验证 ================"
for u in / /gis /market /market/merchant /admin; do
  echo "  $u -> $(curl -s -o /dev/null -w '%{http_code}' "https://xuanjian.top$u")"
done
for u in "/api/gis/map/palette" "/api/gis/map/palette?withUnknown=1&worldId=3&dimension=overworld" \
         "/api/gis/map/index?worldId=3&dimension=overworld" \
         "/api/gis/map/chunks?worldId=3&dimension=overworld&bbox=2320,122976,2448,123120&lod=2" \
         "/api/gis/objects?worldId=3&dimension=overworld&bbox=117700,-52900,118100,-52500" \
         "/api/gis/market/locations/count"; do
  echo "  $u -> $(curl -s -o /dev/null -w '%{http_code}' "https://xuanjian.top$u")"
done
echo -n "  palette: "; curl -s "https://xuanjian.top/api/gis/map/palette" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(JSON.stringify({version:j.version,blockColors:j.stats&&j.stats.blockColors,blocks:Object.keys(j.blocks||{}).length,transparent:Object.keys(j.transparent||{}).length,water:Object.keys(j.water||{}).length,unknown:j.materials&&j.materials.unknown}))})"
echo -n "  未知 hash 统计: "; curl -s "https://xuanjian.top/api/gis/map/palette?withUnknown=1&worldId=3&dimension=overworld" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const u=j.unknownSurfaceStats||{};console.log(JSON.stringify({scannedChunks:u.scannedChunks,totalSamples:u.totalSamples,unknownSamples:u.unknownSamples,unknownRate:u.unknownRate,top:(u.unknownBlocks||[]).slice(0,5)}))})"
echo -n "  map/index regions: "; curl -s "https://xuanjian.top/api/gis/map/index?worldId=3&dimension=overworld" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(JSON.stringify({chunkCount:j.dimensions.overworld.chunkCount,outlierChunks:j.outlierChunks,regions:(j.regions||[]).map(r=>({id:r.id,name:r.districtName,districtId:r.districtId,n:r.chunkCount,center:[r.centerX,r.centerZ],bbox:r.bbox}))}))})"

echo "================ [7/9] 前端 bundle 校验 ================"
JS=$(curl -s https://xuanjian.top/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
BODY=$(curl -s "https://xuanjian.top/$JS")
echo "  entry: $JS"
for k in gis-select-region 区域 1 gis-block-tiles Mc\ 方块地图 transparent; do
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
echo -n "  已发布城区 district: "; sqlite3 data/guild.db "SELECT COUNT(*) FROM gis_published WHERE object_type='district' AND deleted=0;"
echo -n "  integrity_check: "; sqlite3 data/guild.db "PRAGMA integrity_check;"

echo "================ [9/9] 错误日志 ================"
tail -80 /root/.pm2/logs/xuanjian-guild-error.log 2>/dev/null | grep -i -E "gis|map|regions|palette" | tail -8 || echo "  无 GIS 相关错误"

echo
echo "上线完成。回滚命令："
echo "  cd $APP && rm -rf frontend/dist frontend/dist-ssr frontend/prerender && mv $DIST_BAK frontend/dist && mv $SSR_BAK frontend/dist-ssr && cp -a $BACKUP/lib $BACKUP/routes . 2>/dev/null; node scripts/prerender.js --clean && pm2 restart xuanjian-guild"
