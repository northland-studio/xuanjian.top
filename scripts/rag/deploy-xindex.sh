#!/bin/bash
# 部署哲式动态指数系统（迁移 + 后端 + 自动结算）
set -e
APP=/var/www/xuanjian-guild
cd "$APP"
TAG=xindex-$(date +%Y%m%d-%H%M%S)

echo "=== 1. 备份 ==="
sqlite3 data/guild.db "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null 2>&1 || true
cp data/guild.db "data/guild.db.bak-$TAG"
cp server.js "server.js.bak-$TAG"
cp routes/tasks.js "routes/tasks.js.bak-$TAG"
echo "  $TAG"

echo "=== 2. 应用文件 ==="
cp /root/xindex-lib.js lib/express-index.js
cp /root/xindex-routes.js routes/express-index.js
cp /root/server-xindex.js server.js
cp /root/tasks-xindex.js routes/tasks.js
cp /root/migrate-express-index.js scripts/
node --check lib/express-index.js && node --check routes/express-index.js && node --check server.js && node --check routes/tasks.js
echo "  语法 OK"

echo "=== 3. 迁移 ==="
node scripts/migrate-express-index.js 2>&1 | grep -v dotenv

echo "=== 4. 重启并验证 ==="
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1
sleep 6
echo -n "  首页: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 https://xuanjian.top/

echo "=== 5. /quotes 行情 ==="
curl -s --max-time 15 https://xuanjian.top/api/express-index/quotes | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{const j=JSON.parse(s);
    if(!j.ok){console.log('  ✗ '+JSON.stringify(j).slice(0,200));return}
    console.log('  参数: 哲指数='+j.settings.zheIndex+' 股价基准='+j.settings.priceBase+' 活跃基准='+j.settings.activeBase+' 买入费='+j.settings.buyFeeRate+' 卖出税='+j.settings.sellTaxRate);
    j.stocks.forEach(x=>console.log('  '+x.name+' 现价='+x.price+' 昨收='+x.yesterdayClose+' 涨跌='+x.change+' ('+x.changePct+'%) 可买='+x.canBuy));
  }catch(e){console.log('  解析失败: '+s.slice(0,200))}
})"

echo "=== 6. 公式自检（不落库，纯函数校验）==="
node -e "
const cfg={zheIndex:20,priceBase:5,activeBase:10};
const f=require('./lib/express-index').calcDelta;
const cases=[
  {K:2,N:5,P:10,expect:10},
  {K:20,N:10,P:5,expect:400},
  {K:100,N:3,P:50,expect:60},
  {K:1,N:10,P:25,expect:4}
];
cases.forEach(c=>{
  const r=f({K:c.K,N:c.N,P:c.P,cfg});
  console.log('  K='+c.K+' N='+c.N+' P='+c.P+' → ΔP='+r.delta+(Math.abs(r.delta-c.expect)<0.01?' ✓':' ✗ 期望 '+c.expect)+ (r.floored?' [熔断]':''));
});
// 熔断：P=2 应等价于分母 1，与 P=5 相同
const a=f({K:2,N:5,P:2,cfg}).delta;
const b=f({K:2,N:5,P:5,cfg}).delta;
console.log('  熔断校验 P=2 ('+a+') === P=5 ('+b+') → '+(a===b?'✓':'✗'));
" 2>&1 | grep -v dotenv

echo "=== 7. 手动结算接口鉴权（未登录应 401/403）==="
curl -s -o /dev/null -w '  POST /settle 未登录 -> %{http_code}\n' -X POST https://xuanjian.top/api/express-index/settle -H 'Content-Type: application/json' --data-binary '{"taskId":1}'
