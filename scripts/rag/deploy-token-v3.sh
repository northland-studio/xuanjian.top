#!/bin/bash
# 部署第三轮并验证缓存与 token
set -e
APP=/var/www/xuanjian-guild
cd "$APP"
cp /root/ask.js lib/rag/ask.js
node --check lib/rag/ask.js
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1
sleep 6
echo -n "首页: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 https://xuanjian.top/

JAR=/tmp/tok3.txt; rm -f "$JAR"
askq() {
  curl -s -c "$JAR" -b "$JAR" --max-time 90 -X POST https://xuanjian.top/api/faq/ask \
    -H 'Content-Type: application/json' --data-binary "{\"question\":\"$1\"}"
}

echo "=== 同一问题 ×2（第二个应 cached）==="
askq "贡献点怎么获得" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  1st ok='+j.ok+' cached='+(j.cached===true)+' len='+String(j.answer||'').length)})"
askq "贡献点怎么获得" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  2nd ok='+j.ok+' cached='+(j.cached===true)+' len='+String(j.answer||'').length)})"

echo "=== 新问题（真实调用）==="
askq "活动什么时候举行" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  ok='+j.ok+' cached='+(j.cached===true)+' 来源='+((j.sources||[]).map(x=>x.title).join('/')||'-'))})"

echo "=== 日志 token ==="
node -e "
require('dotenv').config();
const db=require('./database');
(async()=>{
  const rows=await db.all('SELECT id,status,total_tokens,prompt_tokens,completion_tokens,abstained,substr(question,1,16) q FROM rag_qa_logs ORDER BY id DESC LIMIT 5');
  rows.forEach(r=>console.log('  #'+r.id+' '+r.status+' tok='+r.total_tokens+' (in='+r.prompt_tokens+'/out='+r.completion_tokens+') | '+r.q));
  const a=await db.get(\"SELECT AVG(total_tokens) a FROM rag_qa_logs WHERE total_tokens>0 AND created_at>=datetime('now','-10 minutes')\");
  console.log('  最近 10 分钟真实调用平均: '+Math.round(a.a||0)+' tokens');
  const l=await db.get(\"SELECT COALESCE(SUM(llm_tokens),0) t FROM rag_usage_daily WHERE day=date('now')\");
  console.log('  今日累计: '+l.t+' / 120000');
  process.exit(0);
})();"
