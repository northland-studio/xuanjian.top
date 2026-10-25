#!/bin/bash
# 验证第二轮收紧：token 消耗对比 + 缓存命中
APP=/var/www/xuanjian-guild
cd "$APP"

echo "=== 1. 同一问题连问两次（带 cookie，模拟真实浏览器）==="
JAR=/tmp/tokjar.txt; rm -f "$JAR"
q() {
  curl -s -c "$JAR" -b "$JAR" --max-time 90 -X POST https://xuanjian.top/api/faq/ask \
    -H 'Content-Type: application/json' --data-binary "{\"question\":\"$1\"}"
}
A=$(q "贡献点怎么获得")
echo "$A" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  第 1 次: ok='+j.ok+' cached='+(j.cached===true))})"
B=$(q "贡献点怎么获得")
echo "$B" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  第 2 次: ok='+j.ok+' cached='+(j.cached===true))})"

echo "=== 2. 最近请求 token ==="
node -e "
require('dotenv').config();
const db=require('./database');
(async()=>{
  const rows=await db.all('SELECT id,question,total_tokens,prompt_tokens,completion_tokens,status FROM rag_qa_logs ORDER BY id DESC LIMIT 5');
  rows.forEach(r=>console.log('  #'+r.id+' tok='+r.total_tokens+' (in='+r.prompt_tokens+'/out='+r.completion_tokens+') '+r.status+' | '+String(r.question).slice(0,18)));
  const avg=await db.get(\"SELECT AVG(total_tokens) a FROM rag_qa_logs WHERE total_tokens>0 AND created_at >= datetime('now','-10 minutes')\");
  console.log('  最近 10 分钟平均: ' + Math.round(avg.a||0) + ' tokens/次');
  const old=await db.get(\"SELECT AVG(total_tokens) a FROM rag_qa_logs WHERE total_tokens>0 AND created_at < datetime('now','-30 minutes')\");
  console.log('  优化前平均: ' + Math.round(old.a||0) + ' tokens/次');
  const sum=await db.get(\"SELECT COALESCE(SUM(llm_tokens),0) t FROM rag_usage_daily WHERE day=date('now')\");
  console.log('  今日累计: ' + sum.t + ' / 120000');
  process.exit(0);
})();"

echo "=== 3. 回答质量抽查（不该因压缩而废）==="
q "入会需要什么条件" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  ok='+j.ok+' abstained='+j.abstained+' 来源='+((j.sources||[]).map(x=>x.title).join('/')||'-'));console.log('  '+String(j.answer||'').replace(/\s+/g,' ').slice(0,150))})"
