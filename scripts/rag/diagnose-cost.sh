#!/bin/bash
# 定位 RAG 花费异常：调用量 / token 构成 / 索引是否在反复重建 / 关键配置
APP=/var/www/xuanjian-guild
cd "$APP" || exit 1

node -e "
require('dotenv').config();
const db=require('./database');
(async()=>{
  console.log('=== 1. 今日问答调用 ===');
  const today=await db.all(\"SELECT source_type, COUNT(*) n, SUM(total_tokens) tok, SUM(prompt_tokens) pt, SUM(completion_tokens) ct, SUM(embedding_tokens) et FROM rag_qa_logs WHERE date(created_at)=date('now') GROUP BY source_type\");
  console.log(JSON.stringify(today,null,1));
  const all=await db.get(\"SELECT COUNT(*) n, SUM(total_tokens) tok FROM rag_qa_logs\");
  console.log('累计问答:', JSON.stringify(all));

  console.log('=== 2. 按小时分布（最近 24h）===');
  const hourly=await db.all(\"SELECT strftime('%H',created_at) h, COUNT(*) n, SUM(total_tokens) tok FROM rag_qa_logs WHERE created_at >= datetime('now','-24 hours') GROUP BY h ORDER BY h\");
  console.log(JSON.stringify(hourly));

  console.log('=== 3. 索引任务（最近 24h 按小时）===');
  const tasks=await db.all(\"SELECT strftime('%H',created_at) h, type, status, COUNT(*) n FROM rag_index_tasks WHERE created_at >= datetime('now','-24 hours') GROUP BY h, type, status ORDER BY h\");
  console.log(JSON.stringify(tasks));

  console.log('=== 4. 索引任务总量与时间跨度 ===');
  const tt=await db.get('SELECT COUNT(*) n, MIN(created_at) first, MAX(created_at) last FROM rag_index_tasks');
  console.log(JSON.stringify(tt));
  const byType=await db.all('SELECT type, status, COUNT(*) n FROM rag_index_tasks GROUP BY type, status');
  console.log(JSON.stringify(byType));

  console.log('=== 5. 最近 20 个任务 ===');
  const recent=await db.all('SELECT id,type,page_id,status,attempts,created_at,finished_at,substr(last_error,1,60) err FROM rag_index_tasks ORDER BY id DESC LIMIT 20');
  recent.forEach(r=>console.log('  #'+r.id+' '+r.type+' page='+r.page_id+' '+r.status+' tries='+r.attempts+' '+r.created_at+' | '+(r.err||'')));

  console.log('=== 6. 页面索引状态分布 ===');
  const st=await db.all('SELECT status, COUNT(*) n FROM rag_page_index GROUP BY status');
  console.log(JSON.stringify(st));

  console.log('=== 7. 用量日汇总 ===');
  const usage=await db.all('SELECT * FROM rag_usage_daily ORDER BY day DESC LIMIT 5');
  console.log(JSON.stringify(usage,null,1));

  console.log('=== 8. 关键配置 ===');
  const cfg=await db.all(\"SELECT key, value FROM settings WHERE key IN ('rag.llm.disableThinking','llm.disableThinking','rag.maxOutputTokens','rag.finalChunkCount','rag.maxContextChars','rag.dailyBudget','rag.vectorTopK','rag.ftsTopK')\");
  console.log(JSON.stringify(cfg));
  const cfg2=await db.all(\"SELECT key, value FROM settings WHERE key LIKE 'rag.%' AND key IN ('rag.maxOutputTokens','rag.finalChunkCount','rag.maxContextChars','rag.dailyBudget','rag.maxQuestionLength')\");
  console.log(JSON.stringify(cfg2));

  console.log('=== 9. 单个请求平均 token ===');
  const avg=await db.get(\"SELECT AVG(total_tokens) avg_tok, MAX(total_tokens) max_tok, AVG(embedding_tokens) avg_emb FROM rag_qa_logs WHERE total_tokens>0\");
  console.log(JSON.stringify(avg));

  console.log('=== 10. 是否同页面被反复重建 ===');
  const rep=await db.all('SELECT page_id, COUNT(*) n FROM rag_index_tasks WHERE type=\\'index_page\\' GROUP BY page_id HAVING n>1 ORDER BY n DESC LIMIT 10');
  console.log(JSON.stringify(rep));
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1)});
"
