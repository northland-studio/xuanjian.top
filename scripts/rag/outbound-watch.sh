#!/bin/bash
# 出站监控：长期记录「进程 → 对端 IP:443」，用于发现非玄剑姬进程访问 DeepSeek
LOG=/var/log/rag-outbound.log
: >> "$LOG"

# 已知我方进程（允许访问外部的）
ALLOW_PATTERN='xuanjian-guild/server.js|xuanjian-group-bot|curl'

echo "[$(date '+%F %T')] 监控启动" >> "$LOG"
while true; do
  ts=$(date '+%F %T')
  ss -tnp state established 2>/dev/null | awk 'NR>1 && $4 ~ /:443$/ {print $5, $6}' | while read -r peer proc; do
    pidname=$(echo "$proc" | sed -E 's/.*users:\(\("([^"]+)".*/\1/')
    [ -z "$pidname" ] && continue
    # 只记录不属于白名单的进程，避免刷屏；白名单进程每小时抽样记录一次
    if ! echo "$pidname" | grep -qE "$ALLOW_PATTERN"; then
      echo "$ts SUSPECT process=$pidname peer=$peer" >> "$LOG"
    fi
  done
  sleep 5
done
