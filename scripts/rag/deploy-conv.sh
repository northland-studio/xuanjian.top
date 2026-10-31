#!/bin/bash
# 部署「换服贡献点折算」：迁移 + 服务端 + 前端
set -e
APP=/var/www/xuanjian-guild
STAGE=/root/deploy-conv
cd "$APP"

echo "=== 1. 备份 ==="
TAG=conv-$(date +%Y%m%d-%H%M%S)
sqlite3 data/guild.db "PRAGMA wal_checkpoint(TRUNCATE);" || true
cp data/guild.db "data/guild.db.bak-$TAG"
cp server.js "server.js.bak-$TAG"
mkdir -p "lib.bak-$TAG" "routes.bak-$TAG"
cp lib/contribution-conversion.js "lib.bak-$TAG/" 2>/dev/null || true
cp routes/contribution-conversion.js "routes.bak-$TAG/" 2>/dev/null || true
cp -a frontend/dist "frontend/dist.bak-$TAG"
echo "  备份后缀：$TAG"

echo "=== 2. 应用服务端文件 ==="
cp /root/conv-lib.js lib/contribution-conversion.js
cp /root/conv-routes.js routes/contribution-conversion.js
cp /root/server-new.js server.js
node --check lib/contribution-conversion.js && node --check routes/contribution-conversion.js && node --check server.js
echo "  语法 OK"

echo "=== 3. 执行迁移（幂等）==="
cp /root/migrate-contribution-conversion.js scripts/
cp /root/migrate-contribution-logs-real.js scripts/
node scripts/migrate-contribution-conversion.js
node scripts/migrate-contribution-logs-real.js

echo "=== 4. 部署前端 ==="
rm -rf frontend/dist.new && mkdir -p frontend/dist.new
tar -xzf "$STAGE/dist.tgz" -C frontend/dist.new
[ -f frontend/dist.new/index.html ] || { echo "缺少 index.html"; exit 1; }
rm -rf frontend/dist && mv frontend/dist.new frontend/dist
rm -rf frontend/dist-ssr && mkdir -p frontend/dist-ssr
tar -xzf "$STAGE/dist-ssr.tgz" -C frontend/dist-ssr
rm -rf frontend/prerender
node scripts/prerender.js --clean 2>&1 | tail -2

echo "=== 5. 重启并验证 ==="
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1
sleep 6
echo -n "  首页: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 https://xuanjian.top/
echo -n "  管理后台: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 https://xuanjian.top/admin

echo "=== 6. 接口鉴权检查（未登录应 401）==="
for p in "/api/contributions/conversion/candidates" "/api/contributions/conversion/list"; do
  echo "  $p -> $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://xuanjian.top$p")"
done

echo "=== 7. 生产数据核对 ==="
node -e "
require('dotenv').config();
const db=require('./database');
const conv=require('./lib/contribution-conversion');
(async()=>{
  const cands=await conv.listCandidates({scope:'positive'});
  console.log('  候选人数(>0, 已排除系统账号/托管账户): ' + cands.length);
  console.log('  前 5 名: ' + cands.slice(0,5).map(u=>u.nickname+'('+u.contribution+')').join(', '));
  console.log('  是否含 market_escrow: ' + cands.some(u=>u.username==='market_escrow'));
  const plan=await conv.buildPlan({mode:'uniform', uniformRatio:0.5, scope:'positive'});
  console.log('  试算统一×0.5: ' + plan.affected + ' 人, 总额 ' + plan.totalBefore + ' → ' + plan.totalAfter);
  process.exit(0);
})();" 2>&1 | grep -v dotenv
