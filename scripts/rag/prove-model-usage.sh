#!/bin/bash
# 证明玄剑姬只调用 deepseek-flash，并检查是否有任何配置/脚本可能指定 v4-pro
APP=/var/www/xuanjian-guild
cd "$APP"

echo "=== 1. 日志里出现过的模型（应只有 deepseek-flash）==="
node -e "
require('dotenv').config();
const db=require('./database');
(async()=>{
  const rows=await db.all('SELECT llm_model, COUNT(*) n FROM rag_qa_logs GROUP BY llm_model');
  rows.forEach(r=>console.log('  model='+r.llm_model+'  次数='+r.n));
  process.exit(0);
})();"

echo
echo "=== 2. 生效的 LLM 配置 ==="
node -e "
require('dotenv').config();
const config=require('./lib/rag/config');
(async()=>{
  const c=await config.getAll();
  console.log('  llm.provider = '+c['llm.provider']);
  console.log('  llm.baseUrl  = '+c['llm.baseUrl']);
  console.log('  llm.model    = '+c['llm.model']);
  console.log('  llm.disableThinking = '+c['llm.disableThinking']);
  process.exit(0);
})();"
node -e "
require('dotenv').config();
const db=require('./database');
(async()=>{
  const r=await db.all(\"SELECT key,value FROM settings WHERE key LIKE 'rag.llm%'\");
  console.log('  settings 覆盖项: ' + (r.length?JSON.stringify(r):'无'));
  process.exit(0);
})();"

echo
echo "=== 3. 全量搜索可能指定 v4-pro 的地方（代码/脚本/配置）==="
grep -rIn --exclude-dir=node_modules --exclude-dir=.git -E 'deepseek-v4-pro|v4-pro' \
  /var/www/xuanjian-guild /opt/xuanjian-notice /root/*.sh 2>/dev/null | grep -v 'diagnose\|find-key' | head -8
echo "  （无输出 = 除排查脚本外没有任何地方指定 v4-pro）"

echo
echo "=== 4. 本机（HK）其他服务是否调用 DeepSeek ==="
ss -tnp 2>/dev/null | grep -E ':443' | head -5
echo "  --- 各 node 进程的出站连接 ---"
for pid in $(pgrep -f 'node ' | head -8); do
  name=$(ps -p "$pid" -o comm= 2>/dev/null)
  cmd=$(ps -p "$pid" -o args= 2>/dev/null | cut -c1-60)
  echo "  pid=$pid $cmd"
done
