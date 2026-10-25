#!/bin/bash
# 官网：部署新版前端（抽屉背景/淡化）+ 新版 prompt，并重启验证
set -e
APP=/var/www/xuanjian-guild
cd "$APP"

echo "=== 1. 更新服务端 prompt ==="
cp lib/rag/ask.js "lib/rag/ask.js.bak-v4" 2>/dev/null || true
cp /root/ask.js lib/rag/ask.js
node --check lib/rag/ask.js
echo "  语法 OK，版本：$(grep -o 'rag-prompt-v[0-9]' lib/rag/ask.js | head -1)"
grep -c 'MC像素金剑发卡' lib/rag/ask.js | sed 's/^/  新设定已包含: /'

echo "=== 2. 部署前端 ==="
bash /root/deploy-fe-fix.sh 2>&1 | tail -5

echo "=== 3. 重启并验证 ==="
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1
sleep 6
echo -n "  首页: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 https://xuanjian.top/
echo "  产物: $(ls frontend/dist/assets/index-*.js | xargs -n1 basename | tr '\n' ' ')"
echo "  背景图: $(grep -o 'xjj1.png' frontend/dist/assets/index-*.css | head -1)"
echo -n "  淡化强度(亮色第1段): "; grep -o 'rgba(255, 255, 255, [0-9.]*)' frontend/dist/assets/index-*.css | head -1
echo "  RAG 运行时日志:"
pm2 logs xuanjian-guild --lines 60 --nostream 2>/dev/null | grep -a 'rag' | tail -3 || true
