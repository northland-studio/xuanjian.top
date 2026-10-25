#!/bin/bash
# 部署第四轮并验证：token 下降 + 缓存透出
set -e
APP=/var/www/xuanjian-guild
cd "$APP"
cp /root/config.js lib/rag/config.js
cp /root/faq.js routes/faq.js
cp /root/qqbot-rag.js routes/qqbot-rag.js
node --check lib/rag/config.js && node --check routes/faq.js && node --check routes/qqbot-rag.js
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1
sleep 6
echo -n "首页: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 https://xuanjian.top/

JAR=/tmp/tok4.txt; rm -f "$JAR"
askq() { curl -s -c "$JAR" -b "$JAR" --max-time 90 -X POST https://xuanjian.top/api/faq/ask -H 'Content-Type: application/json' --data-binary "{\"question\":\"$1\"}"; }

echo "=== 新问题（真实调用，看 token）==="
askq "公会怎么加入" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  ok='+j.ok+' cached='+(j.cached===true)+' 来源数='+((j.sources||[]).length)+' 答案长度='+String(j.answer||'').length)})"

echo "=== 同一问题再问一次（应 cached=true）==="
askq "公会怎么加入" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  ok='+j.ok+' cached='+(j.cached===true)+' 答案长度='+String(j.answer||'').length)})"

echo "=== 最近 token ==="
node -e "
require('dotenv').config();
const db=require('./database');
(async()=>{
  const rows=await db.all('SELECT id,status,total_tokens,prompt_tokens,completion_tokens,substr(question,1,14) q FROM rag_qa_logs ORDER BY id DESC LIMIT 4');
  rows.forEach(r=>console.log('  #'+r.id+' '+r.status+' tok='+r.total_tokens+' (in='+r.prompt_tokens+'/out='+r.completion_tokens+') | '+r.q));
  const l=await db.get(\"SELECT COALESCE(SUM(llm_tokens),0) t, COALESCE(SUM(requests),0) n FROM rag_usage_daily WHERE day=date('now')\");
  console.log('  今日: '+l.n+' 次请求 / '+l.t+' tokens（上限 120000）');
  process.exit(0);
})();"
