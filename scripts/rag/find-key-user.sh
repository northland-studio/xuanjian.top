#!/bin/bash
# 在 HK 上找出谁在用玄剑姬那把 Key（sk-33a0d...eecc），以及是否有人调用 v4-pro
KEYPART='sk-33a0de06'
echo "=== 1. 含该 Key 前缀的配置文件（排除 node_modules）==="
grep -rIl --exclude-dir=node_modules --exclude-dir=.git "$KEYPART" /var/www /opt /root 2>/dev/null | head -10

echo
echo "=== 2. 各自看模型配置 ==="
for f in $(grep -rIl --exclude-dir=node_modules --exclude-dir=.git "$KEYPART" /var/www /opt /root 2>/dev/null | head -10); do
  echo "--- $f ---"
  grep -E 'MODEL|model' "$f" 2>/dev/null | grep -v '^#' | head -5
done

echo
echo "=== 3. 全盘搜 deepseek-v4-pro 出现在哪些配置里 ==="
grep -rIl --exclude-dir=node_modules --exclude-dir=.git 'deepseek-v4-pro' /var/www /opt /root 2>/dev/null | head -10

echo
echo "=== 4. Zhuopu 实际用的模型与 Key 来源 ==="
cd /var/www/zhuopu 2>/dev/null && {
  grep -E '^DEEPSEEK|^LLM_|MODEL' .env 2>/dev/null | sed -E 's/(KEY=.{8}).*/\1****/'
  node -e "
  require('dotenv').config();
  const db=require('./server/dist/db/index.js');
  (async()=>{
    try{
      const rows=await db.all(\"SELECT key, value FROM settings WHERE key LIKE '%model%' OR key LIKE '%deepseek%' OR key LIKE '%llm%'\");
      console.log(JSON.stringify(rows.map(r=>({k:r.key, v:String(r.value).slice(0,40)}))));
    }catch(e){console.log('settings 查询失败:', e.message)}
    process.exit(0);
  })();" 2>&1 | head -5
}

echo
echo "=== 5. 近两天 Zhuopu 的 LLM 调用量（若有用量表）==="
cd /var/www/zhuopu 2>/dev/null && node -e "
require('dotenv').config();
const db=require('./server/dist/db/index.js');
(async()=>{
  for (const q of [\"SELECT COUNT(*) n, SUM(input_tokens) i, SUM(output_tokens) o FROM llm_usage WHERE created_at >= datetime('now','-2 days')\",
                   \"SELECT model, COUNT(*) n, SUM(input_tokens) i, SUM(output_tokens) o FROM llm_usage WHERE created_at >= datetime('now','-2 days') GROUP BY model\"]) {
    try { console.log(JSON.stringify(await db.all(q))); } catch(e) { console.log('  查询失败: ' + e.message); }
  }
  process.exit(0);
})();" 2>&1 | head -6
