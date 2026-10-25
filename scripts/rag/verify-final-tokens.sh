#!/bin/bash
# 用机器人通道（额度更宽）量最终 token，并验证缓存
APP=/var/www/xuanjian-guild
cd "$APP"
TOKEN=$(grep '^OFFICIAL_BOT_TOKEN=' /var/www/xuanjian-group-bot/.env 2>/dev/null | cut -d= -f2- | tr -d '"')
[ -z "$TOKEN" ] && TOKEN=$(grep '^QQBOT_TOKEN=' .env | cut -d= -f2- | tr -d '"')
BASE=https://xuanjian.top

askbot() {
  curl -s --max-time 120 -X POST "$BASE/api/qqbot/rag/ask" \
    -H 'Content-Type: application/json' -H "X-Bot-Token: $TOKEN" \
    --data-binary "{\"question\":\"$1\",\"userId\":\"90001\",\"groupId\":\"860336849\"}"
}

echo "=== 1. 新问题（真实 LLM 调用）==="
askbot "贡献点怎么获得" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  ok='+j.ok+' cached='+(j.cached===true)+' 来源='+((j.sources||[]).map(x=>x.title).join('/')||'-'));console.log('  答案长度='+String(j.answer||j.error||'').length)})"

echo "=== 2. 同问题再问（应 cached=true，0 token）==="
askbot "贡献点怎么获得" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  ok='+j.ok+' cached='+(j.cached===true))})"

echo "=== 3. 换一个群（缓存按问题共享，游客/机器人各自隔离？此处机器人按主体+问题）==="
askbot "活动什么时候举行" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  ok='+j.ok+' cached='+(j.cached===true)+' 来源数='+((j.sources||[]).length))})"

echo "=== 4. 最近消耗 ==="
node -e "
require('dotenv').config();
const db=require('./database');
(async()=>{
  const rows=await db.all('SELECT id,status,total_tokens,prompt_tokens,completion_tokens,substr(question,1,16) q FROM rag_qa_logs ORDER BY id DESC LIMIT 6');
  rows.forEach(r=>console.log('  #'+r.id+' '+r.status+' tok='+r.total_tokens+' (in='+r.prompt_tokens+'/out='+r.completion_tokens+') | '+r.q));
  const a=await db.get(\"SELECT AVG(total_tokens) a FROM rag_qa_logs WHERE total_tokens>0 AND created_at>=datetime('now','-15 minutes')\");
  console.log('  最近真实调用平均: '+Math.round(a.a||0)+' tokens/次（优化前 1607）');
  const t=await db.get(\"SELECT COALESCE(SUM(llm_tokens),0) t FROM rag_usage_daily WHERE day=date('now')\");
  console.log('  今日累计: '+t.t+' / 120000');
  process.exit(0);
})();"
