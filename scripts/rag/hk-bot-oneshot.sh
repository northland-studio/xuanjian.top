#!/bin/bash
# HK 侧：生成单连接投递载荷（bundle + 部署脚本 + 部署 + 验证，一次 SSH 完成）
# 然后以低频重试守护执行，避免触发对方限流。
set -u
STAGE=/root/bot-deploy
KEY=/root/.ssh/id_napcat
HOST=root@43.248.3.161
SOPTS="-p 20043 -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes -o ServerAliveInterval=10"
LOG=$STAGE/deploy2.log
GROUP=${RAG_GROUPS:-860336849}
INTERVAL=${INTERVAL:-300}
MAX_TRIES=${MAX_TRIES:-12}

mkdir -p "$STAGE"
: > "$LOG"
log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

log "生成单连接载荷..."
{
  echo 'set -e'
  echo 'echo "== 解码 bundle =="'
  echo 'cat > /root/_bot.b64 << "B64EOF"'
  base64 -w0 "$STAGE/_bot.bundle"
  echo ''
  echo 'B64EOF'
  echo 'base64 -d /root/_bot.b64 > /root/_bot.bundle && rm -f /root/_bot.b64'
  echo 'echo "  bundle 字节: $(wc -c < /root/_bot.bundle)"'
  echo 'echo "  sha256: $(sha256sum /root/_bot.bundle | cut -d" " -f1)"'
  echo 'echo "== 写入部署脚本 =="'
  echo 'cat > /root/bot-deploy-rag.sh << "SHSEOF"'
  cat "$STAGE/bot-deploy-rag.sh"
  echo 'SHSEOF'
  echo 'chmod +x /root/bot-deploy-rag.sh'
  echo "echo '== 执行部署（群 ${GROUP}）=='"
  echo "RAG_GROUPS=${GROUP} bash /root/bot-deploy-rag.sh /root/_bot.bundle"
  echo 'echo "== 部署后验证 =="'
  echo 'ps -eo pid,etime,cmd | grep -E "node .*index\.js" | grep -v grep | head -3 || true'
  echo 'echo "--- 3001 ---"'
  echo 'ss -lntp 2>/dev/null | grep ":3001" || echo "3001 未监听"'
  echo 'echo "--- .env RAG ---"'
  echo 'grep -E "^RAG_" .env 2>/dev/null || echo "无 RAG 环境变量"'
  echo 'echo "== DONE =="'
} > "$STAGE/payload.sh"

LI=$(wc -l < "$STAGE/payload.sh")
BY=$(wc -c < "$STAGE/payload.sh")
log "载荷生成完成：$LI 行 / $BY 字节"

for i in $(seq 1 "$MAX_TRIES"); do
  log "── 第 $i/$MAX_TRIES 次尝试（间隔 ${INTERVAL}s）──"
  OUT=$(timeout 180 ssh -i "$KEY" $SOPTS "$HOST" 'bash -s' < "$STAGE/payload.sh" 2>&1 | tr -d '\r')
  RC=$?
  echo "$OUT" | tee -a "$LOG"

  if echo "$OUT" | grep -q '== DONE =='; then
    log "✓ 部署完成"
    exit 0
  fi
  log "✗ 本次未完成（rc=$RC），${INTERVAL}s 后重试"
  sleep "$INTERVAL"
done

log "✗ 达到最大尝试次数"
exit 1
