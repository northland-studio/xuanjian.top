#!/bin/bash
# 三层渲染架构部署脚本（在 HK 上执行）
#
# 前置：本地已把以下内容上传到 /root/deploy-render-20261002/
#   dist.tgz            前端客户端产物（**国庆主题分支构建**，含 Rocket Loader 自举补丁）
#   normal-dist.tgz     前端客户端产物（master 构建，作为 dist-normal 回滚留档）
#   dist-ssr.tgz        SSR 产物（frontend/dist-ssr）
#   backend/            需要覆盖到站点根的文件（lib/ssr.js、lib/prefetch/、server.js、scripts/*.js）
#
# 做四件事：① 备份并覆盖后端文件 ② 前端 dist 原子切换（保持国庆主题标记）
#          ③ 生成 SSG 静态产物 ④ 重启服务并逐路由验证
set -e
STAGE=/root/deploy-render-20261002
SITE=/var/www/xuanjian-guild
TS=$(date +%Y%m%d-%H%M%S)

echo "[1/5] 备份并覆盖后端文件"
cd "$SITE"
mkdir -p ".bak-render-$TS"
for f in server.js lib/ssr.js lib/wiki.js; do
  [ -f "$f" ] && cp "$f" ".bak-render-$TS/$(echo $f | tr '/' '_')" || true
done
cp -r "$STAGE/backend/." "$SITE/"
echo "  已覆盖：$(cd "$STAGE/backend" && find . -type f | sed 's|^\./||' | tr '\n' ' ')"

echo "[2/5] 前端 dist 原子切换（保持国庆主题标记）"
rm -rf "$SITE/frontend/dist.new" "$SITE/frontend/dist.old"
mkdir -p "$SITE/frontend/dist.new"
tar -xzf "$STAGE/dist.tgz" -C "$SITE/frontend/dist.new"
touch "$SITE/frontend/dist.new/.national-day"
if [ -d "$SITE/frontend/dist" ]; then mv "$SITE/frontend/dist" "$SITE/frontend/dist.old"; fi
mv "$SITE/frontend/dist.new" "$SITE/frontend/dist"
rm -rf "$SITE/frontend/dist.old"

echo "  回滚留档 dist-normal（供 10-08 自动回滚）"
rm -rf "$SITE/frontend/dist-normal.new"
mkdir -p "$SITE/frontend/dist-normal.new"
tar -xzf "$STAGE/normal-dist.tgz" -C "$SITE/frontend/dist-normal.new"
rm -rf "$SITE/frontend/dist-normal"
mv "$SITE/frontend/dist-normal.new" "$SITE/frontend/dist-normal"

echo "[3/5] SSR 产物"
rm -rf "$SITE/frontend/dist-ssr"
mkdir -p "$SITE/frontend/dist-ssr"
tar -xzf "$STAGE/dist-ssr.tgz" -C "$SITE/frontend/dist-ssr"
ls -lh "$SITE/frontend/dist-ssr/entry-server.js" | awk '{print "  " $NF, $5}'

echo "[4/5] 重启服务并生成 SSG 产物"
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1
sleep 4
pm2 list | grep -E 'xuanjian-guild'
cd "$SITE"
node scripts/prerender.js --clean

echo "[5/5] 逐路由验证（HTTP 状态 / 渲染模式 / 标题 / 正文长度）"
check() {
  local url="$1"
  local out
  out=$(curl -s -D /tmp/h.txt "http://localhost:3000$url")
  local status mode title len
  status=$(head -1 /tmp/h.txt | awk '{print $2}')
  mode=$(grep -i '^x-render-mode:' /tmp/h.txt | awk '{print $2}' | tr -d '\r')
  title=$(printf '%s' "$out" | grep -o '<title>[^<]*</title>' | head -1 | sed 's/<[^>]*>//g')
  len=$(printf '%s' "$out" | wc -c)
  printf '  %-34s %s  mode=%-9s %6s B  %s\n' "$url" "$status" "${mode:-spa}" "$len" "$title"
}
for u in / /wiki /wiki/zi-xue-zhen-shi-qi /wiki/category/tong-shi-zheng-wen /daily /decision /mods /projections /gmirs /gdars /rankings /donation; do
  check "$u"
done
PID=$(curl -s "http://localhost:3000/api/wiki" >/dev/null; echo)
POST_ID=$(sqlite3 "$SITE/data/guild.db" "SELECT id FROM posts ORDER BY id DESC LIMIT 1")
[ -n "$POST_ID" ] && check "/post/$POST_ID"
USERNAME=$(sqlite3 "$SITE/data/guild.db" "SELECT username FROM users WHERE level = 0 ORDER BY id LIMIT 1")
[ -n "$USERNAME" ] && check "/profile/$USERNAME"

echo
echo "SSG 产物：$(ls "$SITE/frontend/prerender" 2>/dev/null | wc -l) 个"
echo "回退开关：SPA_ONLY=1（pm2 restart xuanjian-guild --update-env）即可退回纯 SPA"
echo "缓存清理：bash $SITE/scripts/purge-cache.sh（需 CF_ZONE_ID / CF_API_TOKEN，缺凭据会提示跳过）"
echo "部署完成 ✓"
