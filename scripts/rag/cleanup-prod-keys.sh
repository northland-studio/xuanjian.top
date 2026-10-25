#!/bin/bash
# 清理脚本里残留的生产 Key（改为从环境变量读取）
set -u
DIR=/var/www/xuanjian-guild/scripts/rag

echo "=== 清理前命中 ==="
grep -rl --include='*.js' --include='*.sh' -E 'sk-prglmnpvrtz|sk-54a4bef2|sk-33a0de06' "$DIR" 2>/dev/null | sed 's|.*/||'

echo
echo "=== 逐个替换为环境变量 ==="
for f in $(grep -rl --include='*.js' --include='*.sh' -E 'sk-prglmnpvrtz|sk-54a4bef2|sk-33a0de06' "$DIR" 2>/dev/null); do
  cp "$f" "$f.bak-key"
  sed -i -E "s/sk-prglmnpvrtzhelluumkmxrcavlpxvozehfglpkwqknyvzjza/\${RAG_EMBEDDING_KEY:-}/g; s/sk-54a4bef2923643e99671b6d9f6988cb9/\${RAG_LLM_KEY:-}/g; s/sk-33a0de06305a4e6494fe4644e289eecc/\${RAG_LLM_KEY:-}/g" "$f"
  echo "  已处理 $(basename "$f")"
done

echo
echo "=== 清理后命中（应为 0）==="
grep -rl --include='*.js' --include='*.sh' -E 'sk-prglmnpvrtz|sk-54a4bef2|sk-33a0de06' "$DIR" 2>/dev/null | wc -l
echo "（.bak-key 备份可稍后删除：rm -f $DIR/*.bak-key）"

echo
echo "=== .env 里当前 Key（打码）==="
grep -E '^RAG_(EMBEDDING|LLM)_KEY=' /var/www/xuanjian-guild/.env | sed -E 's/=(sk-[a-zA-Z0-9]{4})[a-zA-Z0-9]*([a-zA-Z0-9]{4})/=\1****\2/'
