#!/bin/bash
# 测试 IPQoS=none（不打 DSCP 标记）是否能稳定连通，并据此修隧道
set -u
H=root@43.248.3.161
K=/root/.ssh/id_napcat
B="-i $K -p 20043 -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes"

echo "=== 1. 各 IPQoS 取值成功率（每个测 4 次）==="
for q in none 0x00 throughput lowdelay; do
  ok=0
  for i in 1 2 3 4; do
    out=$(timeout 18 ssh $B -o IPQoS=$q $H 'echo OK' 2>&1 | tail -1)
    echo "$out" | grep -q OK && ok=$((ok+1))
  done
  echo "  IPQoS=$q → $ok/4 成功"
done

echo
echo "=== 2. 用 IPQoS=none 重写隧道并重启 ==="
cat > /opt/napcat-admin-tunnel.sh <<'EOS'
#!/bin/bash
while true; do
  ssh -i /root/.ssh/id_napcat -p 20043 \
      -o StrictHostKeyChecking=no -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes -o ConnectTimeout=10 -o IPQoS=none -o TCPKeepAlive=yes -N \
      -L 13004:127.0.0.1:3002 root@43.248.3.161
  echo "[$(date '+%F %T')] 断开，8 秒后重连" >> /tmp/napcat-admin-tunnel.log
  sleep 8
done
EOS
chmod +x /opt/napcat-admin-tunnel.sh
pm2 restart napcat-admin-tunnel >/dev/null 2>&1 || true

echo
echo "=== 3. 等待并检查 ==="
for i in $(seq 1 6); do
  sleep 8
  if ss -lnt 2>/dev/null | grep -q ':13004 '; then echo "  ✓ 已建立（第 $i 次检查）"; break; fi
done
echo -n "  13004 监听: "; ss -lnt 2>/dev/null | grep -c ':13004 ' || true
echo "  --- 隧道错误日志 ---"
tail -3 /root/.pm2/logs/napcat-admin-tunnel-error.log 2>/dev/null | cut -c1-120
