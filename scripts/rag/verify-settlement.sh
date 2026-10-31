#!/bin/bash
# 补做任务结算验证（上一步 taskId 未解析出来）
set -u
cd /var/www/xuanjian-guild || exit 1

TASK_ID=$(sqlite3 data/guild.db "SELECT id FROM tasks WHERE title='测试-权重股任务' ORDER BY id DESC LIMIT 1;")
CODE=$(sqlite3 data/guild.db "SELECT code FROM tasks WHERE id=$TASK_ID;")
echo "taskId=$TASK_ID code=$CODE stock_id=$(sqlite3 data/guild.db "SELECT stock_id FROM tasks WHERE id=$TASK_ID;")"

TOKEN=$(node -e "
process.chdir('/var/www/xuanjian-guild');
require('/var/www/xuanjian-guild/node_modules/dotenv').config({ path: '/var/www/xuanjian-guild/.env', quiet: true });
const jwt=require('/var/www/xuanjian-guild/node_modules/jsonwebtoken');
process.stdout.write(jwt.sign({userId:2, level:1}, process.env.JWT_SECRET, {expiresIn:'20m'}));
" 2>/dev/null)
api() { curl -s --max-time 20 -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" "$@"; }

echo "--- 领取 ---"
api -X POST "http://127.0.0.1:3000/api/tasks/$TASK_ID/claim" -d '{}' | head -c 150; echo
echo "--- 完成（应触发自动结算）---"
api -X POST "http://127.0.0.1:3000/api/tasks/$TASK_ID/complete" --data-binary "{\"code\":\"$CODE\"}" | head -c 220; echo
sleep 1

echo "--- 股价（预期玄剑重工 5 → 9：ΔP=20×2×(1/10)÷1=4）---"
curl -s --max-time 15 https://xuanjian.top/api/express-index/quotes > /tmp/q3.json
node -e "
const j=require('/tmp/q3.json');
j.stocks.forEach(s=>console.log('  '+s.name+' 现价='+s.price+' 昨收='+s.yesterdayClose+' 涨跌='+s.change+' 可买='+s.canBuy));
"
echo "--- 结算流水 ---"
curl -s --max-time 15 'https://xuanjian.top/api/express-index/settlements?limit=3' | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const rs=j.settlements||[];if(!rs.length)console.log('  （无）');rs.forEach(r=>console.log('  '+r.stock_name+' '+r.price_before+' → '+r.price_after+' ΔP='+r.delta+' K='+r.reward+' N='+r.finish_count+' | '+r.formula))})"
echo "--- 历史曲线数据点 ---"
curl -s --max-time 15 'https://xuanjian.top/api/express-index/history?stockId=15&limit=10' | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  点数='+((j.points||[]).length)+' 昨收='+j.yesterdayClose);(j.points||[]).slice(-3).forEach(p=>console.log('  '+p.label+' → '+p.price))})"
