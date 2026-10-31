#!/bin/bash
# HK：新增第二条隧道 13004 → 机器人服务器 NapCat 管理号实例 3002
set -u
KEY=/root/.ssh/id_napcat
HOST=root@43.248.3.161
NAME=napcat-admin-tunnel

echo "=== 1. 现有隧道 ==="
pm2 list 2>/dev/null | grep -E 'tunnel' | head -5

echo
echo "=== 2. 写隧道脚本 ==="
cat > /opt/napcat-admin-tunnel.sh <<'EOS'
#!/bin/bash
# 13004 → 机器人服务器 NapCat 管理号实例（127.0.0.1:3002）
while true; do
  ssh -i /root/.ssh/id_napcat -p 20043 \
      -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes -N \
      -L 13004:127.0.0.1:3002 root@43.248.3.161
  echo "[$(date '+%F %T')] 隧道断开，5 秒后重连" >> /tmp/napcat-admin-tunnel.log
  sleep 5
done
EOS
chmod +x /opt/napcat-admin-tunnel.sh

echo
echo "=== 3. pm2 注册 ==="
if pm2 describe "$NAME" >/dev/null 2>&1; then
  pm2 restart "$NAME" >/dev/null 2>&1
  echo "  已重启"
else
  pm2 start /opt/napcat-admin-tunnel.sh --name "$NAME" --interpreter none >/dev/null 2>&1
  echo "  已创建"
fi
pm2 save >/dev/null 2>&1 || true

echo
echo "=== 4. 状态 ==="
sleep 4
pm2 list 2>/dev/null | grep -E "$NAME|tunnel" | head -5
echo -n "  13004 监听: "
ss -lnt 2>/dev/null | grep -c ':13004 ' || echo 0
