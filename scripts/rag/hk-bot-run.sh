#!/bin/bash
# 在 HK 上执行：用 cat 管道把脚本送到机器人服务器（scp 握手会卡），然后执行
KEY=/root/.ssh/id_napcat
HOST=root@43.248.3.161
SOPTS="-p 20043 -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes"
SRC=${1:-/tmp/bot-deploy-probe.sh}
DST=${2:-/root/bot-probe.sh}

echo "[HK] 上传 $SRC -> $DST（cat 管道）"
timeout 20 ssh -i "$KEY" $SOPTS "$HOST" "cat > $DST" < "$SRC"
RC=$?
if [ $RC -ne 0 ]; then echo "[HK] 上传失败 rc=$RC"; exit 1; fi
echo "[HK] 上传完成，远端行数：$(timeout 15 ssh -i "$KEY" $SOPTS "$HOST" "wc -l < $DST" 2>/dev/null)"

echo "[HK] 执行："
timeout 50 ssh -i "$KEY" $SOPTS "$HOST" "bash $DST" 2>&1
echo "[HK] 结束 rc=$?"
