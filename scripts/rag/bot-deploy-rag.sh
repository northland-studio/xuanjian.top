#!/bin/bash
# 机器人服务器部署脚本：应用 bundle → 构建 → 配置 RAG 环境变量 → 重启
# 用法（在机器人服务器上）：bash /root/bot-deploy-rag.sh /root/_bot.bundle
set -e

BUNDLE="${1:-/root/_bot.bundle}"
GROUP="${RAG_GROUPS:-860336849}"

echo "=== 1. 定位项目目录 ==="
APP=""
for cand in /root/xuanjian-group-bot /root/bot /opt/xuanjian-group-bot /root/XUANBOT /opt/bot; do
  [ -d "$cand/.git" ] && APP="$cand" && break
done
if [ -z "$APP" ]; then
  APP=$(find /root /opt -maxdepth 3 -type d -name "xuanjian-group-bot" 2>/dev/null | head -1)
fi
if [ -z "$APP" ]; then echo "✗ 未找到项目目录，请手工确认"; exit 1; fi
echo "  项目: $APP"
cd "$APP"
echo "  当前: $(git rev-parse --abbrev-ref HEAD 2>/dev/null) $(git log --oneline -1 2>/dev/null)"
echo "  脏文件: $(git status --porcelain | wc -l)"

echo "=== 2. 备份 ==="
STAMP=$(date +%Y%m%d-%H%M%S)
cp -a src "src.bak-$STAMP"
[ -f .env ] && cp -a .env ".env.bak-$STAMP"
[ -d dist ] && cp -a dist "dist.bak-$STAMP"
echo "  已备份为 *.bak-$STAMP"

echo "=== 3. 应用代码 bundle ==="
git fetch "$BUNDLE" master:refs/remotes/bundle/master 2>&1 | tail -2
git merge --ff-only bundle/master 2>&1 | tail -2
echo "  现在: $(git log --oneline -1)"

echo "=== 4. 安装依赖并构建 ==="
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund 2>&1 | tail -2; else npm install --no-audit --no-fund 2>&1 | tail -2; fi
npm run build 2>&1 | tail -3
[ -f dist/index.js ] && echo "  ✓ dist/index.js 已生成" || { echo "  ✗ 构建产物缺失"; exit 1; }

echo "=== 5. 写入 RAG 环境变量 ==="
touch .env
set_kv() {
  local k="$1" v="$2"
  if grep -qE "^$k=" .env; then
    sed -i "s|^$k=.*|$k=$v|" .env
  else
    echo "$k=$v" >> .env
  fi
}
set_kv RAG_ENABLED on
set_kv RAG_ALLOWED_GROUPS "$GROUP"
set_kv RAG_PRIVATE off
chmod 600 .env
grep -E '^RAG_' .env

echo "=== 6. 重启服务 ==="
if command -v pm2 >/dev/null && pm2 ls 2>/dev/null | grep -qiE 'bot'; then
  NAME=$(pm2 ls 2>/dev/null | awk '/bot|napcat-bot/ {print $2; exit}')
  echo "  pm2 重启: $NAME"
  pm2 restart "$NAME" --update-env >/dev/null 2>&1 && pm2 save >/dev/null 2>&1
elif systemctl list-unit-files 2>/dev/null | grep -qiE 'bot'; then
  UNIT=$(systemctl list-unit-files 2>/dev/null | awk '/bot.*\.service/ {print $1; exit}')
  echo "  systemd 重启: $UNIT"
  systemctl restart "$UNIT"
  sleep 3
  systemctl is-active "$UNIT"
else
  echo "  ⚠ 未识别服务管理器，需手工重启（可能是 screen/tmux/手工进程）"
  ps -eo pid,etime,cmd | grep -E 'node .*index\.js|tsx src/index' | grep -v grep | head -3
fi

echo "=== 7. 校验 ==="
sleep 4
ps -eo pid,etime,cmd | grep -E 'node .*index\.js' | grep -v grep | head -2 | cut -c1-120
ss -lntp 2>/dev/null | grep ':3001' >/dev/null && echo "  ✓ 3001 在监听" || echo "  (!) 3001 未监听"
echo "=== 完成 ==="
