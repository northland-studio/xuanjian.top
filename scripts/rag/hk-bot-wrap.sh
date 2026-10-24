#!/bin/bash
# HK 侧包装：上传探查脚本到机器人服务器并执行（scp 用 -P，ssh 用 -p）
KEY=/root/.ssh/id_napcat
HOST=root@43.248.3.161
SSH_OPTS="-p 20043 -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes"
SCP_OPTS="-P 20043 -o StrictHostKeyChecking=no -o ConnectTimeout=5"

echo "[HK] 上传..."
timeout 20 scp -q -i "$KEY" $SCP_OPTS /tmp/bot-deploy-probe.sh "$HOST:/root/bot-deploy-probe.sh" || { echo "[HK] scp 失败"; exit 1; }
echo "[HK] 执行..."
timeout 45 ssh -i "$KEY" $SSH_OPTS "$HOST" 'bash /root/bot-deploy-probe.sh' || echo "[HK] 远端失败/超时（码 $?）"
