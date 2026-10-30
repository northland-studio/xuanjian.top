#!/bin/bash
# 全盘搜新 Key（含 sqlite 数据库二进制）与 v4-pro 引用
set -u
echo "=== 1. 含新 Key 前缀 sk-54a4 的文件（含二进制）==="
grep -ral --exclude-dir=node_modules --exclude-dir=.git 'sk-54a4bef2' /var/www /opt /root /etc 2>/dev/null | head -20
echo "  （若出现 xuanjian-guild/.env 之外的文件，即为泄漏点）"

echo
echo "=== 2. 含 v4-pro 字样的文件（含数据库）==="
grep -ral --exclude-dir=node_modules --exclude-dir=.git 'deepseek-v4-pro' /var/www /opt /root /etc 2>/dev/null | head -20

echo
echo "=== 3. Zhuopu 的 settings 表（可能存了 Key 与模型）==="
DB=/var/www/zhuopu/data/zhuopu.db
if [ -f "$DB" ]; then
  sqlite3 "$DB" "SELECT key, substr(value,1,30) FROM settings WHERE key LIKE '%model%' OR key LIKE '%key%' OR key LIKE '%llm%' OR key LIKE '%deepseek%';" 2>/dev/null | head -20
  echo "  --- 是否有 sk-54a4 出现在库中 ---"
  grep -ac 'sk-54a4bef2' "$DB" 2>/dev/null | sed 's/^/  命中行数: /'
else
  echo "  数据库不存在"
fi

echo
echo "=== 4. 机器人服务器 .env 是否含新 Key（经 HK 转发）==="
grep -aE '^(DEEPSEEK|RAG_LLM_KEY|LLM)' /var/www/xuanjian-group-bot/.env 2>/dev/null | sed -E 's/(=.{6}).*/\1****/' || echo "  本机无该文件"

echo
echo "=== 5. 所有 sqlite 数据库里搜 v4-pro（可能是别的项目存了模型名）==="
for db in $(find /var/www /opt /root -maxdepth 4 -name '*.db' -o -maxdepth 4 -name '*.sqlite' 2>/dev/null | head -12); do
  hit=$(grep -ac 'deepseek-v4-pro' "$db" 2>/dev/null || echo 0)
  [ "$hit" != "0" ] && echo "  $db -> 命中 $hit 行"
done
echo "  （结束）"
