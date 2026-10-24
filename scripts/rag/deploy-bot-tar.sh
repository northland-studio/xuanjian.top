#!/bin/bash
# 机器人服务器：部署玄剑姬 RAG（源码覆盖 + 构建 + env + systemd 重启 + 验证）
set -e
APP=/var/www/xuanjian-group-bot
TAR=/root/_bot_src.tar.gz
GROUP="${RAG_GROUPS:-860336849}"
STAMP=$(date +%Y%m%d-%H%M%S)

cd "$APP"
echo "=== 1. 备份现有 src / dist / .env ==="
cp -a src "src.bak-$STAMP"
cp -a dist "dist.bak-$STAMP"
cp -a .env ".env.bak-$STAMP"
echo "  备份后缀 .bak-$STAMP"

echo "=== 2. 解包覆盖源码 ==="
tar -xzf "$TAR" -C "$APP"
echo "  src 文件数: $(find src -name '*.ts' | wc -l)"
grep -c "handleRagMention" src/index.ts && echo "  ✓ 已含 RAG @ 接入"
grep -c "registerRagCommands" src/handlers/commands.ts && echo "  ✓ 已含 RAG 指令注册"

echo "=== 3. 安装依赖并构建 ==="
npm ci --no-audit --no-fund 2>&1 | tail -2 || npm install --no-audit --no-fund 2>&1 | tail -2
npm run build 2>&1 | tail -3
[ -f dist/index.js ] || { echo "  ✗ 构建产物缺失"; exit 1; }
echo "  ✓ dist/index.js $(ls -la dist/index.js | awk '{print $5" 字节 "$6" "$7" "$8}')"
grep -c "ragApi\|askRag" dist/services/ragApi.js 2>/dev/null || true
ls dist/handlers/rag.js >/dev/null 2>&1 && echo "  ✓ dist/handlers/rag.js 已生成"

echo "=== 4. 配置 RAG 环境变量 ==="
set_kv() {
  local k="$1" v="$2"
  if grep -qE "^$k=" .env; then sed -i "s|^$k=.*|$k=$v|" .env; else echo "$k=$v" >> .env; fi
}
set_kv RAG_ENABLED on
set_kv RAG_ALLOWED_GROUPS "$GROUP"
set_kv RAG_PRIVATE off
chmod 600 .env
grep -E '^RAG_' .env

echo "=== 5. 重启服务 ==="
systemctl restart xuanjian-group-bot
sleep 5
systemctl is-active xuanjian-group-bot

echo "=== 6. 验证 ==="
echo "--- 进程 ---"
ps -eo pid,etime,cmd | grep -E "node .*xuanjian-group-bot/dist/index\.js" | grep -v grep | head -2
echo "--- 启动日志（最近 20 行）---"
journalctl -u xuanjian-group-bot -n 20 --no-pager 2>/dev/null | tail -20
