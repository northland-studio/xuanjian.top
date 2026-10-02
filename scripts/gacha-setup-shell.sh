#!/bin/bash
# 修正：隧道补 -i 私钥；补装 aiohttp；重跑空壳连通性验证
set -e
DIR=/opt/xuanjian-gacha
cd "$DIR"

echo "=== 补装 aiohttp ==="
.venv/bin/pip install -q aiohttp 2>&1 | tail -2
.venv/bin/pip list 2>/dev/null | grep -iE '^aiohttp' | head -2

echo "=== 重建隧道（带 -i /root/.ssh/id_napcat）==="
pm2 delete napcat-gacha-tunnel >/dev/null 2>&1 || true
cat > /opt/napcat-gacha-tunnel.sh <<'SH'
#!/bin/bash
while true; do
  ssh -N -i /root/.ssh/id_napcat -o StrictHostKeyChecking=no \
      -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
      -L 127.0.0.1:13001:127.0.0.1:3001 -p 20043 root@43.248.3.161
  echo "[tunnel] 断开，5 秒后重连"
  sleep 5
done
SH
chmod +x /opt/napcat-gacha-tunnel.sh
pm2 start /opt/napcat-gacha-tunnel.sh --name napcat-gacha-tunnel >/dev/null 2>&1
pm2 save >/dev/null 2>&1 || true
sleep 5
if ss -ltn 2>/dev/null | grep -q 13001; then
  echo "  ✓ 13001 已监听（NapCat OneBot ws 隧道就绪）"
else
  echo "  (!) 13001 未监听，隧道日志："
  pm2 logs napcat-gacha-tunnel --lines 8 --nostream 2>/dev/null | tail -6
fi

echo "=== 空壳跑 25 秒（连 ws + 记录事件）==="
timeout 25 .venv/bin/python bot.py 2>&1 | tail -25 || true
echo "=== 完成 ==="
