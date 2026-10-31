#!/bin/bash
# 修复：所有到机器人服务器的隧道加 IPQoS=throughput（默认 DSCP 被打掉导致 KEX 卡死）
set -u
SECRET=$(cat /opt/notice-qr/secret.txt)

echo "=== 1. 重写二维码隧道 ==="
cat > /opt/napcat-qr-tunnel.sh <<'EOS'
#!/bin/bash
# 13005 → 机器人服务器 3999（管理员号二维码 HTTP）
while true; do
  ssh -i /root/.ssh/id_napcat -p 20043 \
      -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes -o ConnectTimeout=10 -o IPQoS=throughput -N \
      -L 13005:127.0.0.1:3999 root@43.248.3.161
  echo "[$(date '+%F %T')] 断开，30 秒后重连" >> /tmp/napcat-qr-tunnel.log
  sleep 30
done
EOS
chmod +x /opt/napcat-qr-tunnel.sh

echo "=== 2. 重写管理号隧道（13004 → 3002）==="
cat > /opt/napcat-admin-tunnel.sh <<'EOS'
#!/bin/bash
# 13004 → 机器人服务器 3002（管理员号 NapCat OneBot）
while true; do
  ssh -i /root/.ssh/id_napcat -p 20043 \
      -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes -o ConnectTimeout=10 -o IPQoS=throughput -N \
      -L 13004:127.0.0.1:3002 root@43.248.3.161
  echo "[$(date '+%F %T')] 断开，30 秒后重连" >> /tmp/napcat-admin-tunnel.log
  sleep 30
done
EOS
chmod +x /opt/napcat-admin-tunnel.sh

echo "=== 3. 重启两个隧道 ==="
pm2 restart napcat-qr-tunnel napcat-admin-tunnel >/dev/null 2>&1 || {
  pm2 delete napcat-qr-tunnel napcat-admin-tunnel >/dev/null 2>&1 || true
  pm2 start /opt/napcat-qr-tunnel.sh --name napcat-qr-tunnel --interpreter none >/dev/null
  pm2 start /opt/napcat-admin-tunnel.sh --name napcat-admin-tunnel --interpreter none >/dev/null
}
pm2 save >/dev/null 2>&1 || true
sleep 8

echo
echo "=== 4. 验证 ==="
echo -n "  13005 监听: "; ss -lnt 2>/dev/null | grep -c ':13005 ' || true
echo -n "  13004 监听: "; ss -lnt 2>/dev/null | grep -c ':13004 ' || true
echo -n "  13005 取二维码: "; curl -s -o /tmp/qa.png -w '%{http_code} %{size_download}B\n' --max-time 12 http://127.0.0.1:13005/
echo -n "  本地 3911: "; curl -s -o /tmp/qb.png -w '%{http_code} %{content_type} %{size_download}B\n' --max-time 15 "http://127.0.0.1:3911/$SECRET.png"
file /tmp/qb.png 2>/dev/null | head -1
echo -n "  公网: "; curl -s -o /tmp/qc.png -w '%{http_code} %{content_type} %{size_download}B\n' --max-time 25 "https://notice.xuanjian.top/qr-admin/$SECRET.png"
file /tmp/qc.png 2>/dev/null | head -1
echo
echo "  ★ 实时二维码（随时打开都是最新）："
echo "  https://notice.xuanjian.top/qr-admin/$SECRET.png"
