#!/bin/bash
# HK 侧：单连接投递部署载荷（手动触发版）
KEY=/root/.ssh/id_napcat
HOST=root@43.248.3.161
SOPTS="-p 20043 -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes -o ServerAliveInterval=10"

echo "=== 探测 SSH ==="
if ! timeout 25 ssh -i "$KEY" $SOPTS "$HOST" 'echo SSH_OK' 2>&1 | grep -q SSH_OK; then
  echo "SSH 仍不可用"
  exit 1
fi
echo "SSH 可用"

echo "=== 投递并执行（bundle + 部署 + 验证，一次连接）==="
timeout 600 ssh -i "$KEY" $SOPTS "$HOST" 'bash -s' < /root/bot-deploy/payload.sh
echo "=== 投递退出码: $? ==="
