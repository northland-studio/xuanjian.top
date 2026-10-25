#!/bin/bash
# 部署 token 收紧补丁并验证省 token 效果
set -e
APP=/var/www/xuanjian-guild
cd "$APP"

echo "=== 1. 应用服务端补丁 ==="
for f in ask.js config.js faq.js; do :; done
cp lib/rag/ask.js "lib/rag/ask.js.bak-cost" 2>/dev/null || true
cp lib/rag/config.js "lib/rag/config.js.bak-cost" 2>/dev/null || true
cp routes/faq.js "routes/faq.js.bak-cost" 2>/dev/null || true
cp /root/ask.js lib/rag/ask.js
cp /root/config.js lib/rag/config.js
cp /root/faq.js routes/faq.js
node --check lib/rag/ask.js && node --check lib/rag/config.js && node --check routes/faq.js
echo "  语法 OK"
grep -o "'rag.maxContextChars': [0-9]*" lib/rag/config.js
grep -o "'rag.finalChunkCount': [0-9]*" lib/rag/config.js
grep -o "'rag.maxOutputTokens': [0-9]*" lib/rag/config.js
grep -o "'rag.dailyTokenLimit': [0-9]*" lib/rag/config.js

echo "=== 2. 部署前端 ==="
bash /root/deploy-fe-fix.sh 2>&1 | tail -4

echo "=== 3. 重启 ==="
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1
sleep 6

echo "=== 4. 验证：同一个问题问两次（第二次应命中缓存，0 token）==="
Q1=$(curl -s --max-time 90 -X POST https://xuanjian.top/api/faq/ask -H 'Content-Type: application/json' \
  --data-binary '{"question":"贡献点怎么获得"}')
echo "$Q1" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  第一次: ok='+j.ok+' 长度='+String(j.answer||'').length)})"
Q2=$(curl -s --max-time 90 -X POST https://xuanjian.top/api/faq/ask -H 'Content-Type: application/json' \
  --data-binary '{"question":"贡献点怎么获得"}')
echo "$Q2" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  第二次: ok='+j.ok+' cached='+(j.cached===true)+' 长度='+String(j.answer||'').length)})"

echo "=== 5. 最近请求的真实 token 消耗 ==="
node -e "
require('dotenv').config();
const db=require('./database');
(async()=>{
  const rows=await db.all('SELECT id,question,total_tokens,prompt_tokens,completion_tokens,latency_ms,status FROM rag_qa_logs ORDER BY id DESC LIMIT 4');
  rows.forEach(r=>console.log('  #'+r.id+' tok='+r.total_tokens+' (in='+r.prompt_tokens+'/out='+r.completion_tokens+') '+r.status+' | '+String(r.question).slice(0,20)));
  const avg=await db.get(\"SELECT AVG(total_tokens) a FROM rag_qa_logs WHERE total_tokens>0 AND created_at >= datetime('now','-30 minutes')\");
  console.log('  最近 30 分钟平均 token: ' + Math.round(avg.a||0));
  const lim=await db.get(\"SELECT COALESCE(SUM(llm_tokens),0) t FROM rag_usage_daily WHERE day=date('now')\");
  console.log('  今日 LLM token 累计: ' + lim.t + ' / 上限 120000');
  process.exit(0);
})();"
