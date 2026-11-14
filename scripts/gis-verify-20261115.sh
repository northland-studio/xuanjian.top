#!/bin/bash
# 玄剑 GIS 生产验收：只读探测（不写文件、不重启、不迁移）
# 用途：阶段 4/5 上线后验证 + 2G2H 资源占用与接口延迟实测
set -u
APP=/var/www/xuanjian-guild
cd "$APP" || exit 1
BASE=https://xuanjian.top

echo "===== 1. 机器与进程资源（2G2H） ====="
free -m | head -3
df -h / | tail -1
PID=$(cat /root/.pm2/pids/xuanjian-guild-0.pid 2>/dev/null)
echo -n "pm2 pid: $PID  "
[ -n "$PID" ] && ps -o pid,rss,pcpu,etime,cmd -p "$PID" | tail -1
echo "--- pm2 describe ---"
pm2 describe xuanjian-guild | grep -E "status|restarts|uptime" | head -3
pm2 list | grep -E "name|xuanjian-guild" | head -3

echo
echo "===== 2. 数据库与 GIS 数据规模 ====="
echo -n "guild.db 大小: "; du -h data/guild.db | cut -f1
ls -lh data/guild.db* | awk '{print "  " $NF, $5}'
echo -n "计费表行数: "
sqlite3 data/guild.db "SELECT 'users='||(SELECT COUNT(*) FROM users)||' market_locations='||(SELECT COUNT(*) FROM market_store_locations)||' wiki_pages='||(SELECT COUNT(*) FROM wiki_pages)||' contributions_sum='||(SELECT COALESCE(ROUND(SUM(contribution),2),0) FROM users);"
echo -n "GIS 行数: "
sqlite3 data/guild.db "SELECT 'worlds='||(SELECT COUNT(*) FROM gis_worlds)||' servers='||(SELECT COUNT(*) FROM gis_servers)||' published='||(SELECT COUNT(*) FROM gis_published)||' revisions='||(SELECT COUNT(*) FROM gis_revisions)||' elevation_chunks='||(SELECT COUNT(*) FROM gis_elevation_chunks)||' jobs='||(SELECT COUNT(*) FROM gis_jobs);"

echo
echo "===== 3. 集市地点（必须与部署前一致：2 行） ====="
sqlite3 data/guild.db "SELECT id,server_key,dimension,x,y,z,label,is_public,updated_at FROM market_store_locations ORDER BY id;"

echo
echo "===== 4. 页面与接口状态码 ====="
for u in / /gis /market /market/map /market/merchant /wiki /admin; do
  echo "  $u -> $(curl -s -o /dev/null -w '%{http_code}' "$BASE$u")"
done
for u in "/api/gis/config" "/api/gis/worlds" "/api/gis/client/contract" \
         "/api/gis/objects?worldId=1&dimension=overworld&bbox=-64,-64,64,64" \
         "/api/gis/terrain/coverage?worldId=1&dimension=overworld&bbox=-64,-64,64,64" \
         "/api/gis/terrain/contours?worldId=1&dimension=overworld&bbox=-64,-64,64,64&interval=10" \
         "/api/gis/terrain/stats?worldId=1&dimension=overworld&bbox=-64,-64,64,64" \
         "/api/gis/market/locations" "/api/gis/market/locations/count" \
         "/api/gis/places/market_store/1" "/api/market/config" "/api/market/stores"; do
  echo "  $u -> $(curl -s -o /dev/null -w '%{http_code}' "$BASE$u")"
done

echo
echo "===== 5. 接口延迟实测（各 5 次，单位 ms：avg / max） ====="
measure() {
  local url="$1" label="$2" i t
  local sum=0 max=0
  for i in 1 2 3 4 5; do
    t=$(curl -s -o /dev/null -w '%{time_total}' "$BASE$url")
    t=$(awk -v v="$t" 'BEGIN{printf "%d", v*1000}')
    sum=$((sum + t))
    [ "$t" -gt "$max" ] && max=$t
  done
  echo "  $label: $((sum / 5)) / $max"
}
measure "/gis" "GET /gis（HTML，SPA 入口）"
measure "/api/gis/config" "GET /api/gis/config"
measure "/api/gis/objects?worldId=1&dimension=overworld&bbox=-512,-512,512,512" "GET /api/gis/objects bbox(1024²)"
measure "/api/gis/terrain/coverage?worldId=1&dimension=overworld&bbox=-256,-256,256,256" "GET /api/gis/terrain/coverage 512²"
measure "/api/gis/terrain/contours?worldId=1&dimension=overworld&bbox=-256,-256,256,256&interval=10" "GET /api/gis/terrain/contours 512²（无数据）"
measure "/api/gis/terrain/stats?worldId=1&dimension=overworld&bbox=-256,-256,256,256" "GET /api/gis/terrain/stats 512²（无数据）"
measure "/api/gis/market/locations" "GET /api/gis/market/locations"
measure "/api/market/stores" "GET /api/market/stores（回归基线）"

echo
echo "===== 6. 前端 bundle 校验（/gis 真页面 + 集市选点器） ====="
IDX=$(curl -s "$BASE/" )
JS=$(echo "$IDX" | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
echo "  首页入口: $JS"
BODY=$(curl -s "$BASE/$JS")
echo -n "  bundle 含 gis-page: "; echo "$BODY" | grep -c "gis-page"
echo -n "  bundle 含 gis-picker（集市选点器）: "; echo "$BODY" | grep -c "gis-picker"
echo -n "  bundle 含 gis-inspector: "; echo "$BODY" | grep -c "gis-inspector"
echo -n "  /gis 返回是否含 SSR 骨架/标题: "; curl -s "$BASE/gis" | grep -c "玄剑"

echo
echo "===== 7. 最近错误日志（GIS 相关） ====="
tail -80 /root/.pm2/logs/xuanjian-guild-error.log 2>/dev/null | grep -i -E "gis|terrain" | tail -8 || echo "  无 GIS 相关错误"
echo "验收探测完成（只读，未修改任何文件/数据）"
