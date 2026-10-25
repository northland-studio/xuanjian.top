#!/bin/bash
# 新 Embedding Key 生效后的完整验证
set -u
APP=/var/www/xuanjian-guild
cd "$APP"
BASE=https://xuanjian.top
BOT=$(grep '^QQBOT_TOKEN=' .env | cut -d= -f2- | tr -d '"')

askbot() {
  curl -s --max-time 120 -X POST "$BASE/api/qqbot/rag/ask" \
    -H 'Content-Type: application/json' -H "X-Bot-Token: $BOT" \
    --data-binary "{\"question\":\"$1\",\"userId\":\"90010\",\"groupId\":\"860336849\"}"
}

echo "=== 1. 向量检索是否真正参与（degraded 应为 false）==="
askbot "入会需要什么条件" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  ok='+j.ok+' degraded='+(j.degraded===true)+' 来源='+((j.sources||[]).map(x=>x.title).join('/')||'-'));console.log('  '+String(j.answer||j.error||'').replace(/\s+/g,' ').slice(0,140))})"

echo "=== 2. 第二个问题（换主题，验证不同页面命中）==="
askbot "活动什么时候举行" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  ok='+j.ok+' degraded='+(j.degraded===true)+' 来源='+((j.sources||[]).map(x=>x.title).join('/')||'-'))})"

echo "=== 3. 无据可查仍要拒答（不该编）==="
askbot "公会创始人的家庭住址" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  abstained='+(j.abstained===true)+' 回答: '+String(j.answer||'').replace(/\s+/g,' ').slice(0,90))})"

echo "=== 4. 向量表与索引一致性 ==="
node -e "
require('dotenv').config();
const db=require('./database');
const vec=require('./lib/rag/vec');
(async()=>{
  await vec.load();
  const a=await db.get('SELECT COUNT(*) c FROM rag_chunks');
  const b=await db.get('SELECT COUNT(*) c FROM rag_chunks_vec');
  const s=await db.get(\"SELECT COUNT(*) c FROM rag_page_index WHERE status='indexed'\");
  console.log('  分块='+a.c+' 向量='+b.c+' 已索引页='+s.c+' | sqlite-vec='+(vec.isReady()?vec.state.version:'不可用'));
  const t=await db.get(\"SELECT COALESCE(SUM(llm_tokens),0) t, COALESCE(SUM(requests),0) n FROM rag_usage_daily WHERE day=date('now')\");
  console.log('  今日: '+t.n+' 次 / '+t.t+' tokens');
  process.exit(0);
})();"

echo "=== 5. 最近 3 条请求（模型与 token）==="
node -e "
require('dotenv').config();
const db=require('./database');
(async()=>{
  const r=await db.all('SELECT id,status,llm_model,total_tokens,abstained,substr(question,1,14) q FROM rag_qa_logs ORDER BY id DESC LIMIT 4');
  r.forEach(x=>console.log('  #'+x.id+' '+x.status+' model='+x.llm_model+' tok='+x.total_tokens+' | '+x.q));
  process.exit(0);
})();"
