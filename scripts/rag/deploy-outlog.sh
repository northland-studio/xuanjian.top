#!/bin/bash
# 部署 LLM 出站日志并验证
set -u
APP=/var/www/xuanjian-guild
cd "$APP"
cp lib/rag/llm.js lib/rag/llm.js.bak-outlog 2>/dev/null || true
cp /root/llm.js lib/rag/llm.js
node --check lib/rag/llm.js && echo "语法 OK"

pm2 restart xuanjian-guild --update-env >/dev/null 2>&1
sleep 6

TOKEN=$(grep '^QQBOT_TOKEN=' .env | cut -d= -f2- | tr -d '"')
curl -s --max-time 90 -X POST https://xuanjian.top/api/qqbot/rag/ask \
  -H 'Content-Type: application/json' -H "X-Bot-Token: $TOKEN" \
  --data-binary '{"question":"保证金什么时候退","userId":"90011","groupId":"860336849"}' \
| node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  问答 ok='+j.ok+' degraded='+(j.degraded===true)+' 来源='+((j.sources||[]).map(x=>x.title).join('/')||'-'))})"

sleep 1
echo
echo "=== 出站日志（模型与 token）==="
pm2 logs xuanjian-guild --lines 80 --nostream 2>/dev/null | grep -a 'llm-out' | tail -3
