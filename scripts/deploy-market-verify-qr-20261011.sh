#!/bin/bash
# 集市核销码修复上线（20261011-2）
#
# 修两个真实问题（生产上买家下单后商家核销失败）：
#   ① 核销码二维码打不开：前端错误地指向 /api/market/qr/<order_no>.png（那个接口只认短链）→ 404 破图
#      改为浏览器本地生成二维码，内容 = 商家后台核销台深链（明文码不回传服务端）
#   ② 买家「重新生成核销码」后旧码立即失效，但界面没提醒，商家拿旧码核销 → 「核销码无效」
#      已加：下单弹窗/订单页提示、重新生成二次确认、商家核销台的失败提示、订单页找不到码时的引导
#
# 前置：$STAGE/dist.tgz、$STAGE/dist-ssr.tgz、$STAGE/market-settle.js
set -e
APP=/var/www/xuanjian-guild
STAGE=/root/deploy-market-verify-qr-20261011
TAG=20261011-market-qr-fix

cd "$APP"

echo "[1/6] 备份数据库与现有产物..."
sqlite3 data/guild.db "PRAGMA wal_checkpoint(TRUNCATE);" || true
cp data/guild.db "data/guild.db.bak-$TAG"
rm -rf "frontend/dist.bak-$TAG" "frontend/dist-ssr.bak-$TAG"
[ -d frontend/dist ] && cp -a frontend/dist "frontend/dist.bak-$TAG"
[ -d frontend/dist-ssr ] && cp -a frontend/dist-ssr "frontend/dist-ssr.bak-$TAG"
echo "    备份完成"

echo "[2/6] 后端：核销码无效时给出可操作提示..."
cp "$STAGE/market-settle.js" lib/market-settle.js
node --check lib/market-settle.js
grep -c "重新生成核销码" lib/market-settle.js | sed 's/^/    提示文案命中: /'

echo "[3/6] 替换前端产物..."
rm -rf frontend/dist.new && mkdir -p frontend/dist.new
tar -xzf "$STAGE/dist.tgz" -C frontend/dist.new
[ -f frontend/dist.new/index.html ] || { echo "    新产物缺少 index.html，中止"; exit 1; }
rm -rf frontend/dist && mv frontend/dist.new frontend/dist
rm -rf frontend/dist-ssr && mkdir -p frontend/dist-ssr
tar -xzf "$STAGE/dist-ssr.tgz" -C frontend/dist-ssr
echo -n "    新产物: "; ls frontend/dist/assets/index-*.js | xargs -n1 basename | tr '\n' ' '; echo
echo -n "    qrcode 浏览器分片: "; ls frontend/dist/assets/browser-*.js 2>/dev/null | xargs -n1 basename | tr '\n' ' '; echo
echo -n "    产物里含核销台深链: "; grep -c "/market/merchant?" frontend/dist/assets/index-*.js || true

echo "[4/6] 重建 SSG..."
rm -rf frontend/prerender
node scripts/prerender.js --clean >/tmp/verify-qr-prerender.log 2>&1 || { echo "    (!) prerender 失败"; tail -3 /tmp/verify-qr-prerender.log; }
tail -1 /tmp/verify-qr-prerender.log

echo "[5/6] 重启并健康检查..."
pm2 restart xuanjian-guild --update-env
sleep 6
for u in "/" "/market" "/market/orders" "/market/merchant" "/api/market/config"; do
  echo "  $u -> $(curl -s -o /dev/null -w '%{http_code}' "https://xuanjian.top$u")"
done
echo -n "  qrcode 分片可访问: "
QR=$(ls frontend/dist/assets/browser-*.js | head -1 | xargs -n1 basename)
curl -s -o /dev/null -w "%{http_code}\n" "https://xuanjian.top/assets/$QR"

echo "[6/6] 现状核对..."
echo "  当前待核销订单与核销码（商家应以「最新一次生成」的码为准）："
sqlite3 data/guild.db "SELECT '    #' || o.id || ' ' || o.order_no || ' 状态=' || o.status || ' 金额=' || o.buyer_pay || ' 码末四位=' || COALESCE(v.code_tail,'-') || ' 重生成次数(审计)=' || (SELECT COUNT(*) FROM market_audit_logs a WHERE a.action='verify_code_regen' AND a.target_id = o.id) FROM market_orders o LEFT JOIN market_verify_codes v ON v.order_id = o.id ORDER BY o.id;"
echo "修复上线完成 ✓"
