#!/bin/bash
# HK 侧守护：等机器人服务器 SSH 恢复后自动部署玄剑姬 RAG，并写日志
# 日志：/root/bot-deploy/deploy.log
set -u
KEY=/root/.ssh/id_napcat
HOST=root@43.248.3.161
SOPTS="-p 20043 -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes -o ServerAliveInterval=10"
STAGE=/root/bot-deploy
LOG=$STAGE/deploy.log
MAX_TRIES=${MAX_TRIES:-80}     # 80 次 × 90s ≈ 2 小时
INTERVAL=${INTERVAL:-90}

mkdir -p "$STAGE"
: > "$LOG"

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

log "守护启动：最多 $MAX_TRIES 次尝试，间隔 ${INTERVAL}s"

for i in $(seq 1 "$MAX_TRIES"); do
  log "第 $i 次探测 SSH..."
  OUT=$(timeout 25 ssh -i "$KEY" $SOPTS "$HOST" 'echo SSH_OK' 2>&1 | tr -d '\r')
  if echo "$OUT" | grep -q 'SSH_OK'; then
    log "SSH 已恢复，开始部署"

    log "→ 上传 bundle 与部署脚本（cat 管道）"
    timeout 60 ssh -i "$KEY" $SOPTS "$HOST" 'cat > /root/_bot.bundle' < "$STAGE/_bot.bundle" || { log "✗ bundle 上传失败"; continue; }
    timeout 60 ssh -i "$KEY" $SOPTS "$HOST" 'cat > /root/bot-deploy-rag.sh' < "$STAGE/bot-deploy-rag.sh" || { log "✗ 脚本上传失败"; continue; }
    log "  bundle: $(timeout 20 ssh -i "$KEY" $SOPTS "$HOST" 'wc -c < /root/_bot.bundle' 2>/dev/null) 字节"

    log "→ 执行部署（RAG_ALLOWED_GROUPS=860336849）"
    timeout 600 ssh -i "$KEY" $SOPTS "$HOST" 'RAG_GROUPS=860336849 bash /root/bot-deploy-rag.sh /root/_bot.bundle' 2>&1 | tee -a "$LOG"
    RC=${PIPESTATUS[0]}

    if [ "$RC" -eq 0 ]; then
      log "→ 部署后验证"
      V=$(timeout 40 ssh -i "$KEY" $SOPTS "$HOST" 'echo "--- ps ---"; ps -eo pid,etime,cmd | grep -E "node .*index\.js" | grep -v grep | head -2; echo "--- 3001 ---"; ss -lntp 2>/dev/null | grep ":3001" || echo "3001 未监听"; echo "--- env ---"; grep -E "^RAG_" .env 2>/dev/null || true' 2>&1)
      echo "$V" | tee -a "$LOG"
      log "✓ 部署流程结束（请检查上面的 ps/3001/env 输出）"
      exit 0
    else
      log "✗ 部署脚本失败（rc=$RC），继续等待下次重试"
    fi
  else
    log "  SSH 仍不可用：$(echo "$OUT" | tail -1)"
  fi
  sleep "$INTERVAL"
done

log "✗ 达到最大尝试次数仍失败，停止"
exit 1
