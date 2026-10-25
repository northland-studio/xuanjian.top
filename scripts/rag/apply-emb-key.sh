#!/bin/bash
# 应用新 Embedding Key + 部署降级标记，并验证
set -u
APP=/var/www/xuanjian-guild
cd "$APP"
NEWKEY=sk-guruksrblvusqqvdkruikwkxagdcqhngulaqxwgsyhmmjfdl

echo "=== 1. 写入新 Embedding Key ==="
cp .env ".env.bak-embkey-$(date +%Y%m%d-%H%M%S)"
if grep -qE '^RAG_EMBEDDING_KEY=' .env; then
  sed -i "s|^RAG_EMBEDDING_KEY=.*|RAG_EMBEDDING_KEY=$NEWKEY|" .env
else
  echo "RAG_EMBEDDING_KEY=$NEWKEY" >> .env
fi
chmod 600 .env
grep -E '^RAG_(EMBEDDING|LLM)_KEY=' .env | sed -E 's/=(sk-[a-zA-Z0-9]{4})[a-zA-Z0-9]*([a-zA-Z0-9]{4})/=\1****\2/'

echo
echo "=== 2. 新 Key 的 Embedding 连通性 ==="
node -e "
require('dotenv').config();
const emb=require('./lib/rag/embedding');
(async()=>{ const t=await emb.test(); console.log(t.ok?('  ✓ 可用 '+t.model+' / '+t.dimension+' 维'):('  ✗ '+t.error)); process.exit(0); })();"

echo
echo "=== 3. 应用服务端降级标记补丁 ==="
cp /root/ask.js lib/rag/ask.js
cp /root/faq.js routes/faq.js
cp /root/qqbot-rag.js routes/qqbot-rag.js
node --check lib/rag/ask.js && node --check routes/faq.js && node --check routes/qqbot-rag.js && echo "  语法 OK"

echo
echo "=== 4. 部署前端 ==="
bash /root/deploy-fe-fix.sh 2>&1 | tail -4

echo
echo "=== 5. 重启并验证（应带 degraded=true）==="
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1
sleep 6
TOKEN=$(grep '^QQBOT_TOKEN=' .env | cut -d= -f2- | tr -d '"')
curl -s --max-time 120 -X POST https://xuanjian.top/api/qqbot/rag/ask \
  -H 'Content-Type: application/json' -H "X-Bot-Token: $TOKEN" \
  --data-binary '{"question":"贡献点怎么获得","userId":"90003","groupId":"860336849"}' \
| node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  ok='+j.ok+' degraded='+(j.degraded===true)+' 来源='+((j.sources||[]).map(x=>x.title).join('/')||'-'));console.log('  '+String(j.answer||j.error||'').replace(/\s+/g,' ').slice(0,160))})"

echo
echo "=== 6. 后台状态里的向量可用性 ==="
pm2 logs xuanjian-guild --lines 80 --nostream 2>/dev/null | grep -a 'rag' | tail -3
