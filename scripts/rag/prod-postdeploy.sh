#!/bin/bash
# 玄剑姬：配置模型密钥 → 重启 → 健康检查 → 后台全量索引
set -e
APP=/var/www/xuanjian-guild
cd "$APP"

echo "=== 1. 写入模型密钥（仅当为空时）==="
if ! grep -qE '^RAG_EMBEDDING_KEY=.+' .env; then
  sed -i 's|^RAG_EMBEDDING_KEY=.*|RAG_EMBEDDING_KEY=sk-prglmnpvrtzhelluumkmxrcavlpxvozehfglpkwqknyvzjza|' .env
fi
if ! grep -qE '^RAG_LLM_KEY=.+' .env; then
  sed -i 's|^RAG_LLM_KEY=.*|RAG_LLM_KEY=sk-33a0de06305a4e6494fe4644e289eecc|' .env
fi
chmod 600 .env
grep -cE '^RAG_SECRET_KEY=.+' .env | sed 's/^/  RAG_SECRET_KEY 已配置: /'
grep -cE '^RAG_EMBEDDING_KEY=.+' .env | sed 's/^/  RAG_EMBEDDING_KEY 已配置: /'
grep -cE '^RAG_LLM_KEY=.+' .env | sed 's/^/  RAG_LLM_KEY 已配置: /'

echo "=== 2. 重启并健康检查 ==="
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1
sleep 6
for u in "https://xuanjian.top/" "https://xuanjian.top/api/health" "https://xuanjian.top/admin" "https://xuanjian.top/wiki"; do
  echo "  $u -> $(curl -s -o /dev/null -w '%{http_code}' --max-time 12 "$u")"
done
echo "=== 3. RAG 运行时日志 ==="
pm2 logs xuanjian-guild --lines 60 --nostream 2>/dev/null | grep -a 'rag' | tail -6 || echo "  （暂无 rag 日志）"

echo "=== 4. 启动全量索引（后台）==="
nohup node /root/rag-rebuild.js > /tmp/rag-rebuild.log 2>&1 &
echo "  PID $!，日志 /tmp/rag-rebuild.log"
sleep 20
tail -5 /tmp/rag-rebuild.log || true
