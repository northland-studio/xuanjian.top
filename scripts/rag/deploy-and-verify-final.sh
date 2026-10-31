#!/bin/bash
# 部署前端 + 真实业务验证（任务结算 → 买入 → 持仓 → 卖出）
set -u
APP=/var/www/xuanjian-guild
cd "$APP"

echo "=== 1. 部署前端 ==="
TAG=final-$(date +%Y%m%d-%H%M%S)
cp -a frontend/dist "frontend/dist.bak-$TAG" 2>/dev/null || true
rm -rf frontend/dist.new && mkdir -p frontend/dist.new
tar -xzf /root/deploy-stock/dist.tgz -C frontend/dist.new
rm -rf frontend/dist && mv frontend/dist.new frontend/dist
rm -rf frontend/dist-ssr && mkdir -p frontend/dist-ssr
tar -xzf /root/deploy-stock/dist-ssr.tgz -C frontend/dist-ssr
rm -rf frontend/prerender
node scripts/prerender.js --clean 2>&1 | tail -1
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1
sleep 6
echo -n "  首页: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 https://xuanjian.top/
echo -n "  /stocks: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 https://xuanjian.top/stocks

echo
echo "=== 2. 真实业务验证 ==="
TOKEN=$(node -e "
process.chdir('/var/www/xuanjian-guild');
require('/var/www/xuanjian-guild/node_modules/dotenv').config({ path: '/var/www/xuanjian-guild/.env', quiet: true });
const jwt=require('/var/www/xuanjian-guild/node_modules/jsonwebtoken');
process.stdout.write(jwt.sign({userId:2, level:1}, process.env.JWT_SECRET, {expiresIn:'20m'}));
" 2>/dev/null)

api() { curl -s --max-time 20 -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" "$@"; }

echo "--- 2.1 创建绑定「玄剑重工(id=15)」的任务，奖励 K=2 ---"
TASK=$(api -X POST http://127.0.0.1:3000/api/tasks --data-binary '{"title":"测试-权重股任务","description":"自动化验证用","reward":2,"stock_id":15}')
TASK_ID=$(echo "$TASK" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.id||j.task?.id||'')})")
CODE=$(echo "$TASK" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.code||'')})")
echo "  taskId=$TASK_ID code=$CODE"

echo "--- 2.2 领取并完成该任务（N=1）---"
api -X POST "http://127.0.0.1:3000/api/tasks/$TASK_ID/claim" -d '{}' >/dev/null
api -X POST "http://127.0.0.1:3000/api/tasks/$TASK_ID/complete" --data-binary "{\"code\":\"$CODE\"}" | head -c 200; echo

echo "--- 2.3 结算后股价（应 5 → 5+ΔP，ΔP=20×2×(1/10)÷1=4）---"
curl -s --max-time 15 https://xuanjian.top/api/express-index/quotes > /tmp/q2.json
node -e "
const j=require('/tmp/q2.json');
j.stocks.forEach(s=>console.log('  '+s.name+' 现价='+s.price+' 昨收='+s.yesterdayClose+' 涨跌='+s.change));
"
echo "--- 2.4 结算流水 ---"
curl -s --max-time 15 'https://xuanjian.top/api/express-index/settlements?limit=3' | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);(j.settlements||[]).forEach(r=>console.log('  '+r.stock_name+' '+r.price_before+' → '+r.price_after+' ΔP='+r.delta+' K='+r.reward+' N='+r.finish_count))})"

echo "--- 2.5 买入 1 股玄剑重工 ---"
api -X POST http://127.0.0.1:3000/api/express-index/buy --data-binary '{"stockId":15,"shares":1}' | head -c 260; echo

echo "--- 2.6 持仓 ---"
api http://127.0.0.1:3000/api/express-index/holdings | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);
if(!j.ok){console.log('  '+JSON.stringify(j).slice(0,200));return}
console.log('  汇总: 市值='+j.summary.marketValue+' 成本='+j.summary.cost+' 盈亏='+j.summary.profit);
(j.items||[]).forEach(i=>console.log('  '+i.name+' 持有'+i.shares+'股 均价='+i.avgCost+' 现价='+i.price+' 盈亏='+i.profit))})"

echo "--- 2.7 卖出 1 股（清仓）---"
api -X POST http://127.0.0.1:3000/api/express-index/sell --data-binary '{"stockId":15,"shares":1}' | head -c 260; echo

echo "--- 2.8 持仓应清空 ---"
api http://127.0.0.1:3000/api/express-index/holdings | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  持仓数='+((j.items||[]).length)+' 市值='+j.summary.marketValue)})"

echo "--- 2.9 手动收盘快照 ---"
api -X POST http://127.0.0.1:3000/api/express-index/snapshot --data-binary '{}' | head -c 160; echo
