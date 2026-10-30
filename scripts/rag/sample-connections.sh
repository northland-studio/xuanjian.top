#!/bin/bash
# 高频采样 443 出站连接，记录「进程 → 对端 IP」，抓 60 秒
set -u
OUT=/tmp/conn-samples.txt
: > "$OUT"

echo "=== 1. 目标服务 IP 段 ==="
echo -n "  api.deepseek.com: "; getent hosts api.deepseek.com | awk '{print $1}' | tr '\n' ' '; echo
echo -n "  api.siliconflow.cn: "; getent hosts api.siliconflow.cn | awk '{print $1}' | tr '\n' ' '; echo

echo
echo "=== 2. 采样 60 秒（每 0.3s 一次），期间触发 4 次问答 ==="
(
  end=$((SECONDS + 60))
  while [ $SECONDS -lt $end ]; do
    ss -tnp state established 2>/dev/null | awk '/:443/ {print $5, $6}' >> "$OUT"
    sleep 0.3
  done
) &
SAMPLER=$!

sleep 3
TOKEN=$(grep '^QQBOT_TOKEN=' /var/www/xuanjian-guild/.env | cut -d= -f2- | tr -d '"')
for q in "入会条件" "贡献点用途" "活动时间" "保证金"; do
  curl -s --max-time 60 -o /dev/null -X POST https://xuanjian.top/api/qqbot/rag/ask \
    -H 'Content-Type: application/json' -H "X-Bot-Token: $TOKEN" \
    --data-binary "{\"question\":\"$q\",\"userId\":\"90030\",\"groupId\":\"860336849\"}"
  sleep 1
done

wait $SAMPLER 2>/dev/null || true

echo
echo "=== 3. 采样到的「对端 IP + 进程」==="
awk '{print $1, $2}' "$OUT" | sed -E 's/users:\(\("([^"]+)".*/\1/' | sort | uniq -c | sort -rn | head -20

echo
echo "=== 4. 命中 DeepSeek(CloudFront 3.x / 13.x) 的记录 ==="
grep -E '^3\.|^13\.|^52\.|^54\.' "$OUT" | awk '{print $1, $2}' | sed -E 's/users:\(\("([^"]+)".*/\1/' | sort | uniq -c | head -10
echo "  （若有非 xuanjian-guild 的进程出现，即为可疑出站）"

echo
echo "=== 5. 玄剑姬进程 PID 对照 ==="
pgrep -af 'xuanjian-guild/server.js' | head -2
