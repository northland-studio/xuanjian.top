#!/bin/bash
# 安装 tcpdump 并抓包：验证玄剑姬进程出站只连 api.deepseek.com（且无法看到模型名，靠我方日志）
set -u

echo "=== 1. 安装 tcpdump ==="
if ! command -v tcpdump >/dev/null; then
  (apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq tcpdump >/dev/null 2>&1) && echo "  已安装" || echo "  安装失败（可能无源）"
else
  echo "  已存在"
fi
command -v tcpdump >/dev/null && tcpdump --version 2>/dev/null | head -1

echo
echo "=== 2. 先解析目标 IP ==="
getent hosts api.deepseek.com

echo
echo "=== 3. 抓 20 秒 TLS SNI（同时触发两次问答）==="
if command -v tcpdump >/dev/null; then
  timeout 25 tcpdump -i any -nn -s 300 -l 'tcp port 443 and (tcp[((tcp[12] & 0xf0) >> 2)] = 0x16)' 2>/dev/null \
    | grep -aoE '(api\.deepseek\.com|api\.siliconflow\.cn|[a-z0-9.-]+\.xuanjian\.top|[a-z0-9.-]+\.deepseek\.com|[a-z0-9.-]+\.qiniu[a-z.]*)' \
    | sort | uniq -c \
    > /tmp/sni.txt &
  CAP=$!

  sleep 3
  TOKEN=$(grep '^QQBOT_TOKEN=' /var/www/xuanjian-guild/.env | cut -d= -f2- | tr -d '"')
  for q in "入会条件" "贡献点用途"; do
    curl -s --max-time 60 -o /dev/null -X POST https://xuanjian.top/api/qqbot/rag/ask \
      -H 'Content-Type: application/json' -H "X-Bot-Token: $TOKEN" \
      --data-binary "{\"question\":\"$q\",\"userId\":\"90020\",\"groupId\":\"860336849\"}"
    sleep 2
  done
  wait $CAP 2>/dev/null || true
  echo "  --- 捕获到的出站域名 ---"
  cat /tmp/sni.txt
else
  echo "  跳过（无 tcpdump）"
fi

echo
echo "=== 4. 我方出站日志（应有两条，req_model 均为 deepseek-flash）==="
pm2 logs xuanjian-guild --lines 40 --nostream 2>/dev/null | grep -a 'llm-out' | tail -3

echo
echo "=== 5. 当前进程建立的 HTTPS 连接（按进程）==="
ss -tnp state established 2>/dev/null | grep ':443' | head -10 || echo "  无（连接都是短连接，抓不到属正常）"
