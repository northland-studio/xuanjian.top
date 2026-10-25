#!/bin/bash
# 1) 检查生产实际使用的 Embedding Key 来源与可用性
# 2) 更换 LLM Key 为新的，重启并验证问答
set -u
APP=/var/www/xuanjian-guild
cd "$APP"

echo "=== 1. 当前 .env 里的 RAG Key（打码）==="
grep -E '^RAG_(SECRET|EMBEDDING|LLM)_KEY=' .env | sed -E 's/=(sk-[a-zA-Z0-9]{4})[a-zA-Z0-9]*([a-zA-Z0-9]{4})/=\1****\2/'

echo
echo "=== 2. Embedding Key 实际来源与连通性（代码路径）==="
node -e "
require('dotenv').config();
const config=require('./lib/rag/config');
const emb=require('./lib/rag/embedding');
(async()=>{
  try{
    const envKey=process.env.RAG_EMBEDDING_KEY||'';
    const dbKey=await config.apiKey('embedding');
    console.log('  env 有 Key: ' + (envKey?'是':'否') + ' | 实际取用来源: ' + (dbKey===envKey?'env':'db/加密'));
    console.log('  实际 Key 前缀: ' + (dbKey?dbKey.slice(0,8)+'****'+dbKey.slice(-4):'(空)'));
    const t=await emb.test();
    console.log('  连通性: ' + (t.ok?('✓ 可用 '+t.model+' / '+t.dimension+' 维'):('✗ '+t.error)));
  }catch(e){ console.log('  检查失败: '+e.message) }
  process.exit(0);
})();"

echo
echo "=== 3. 更换 LLM Key ==="
NEWKEY=sk-54a4bef2923643e99671b6d9f6988cb9
cp .env ".env.bak-llmkey-$(date +%Y%m%d-%H%M%S)"
if grep -qE '^RAG_LLM_KEY=' .env; then
  sed -i "s|^RAG_LLM_KEY=.*|RAG_LLM_KEY=$NEWKEY|" .env
else
  echo "RAG_LLM_KEY=$NEWKEY" >> .env
fi
chmod 600 .env
grep -E '^RAG_LLM_KEY=' .env | sed -E 's/=(sk-[a-zA-Z0-9]{4})[a-zA-Z0-9]*([a-zA-Z0-9]{4})/=\1****\2/'

echo
echo "=== 4. LLM 连通性（新 Key）==="
node -e "
require('dotenv').config();
const llm=require('./lib/rag/llm');
(async()=>{
  const t=await llm.test();
  console.log(t.ok ? ('  ✓ ' + t.model + ' 回复：' + t.content) : ('  ✗ ' + t.error));
  process.exit(0);
})();"

echo
echo "=== 5. 重启并验证真实问答 ==="
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1
sleep 6
echo -n "  首页: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 https://xuanjian.top/
TOKEN=$(grep '^QQBOT_TOKEN=' .env | cut -d= -f2- | tr -d '"')
curl -s --max-time 120 -X POST https://xuanjian.top/api/qqbot/rag/ask \
  -H 'Content-Type: application/json' -H "X-Bot-Token: $TOKEN" \
  --data-binary '{"question":"贡献点怎么获得","userId":"90002","groupId":"860336849"}' \
| node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  ok='+j.ok+' 来源='+((j.sources||[]).map(x=>x.title).join('/')||'-'));console.log('  '+(j.error||String(j.answer||'').replace(/\s+/g,' ').slice(0,140)))})"

echo
echo "=== 6. 最近请求的模型与 token ==="
node -e "
require('dotenv').config();
const db=require('./database');
(async()=>{
  const r=await db.all('SELECT id,status,llm_model,total_tokens,error_type,substr(question,1,14) q FROM rag_qa_logs ORDER BY id DESC LIMIT 3');
  r.forEach(x=>console.log('  #'+x.id+' '+x.status+' model='+x.llm_model+' tok='+x.total_tokens+(x.error_type?' err='+x.error_type:'')+' | '+x.q));
  process.exit(0);
})();"
