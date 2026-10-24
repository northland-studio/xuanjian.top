#!/bin/bash
# HK 侧守护 v2：SSH 恢复后，用「分块 base64 + 校验」上传，再部署并验证
# 日志：/root/bot-deploy/deploy.log
set -u
KEY=/root/.ssh/id_napcat
HOST=root@43.248.3.161
SOPTS="-p 20043 -o StrictHostKeyChecking=no -o ConnectTimeout=8 -o BatchMode=yes -o ServerAliveInterval=8"
STAGE=/root/bot-deploy
LOG=$STAGE/deploy.log
CHUNK=3000
MAX_TRIES=${MAX_TRIES:-80}
INTERVAL=${INTERVAL:-90}

mkdir -p "$STAGE"
: > "$LOG"
log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

run_ssh() { timeout 30 ssh -i "$KEY" $SOPTS "$HOST" "$@" 2>&1; }

# 分块上传：输入本地文件，落地远端同一路径，校验 sha256
upload() {
  local src="$1" dst="$2" b64 remote_b64 size i=0 total sha_local sha_remote
  b64="$STAGE/upload.b64"
  base64 -w0 "$src" > "$b64"
  size=$(wc -c < "$b64")
  total=$(( (size + CHUNK - 1) / CHUNK ))
  log "  上传 $(basename "$src")：$size 字符 base64，分 $total 块"
  run_ssh "rm -f $dst.b64" >/dev/null

  while [ "$i" -lt "$total" ]; do
    local part
    part=$(dd if="$b64" bs="$CHUNK" skip="$i" count=1 2>/dev/null)
    local ok=0 tries=0
    while [ "$tries" -lt 3 ]; do
      if run_ssh "printf '%s' '$part' >> $dst.b64"; then ok=1; break; fi
      tries=$((tries+1)); sleep 2
    done
    if [ "$ok" -ne 1 ]; then log "  ✗ 第 $i 块失败"; return 1; fi
    i=$((i+1))
    [ $((i % 10)) -eq 0 ] && log "    ...$i/$total 块"
  done

  log "  解码并校验"
  run_ssh "base64 -d $dst.b64 > $dst && rm -f $dst.b64" >/dev/null
  sha_local=$(sha256sum "$src" | awk '{print $1}')
  sha_remote=$(run_ssh "sha256sum $dst" | awk '{print $1}')
  if [ "$sha_local" = "$sha_remote" ]; then
    log "  ✓ 校验通过 $sha_local"
    return 0
  fi
  log "  ✗ 校验失败 local=$sha_local remote=$sha_remote"
  return 1
}

log "守护 v2 启动：$MAX_TRIES 次，间隔 ${INTERVAL}s"

for i in $(seq 1 "$MAX_TRIES"); do
  log "第 $i 次探测 SSH..."
  OUT=$(run_ssh 'echo SSH_OK')
  if echo "$OUT" | grep -q 'SSH_OK'; then
    log "SSH 可用，开始上传与部署"
    if ! upload "$STAGE/_bot.bundle" /root/_bot.bundle; then
      log "bundle 上传失败，稍后重试"; sleep "$INTERVAL"; continue
    fi
    if ! upload "$STAGE/bot-deploy-rag.sh" /root/bot-deploy-rag.sh; then
      log "脚本上传失败，稍后重试"; sleep "$INTERVAL"; continue
    fi

    log "→ 执行部署（RAG_ALLOWED_GROUPS=860336849）"
    timeout 900 ssh -i "$KEY" $SOPTS "$HOST" 'RAG_GROUPS=860336849 bash /root/bot-deploy-rag.sh /root/_bot.bundle' 2>&1 | tee -a "$LOG"
    RC=${PIPESTATUS[0]}
    log "部署退出码：$RC"

    if [ "$RC" -eq 0 ]; then
      log "→ 部署后验证"
      timeout 60 ssh -i "$KEY" $SOPTS "$HOST" 'echo "--- node 进程 ---"; ps -eo pid,etime,cmd | grep -E "node .*index\.js" | grep -v grep | head -2; echo "--- 3001 ---"; ss -lntp 2>/dev/null | grep ":3001" || echo "3001 未监听"; echo "--- RAG env ---"; grep -E "^RAG_" .env 2>/dev/null || echo "无 RAG env"' 2>&1 | tee -a "$LOG"
      log "✓ 流程结束"
      exit 0
    fi
    log "部署失败，继续重试"
  else
    log "  SSH 不可用：$(echo "$OUT" | tail -1)"
  fi
  sleep "$INTERVAL"
done

log "✗ 达到最大尝试次数"
exit 1
