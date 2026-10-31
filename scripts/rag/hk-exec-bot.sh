#!/bin/bash
# HK 侧：把脚本投到机器人服务器并执行（cat 管道，避免 scp 握手问题）
KEY=/root/.ssh/id_napcat
HOST=root@43.248.3.161
OPTS="-p 20043 -o StrictHostKeyChecking=no -o ConnectTimeout=8 -o BatchMode=yes"
SRC=${1:-/tmp/probe-napcat.sh}
DST=${2:-/root/probe-napcat.sh}

timeout 20 ssh -i "$KEY" $OPTS "$HOST" "cat > $DST" < "$SRC" || { echo "上传失败"; exit 1; }
echo "[HK] 已上传，开始执行"
timeout 90 ssh -i "$KEY" $OPTS "$HOST" "bash $DST" 2>&1
echo "[HK] 退出码 $?"
