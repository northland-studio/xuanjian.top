#!/bin/bash
# 仅部署前端（股市页面）
set -e
APP=/var/www/xuanjian-guild
cd "$APP"
TAG=stockpage-$(date +%Y%m%d-%H%M%S)
cp -a frontend/dist "frontend/dist.bak-$TAG"
rm -rf frontend/dist.new && mkdir -p frontend/dist.new
tar -xzf /root/deploy-stock/dist.tgz -C frontend/dist.new
[ -f frontend/dist.new/index.html ] || { echo "缺少 index.html"; exit 1; }
rm -rf frontend/dist && mv frontend/dist.new frontend/dist
rm -rf frontend/dist-ssr && mkdir -p frontend/dist-ssr
tar -xzf /root/deploy-stock/dist-ssr.tgz -C frontend/dist-ssr
rm -rf frontend/prerender
node scripts/prerender.js --clean 2>&1 | tail -2
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1
sleep 6
echo -n "  首页: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 https://xuanjian.top/
echo -n "  /stocks: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 https://xuanjian.top/stocks
echo -n "  /api/express-index/quotes: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 https://xuanjian.top/api/express-index/quotes
