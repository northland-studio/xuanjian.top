#!/bin/bash
cd /var/www/xuanjian-guild || exit 1
JS=$(ls -t frontend/dist/assets/index-*.js 2>/dev/null | head -1)
echo "线上 JS: $(basename "$JS")"
echo -n "fin-page 命中: "; grep -c 'fin-page' "$JS" || true
echo -n "我的持仓 命中: "; grep -c '我的持仓' "$JS" || true
echo -n "OAuth 应用 命中: "; grep -c 'OAuth 应用' "$JS" || true
echo -n "总资产 命中: "; grep -c '总资产' "$JS" || true
echo "--- 首页/股市/接口 ---"
for u in https://xuanjian.top/ https://xuanjian.top/stocks https://xuanjian.top/api/express-index/quotes https://xuanjian.top/api/express-index/history?stockId=15; do
  echo -n "  $u -> "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 "$u"
done
