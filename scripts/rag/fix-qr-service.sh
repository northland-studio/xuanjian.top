#!/bin/bash
# 修复：密钥注入 + 降低重连频率（避免触发机器人服务器 sshd 限流）+ 复测
set -u
SECRET=$(cat /opt/notice-qr/secret.txt)

echo "=== 1. 用 wrapper 注入 QR_SECRET（不再依赖文件内替换）==="
cat > /opt/notice-qr/run.sh <<EOS
#!/bin/bash
export QR_SECRET='$SECRET'
export QR_PORT=3911
export QR_UPSTREAM='http://127.0.0.1:13005/'
exec /usr/bin/env node /opt/notice-qr/qr-server.mjs
EOS
chmod +x /opt/notice-qr/run.sh
if pm2 describe notice-qr >/dev/null 2>&1; then
  pm2 delete notice-qr >/dev/null 2>&1 || true
fi
pm2 start /opt/notice-qr/run.sh --name notice-qr --interpreter none >/dev/null
pm2 save >/dev/null 2>&1 || true
sleep 3

echo
echo "=== 2. 隧道重连改为 30 秒退避（降低 sshd 压力）==="
cat > /opt/napcat-qr-tunnel.sh <<'EOS'
#!/bin/bash
while true; do
  ssh -i /root/.ssh/id_napcat -p 20043 \
      -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes -o ConnectTimeout=10 -N \
      -L 13005:127.0.0.1:3999 root@43.248.3.161
  echo "[$(date '+%F %T')] 断开，30 秒后重连" >> /tmp/napcat-qr-tunnel.log
  sleep 30
done
EOS
chmod +x /opt/napcat-qr-tunnel.sh
pm2 restart napcat-qr-tunnel >/dev/null 2>&1 || true

# 管理号隧道同样降频，避免双重重连打满 sshd
if [ -f /opt/napcat-admin-tunnel.sh ]; then
  sed -i 's/^  sleep 5$/  sleep 30/' /opt/napcat-admin-tunnel.sh
  pm2 restart napcat-admin-tunnel >/dev/null 2>&1 || true
  echo "  管理号隧道重连间隔已改为 30s"
fi

echo
echo "=== 3. 等待 sshd 限流恢复（45 秒）后测试 ==="
sleep 45
echo -n "  HK→bot ssh 测试: "
timeout 20 ssh -i /root/.ssh/id_napcat -p 20043 -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes root@43.248.3.161 'echo OK' 2>&1 | head -2

echo
echo "=== 4. 隧道与服务状态 ==="
sleep 5
echo -n "  13005 监听: "; ss -lnt 2>/dev/null | grep -c ':13005 ' || true
echo -n "  本地 3911: "; curl -s -o /tmp/q4.png -w '%{http_code} %{content_type} %{size_download}B\n' --max-time 15 "http://127.0.0.1:3911/$SECRET.png"
file /tmp/q4.png 2>/dev/null | head -1
echo -n "  公网: "; curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}B\n' --max-time 25 "https://notice.xuanjian.top/qr-admin/$SECRET.png"
echo
echo "  ★ 实时二维码：https://notice.xuanjian.top/qr-admin/$SECRET.png"
echo "  --- 隧道日志 ---"
tail -3 /tmp/napcat-qr-tunnel.log 2>/dev/null || echo "  无日志"
