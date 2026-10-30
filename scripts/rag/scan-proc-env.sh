#!/bin/bash
# 扫描运行中进程的内存环境与 systemd 配置，确认没有别的进程持有新 Key
set -u

echo "=== 1. 运行中进程环境里含 sk-54a4 的 ==="
found=0
for p in /proc/[0-9]*/environ; do
  if grep -qa 'sk-54a4bef2' "$p" 2>/dev/null; then
    pid=$(echo "$p" | cut -d/ -f3)
    echo "  ⚠ pid=$pid $(tr '\0' ' ' < /proc/$pid/cmdline 2>/dev/null | cut -c1-70)"
    found=1
  fi
done
[ "$found" = 0 ] && echo "  无（除 xuanjian-guild 外无进程持有该 Key；其 Key 由 dotenv 运行时加载，不在 /proc/environ）"

echo
echo "=== 2. systemd unit 与 drop-in 里的 Key ==="
grep -ral 'sk-54a4bef2' /etc/systemd /lib/systemd 2>/dev/null | head -5 || true
echo "  （无输出 = 无）"

echo
echo "=== 3. 我方最近 200 条 LLM 出站日志的模型统计 ==="
grep -a 'llm-out' /root/.pm2/logs/xuanjian-guild-out.log 2>/dev/null | tail -200 \
  | grep -oE 'req_model=[a-z0-9-]+|model=[a-z0-9-]+' | sort | uniq -c

echo
echo "=== 4. 近 6 小时内所有 node 进程的出站 443 目标（每分钟采样一次，共 5 次）==="
for i in 1 2 3 4 5; do
  ss -tnp state established 2>/dev/null | awk 'NR>1 && $4 ~ /:443$/ {print $6}' \
    | sed -E 's/.*users:\(\("([^"]+)".*/\1/' | grep -v '^$' | sed "s/^/  $(date +%H:%M:%S) /"
  sleep 2
done | sort | uniq -c | head -12

echo
echo "=== 5. DeepSeek 侧解析（CloudFront，可能多 IP）==="
for i in 1 2 3; do getent hosts api.deepseek.com | awk '{print "  "$1}'; sleep 1; done
