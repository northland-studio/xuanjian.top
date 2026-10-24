#!/bin/bash
# 机器人服务器：快速定位项目与服务管理方式
echo "=== host/node ==="
hostname; node -v 2>/dev/null || echo "no node"
echo "=== /root 一级 ==="
ls -1 /root 2>/dev/null | head -25
echo "=== /opt 一级 ==="
ls -1 /opt 2>/dev/null | head -15
echo "=== package.json（深度 2，排除 node_modules）==="
find /root /opt -maxdepth 2 -name package.json -not -path '*/node_modules/*' 2>/dev/null | head -10
echo "=== systemd 服务 ==="
systemctl list-units --type=service --state=running 2>/dev/null | grep -iE 'bot|xuanjian|napcat' | head -8
echo "=== pm2 ==="
command -v pm2 >/dev/null && pm2 ls 2>/dev/null | head -10 || echo "no pm2"
echo "=== 3001 监听 ==="
ss -lntp 2>/dev/null | grep ':3001' | head -3 || echo "3001 未监听"
echo "=== node 进程 ==="
ps -eo pid,etime,cmd 2>/dev/null | grep -E 'node|tsx' | grep -v grep | head -6 | cut -c1-150
