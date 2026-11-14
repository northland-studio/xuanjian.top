#!/bin/bash
# 玄剑 GIS 第二次上线：世界归档管理 UI + 客户端 bootstrap 本地模式语义 + 地形面板完善
# 由本地 scripts/deploy-gis-20261115b.ps1 上传到 /root/deploy-<TAG> 后执行。
set -u
APP=/var/www/xuanjian-guild
TAG=20261115-gis-fe2
STAGE=/root/deploy-20261115-gis-fe2
BACKUP=/root/backups/gis-$TAG
DIST_BAK="frontend/dist.bak-$TAG"
SSR_BAK="frontend/dist-ssr.bak-$TAG"

cd "$APP" || exit 1
mkdir -p "$BACKUP"

echo "================ [0/9] 迁移 dry-run（预期 0 pending） ================"
node migrations/run.js --dry-run || { echo "!! dry-run 失败"; exit 1; }

echo "================ [1/9] 备份 ================"
[ -d "$DIST_BAK" ] && rm -rf "$DIST_BAK"
[ -d "$SSR_BAK" ] && rm -rf "$SSR_BAK"
cp -a frontend/dist "$DIST_BAK" || exit 1
cp -a frontend/dist-ssr "$SSR_BAK" || exit 1
cp lib/gis/client.js "$BACKUP/client.js" 2>/dev/null || true
sqlite3 data/guild.db "SELECT id,world_key,server_key,status,is_current,updated_at FROM gis_worlds ORDER BY id;" > "$BACKUP/gis-worlds-before.txt" || true
sqlite3 data/guild.db "SELECT id,server_key,dimension,x,y,z,updated_at FROM market_store_locations ORDER BY id;" > "$BACKUP/market-locations-before.txt" || true
echo "  备份: $DIST_BAK $SSR_BAK $BACKUP"

echo "================ [2/9] 后端：lib/gis/client.js（bootstrap 本地模式语义） ================"
cp "$STAGE/client.js" lib/gis/client.js || exit 1
node --check lib/gis/client.js || { echo "!! client.js 语法失败，回滚"; cp "$BACKUP/client.js" lib/gis/client.js; exit 1; }
node --check lib/gis/index.js && node --check routes/gis.js || { echo "!! 关键文件语法失败"; exit 1; }
echo "  client.js 语法通过"

echo "================ [3/9] 前端产物替换 ================"
rm -rf frontend/dist.new && mkdir -p frontend/dist.new
tar -xzf "$STAGE/dist.tgz" -C frontend/dist.new || exit 1
[ -f frontend/dist.new/index.html ] || { echo "!! 新产物缺 index.html"; exit 1; }
rm -rf frontend/dist && mv frontend/dist.new frontend/dist
rm -rf frontend/dist-ssr && mkdir -p frontend/dist-ssr
tar -xzf "$STAGE/dist-ssr.tgz" -C frontend/dist-ssr || exit 1
[ -f frontend/dist-ssr/entry-server.js ] || { echo "!! 缺 entry-server.js"; exit 1; }
echo -n "  新前端入口: "; grep -o 'assets/index-[A-Za-z0-9_-]*\.js' frontend/dist/index.html | head -1

echo "================ [4/9] 重建 SSG 静态页 ================"
rm -rf frontend/prerender
node scripts/prerender.js --clean >/tmp/gis-prerender2.log 2>&1 || { echo "  (!) prerender 失败，见 /tmp/gis-prerender2.log"; tail -5 /tmp/gis-prerender2.log; }
echo "  SSG 产物: $(ls frontend/prerender 2>/dev/null | wc -l) 个"

echo "================ [5/9] 重启 ================"
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1 || { echo "!! pm2 restart 失败"; exit 1; }
sleep 7
pm2 describe xuanjian-guild | grep -E "status|restarts" | head -2

echo "================ [6/9] HTTP 验证 ================"
for u in / /gis /market /market/map /market/merchant /wiki /admin; do
  echo "  $u -> $(curl -s -o /dev/null -w '%{http_code}' "https://xuanjian.top$u")"
done
for u in "/api/gis/config" "/api/gis/worlds" "/api/gis/client/contract" \
         "/api/gis/objects?worldId=1&dimension=overworld&bbox=-64,-64,64,64" \
         "/api/gis/terrain/contours?worldId=1&dimension=overworld&bbox=-64,-64,64,64&interval=10" \
         "/api/gis/market/locations" "/api/gis/market/locations/count" "/api/market/config"; do
  echo "  $u -> $(curl -s -o /dev/null -w '%{http_code}' "https://xuanjian.top$u")"
done

echo "================ [7/9] 前端 bundle 校验 ================"
JS=$(curl -s https://xuanjian.top/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
echo "  入口: $JS"
BODY=$(curl -s "https://xuanjian.top/$JS")
for k in gis-page gis-picker gis-inspector gis-banner; do
  echo "  含 $k: $(echo "$BODY" | grep -c "$k")"
done

echo "================ [8/9] 数据核对 ================"
echo "  gis_worlds（部署后）:"
sqlite3 data/guild.db "SELECT id,world_key,server_key,status,is_current FROM gis_worlds ORDER BY id;"
echo "  market_store_locations（部署后）:"
sqlite3 data/guild.db "SELECT id,server_key,dimension,x,y,z,updated_at FROM market_store_locations ORDER BY id;" | tee "$BACKUP/market-locations-after.txt"
if diff -u "$BACKUP/market-locations-before.txt" "$BACKUP/market-locations-after.txt" >/dev/null 2>&1; then
  echo "  ✅ 集市地点逐字节一致"
else
  echo "  !! 集市地点变化："; diff -u "$BACKUP/market-locations-before.txt" "$BACKUP/market-locations-after.txt"
fi
echo -n "  行数: market_store_locations="; sqlite3 data/guild.db "SELECT COUNT(*) FROM market_store_locations;"

echo "================ [9/9] 错误日志 ================"
tail -60 /root/.pm2/logs/xuanjian-guild-error.log 2>/dev/null | grep -i -E "gis|terrain" | tail -8 || echo "  无 GIS 相关错误"

echo
echo "上线完成。回滚命令："
echo "  cd $APP && rm -rf frontend/dist frontend/dist-ssr frontend/prerender && mv $DIST_BAK frontend/dist && mv $SSR_BAK frontend/dist-ssr && cp $BACKUP/client.js lib/gis/client.js && node scripts/prerender.js --clean && pm2 restart xuanjian-guild"
