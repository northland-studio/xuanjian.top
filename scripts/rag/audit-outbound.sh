#!/bin/bash
# 排查 HK 上到底是谁在出站访问 DeepSeek / 谁在用那把 Key
set -u

echo "=== 1. 所有 node 进程（含完整命令行与工作目录）==="
for pid in $(pgrep -f node | sort -n); do
  cmd=$(tr '\0' ' ' < /proc/$pid/cmdline 2>/dev/null | cut -c1-90)
  cwd=$(readlink /proc/$pid/cwd 2>/dev/null)
  [ -n "$cmd" ] && echo "  pid=$pid cwd=$cwd"
  [ -n "$cmd" ] && echo "        $cmd"
done

echo
echo "=== 2. 进程环境变量里含 DEEPSEEK / RAG_LLM_KEY 的（仅报进程名，不打印值）==="
for pid in $(pgrep -f 'node|python' 2>/dev/null | sort -n | head -40); do
  envs=$(tr '\0' '\n' < /proc/$pid/environ 2>/dev/null)
  if echo "$envs" | grep -qE 'DEEPSEEK|RAG_LLM_KEY|RAG_EMBEDDING_KEY|OPENAI_API_KEY'; then
    name=$(echo "$envs" | grep -cE 'DEEPSEEK|RAG_LLM_KEY|RAG_EMBEDDING_KEY|OPENAI_API_KEY')
    cmd=$(tr '\0' ' ' < /proc/$pid/cmdline 2>/dev/null | cut -c1-70)
    echo "  ⚠ pid=$pid 命中 ${name} 个相关变量 | $cmd"
  fi
done
echo "  （若只有 xuanjian-guild 命中则正常）"

echo
echo "=== 3. 到 DeepSeek 的出站连接（含进程）==="
DEEPSEEK_IPS=$(getent hosts api.deepseek.com | awk '{print $1}' | tr '\n' ' ')
echo "  api.deepseek.com -> $DEEPSEEK_IPS"
ss -tnp state established 2>/dev/null | awk 'NR==1 || /:443/' | head -15

echo
echo "=== 4. 抓 15 秒 TLS SNI（谁能看到 api.deepseek.com）==="
if command -v tcpdump >/dev/null; then
  timeout 15 tcpdump -i any -l -nn -s 256 'tcp port 443 and (tcp[((tcp[12] & 0xf0) >> 2)] = 0x16)' 2>/dev/null \
    | grep -oE 'api\.deepseek\.com|[a-z0-9.-]+\.siliconflow\.cn|[a-z0-9.-]+\.xuanjian\.top' \
    | sort | uniq -c | head -10
  echo "  （上面的域名=15 秒内出站 TLS 目标）"
else
  echo "  无 tcpdump"
fi

echo
echo "=== 5. 定时任务（可能藏着 AI 调用）==="
crontab -l 2>/dev/null | grep -v '^#' | head -10
ls /etc/cron.d/ 2>/dev/null | head -5
systemctl list-timers --all --no-pager 2>/dev/null | head -6

echo
echo "=== 6. 近 10 分钟内访问 api.deepseek.com 的进程（通过 nginx/日志不可见，改用连接快照）==="
ss -tnp 2>/dev/null | grep -E '443' | wc -l | sed 's/^/  当前 443 连接总数: /'
