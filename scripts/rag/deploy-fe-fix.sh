#!/bin/bash
# 玄剑姬前端修复上线（20261018b）：api 调用签名 + 主题令牌适配
set -e
APP=/var/www/xuanjian-guild
STAGE=/root/deploy-rag-fe2
TAG=20261018-rag-fe2
cd "$APP"

echo "[1/5] 备份前端产物..."
rm -rf "frontend/dist.bak-$TAG" "frontend/dist-ssr.bak-$TAG"
cp -a frontend/dist "frontend/dist.bak-$TAG"
cp -a frontend/dist-ssr "frontend/dist-ssr.bak-$TAG"

echo "[2/5] 替换产物..."
rm -rf frontend/dist.new && mkdir -p frontend/dist.new
tar -xzf "$STAGE/dist.tgz" -C frontend/dist.new
[ -f frontend/dist.new/index.html ] || { echo "缺少 index.html"; exit 1; }
rm -rf frontend/dist && mv frontend/dist.new frontend/dist
rm -rf frontend/dist-ssr && mkdir -p frontend/dist-ssr
tar -xzf "$STAGE/dist-ssr.tgz" -C frontend/dist-ssr

echo "[3/5] 重建 SSG..."
rm -rf frontend/prerender
node scripts/prerender.js --clean 2>&1 | tail -3

echo "[4/5] 重启..."
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1
sleep 6

echo "[5/5] 核对..."
HASH=$(curl -s --max-time 15 https://xuanjian.top/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
echo "  首页 -> $(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://xuanjian.top/)"
echo "  前端产物: $HASH"
JS="$APP/frontend/dist/$HASH"
echo -n "  是否已用 api.post（应为 1+）: "; grep -c 'faq/ask' "$JS" || true
echo -n "  是否仍硬编码旧品牌色 #980b0e（应为 0）: "; grep -c '980b0e' "$APP/frontend/dist/assets/"index-*.css || true
echo -n "  是否使用设计令牌 var(--primary)（应为 1+）: "; grep -c 'var(--primary)' "$APP/frontend/dist/assets/"index-*.css || true
echo "完成 ✓（回滚：rm -rf frontend/dist frontend/dist-ssr && cp -a frontend/dist.bak-$TAG frontend/dist && cp -a frontend/dist-ssr.bak-$TAG frontend/dist-ssr && node scripts/prerender.js --clean && pm2 restart xuanjian-guild）"
