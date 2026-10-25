#!/bin/bash
# 精确统计 LLM token 消耗构成，定位 20 元花在哪
cd /var/www/xuanjian-guild || exit 1
node -e "
require('dotenv').config();
const db=require('./database');
(async()=>{
  const s=await db.get(\"SELECT COUNT(*) n, SUM(CASE WHEN total_tokens>0 THEN 1 ELSE 0 END) withTok, SUM(prompt_tokens) pt, SUM(completion_tokens) ct, SUM(total_tokens) tt, AVG(CASE WHEN total_tokens>0 THEN total_tokens END) avg_tok, MAX(total_tokens) max_tok FROM rag_qa_logs\");
  console.log('=== 总量 ===');
  console.log(JSON.stringify(s,null,1));

  console.log('=== 按日 ===');
  const byday=await db.all(\"SELECT date(created_at) d, COUNT(*) n, SUM(prompt_tokens) pt, SUM(completion_tokens) ct, SUM(total_tokens) tt FROM rag_qa_logs GROUP BY d ORDER BY d\");
  byday.forEach(r=>console.log('  '+r.d+' 请求='+r.n+' 输入='+r.pt+' 输出='+r.ct+' 合计='+r.tt));

  console.log('=== 单请求最高的 10 条 ===');
  const top=await db.all('SELECT id, source_type, total_tokens tt, prompt_tokens pt, completion_tokens ct, latency_ms, status, substr(question,1,24) q, created_at FROM rag_qa_logs ORDER BY total_tokens DESC LIMIT 10');
  top.forEach(r=>console.log('  #'+r.id+' '+r.source_type+' 合计='+r.tt+' (in='+r.pt+'/out='+r.ct+') '+r.latency_ms+'ms '+r.created_at+' | '+r.q));

  console.log('=== 被引用触发的\"纠正重试\"次数（按日志无法直接判定，先看 citation 相关字段）===');
  const cites=await db.all(\"SELECT COUNT(*) n FROM rag_qa_logs WHERE diagnostics LIKE '%citation%'\");
  console.log(JSON.stringify(cites));

  console.log('=== 关键配置（settings 表实际值）===');
  const keys=['llm.model','llm.disableThinking','rag.maxOutputTokens','rag.maxContextChars','rag.finalChunkCount','rag.vectorTopK','rag.ftsTopK','rag.maxQuestionLength','rag.dailyBudget','rag.costAlertThreshold','embedding.model','embedding.dimension'];
  for (const k of keys) {
    const row=await db.get('SELECT value FROM settings WHERE key = ?', ['rag.'+k]);
    const row2=await db.get('SELECT value FROM settings WHERE key = ?', [k]);
    console.log('  '+k+' = '+(row?row.value:(row2?row2.value:'(默认值)')));
  }

  console.log('=== 今日按来源 ===');
  const today=await db.all(\"SELECT source_type, COUNT(*) n, SUM(total_tokens) tt FROM rag_qa_logs WHERE date(created_at)=date('now','localtime') GROUP BY source_type\");
  console.log(JSON.stringify(today));

  console.log('=== 会话与最近日志时间 ===');
  const last=await db.all('SELECT id, source_type, total_tokens, created_at, status, substr(question,1,20) q FROM rag_qa_logs ORDER BY id DESC LIMIT 8');
  last.forEach(r=>console.log('  #'+r.id+' '+r.source_type+' tok='+r.total_tokens+' '+r.status+' '+r.created_at+' | '+r.q));
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1)});
"
