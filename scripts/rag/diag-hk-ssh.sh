#!/bin/bash
set -u
echo "=== 1. HK 上的密钥文件 ==="
ls -la /root/.ssh/ | head -10
echo -n "  id_napcat 内容首行: "; head -c 60 /root/.ssh/id_napcat 2>/dev/null; echo

echo
echo "=== 2. ssh -vvv 详细日志（只看关键行）==="
timeout 25 ssh -vvv -i /root/.ssh/id_napcat -p 20043 \
  -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes -o PreferredAuthentications=publickey \
  root@43.248.3.161 'echo SSH_OK' 2>&1 | grep -E 'Connecting|Offering|Authentications that can continue|Server accepts key|Permission denied|Connection closed|Host key|KEX|debug1: Next authentication' | head -14

echo
echo "=== 3. HK 到机器人服务器 TCP 连通性 ==="
timeout 8 bash -c 'cat < /dev/null > /dev/tcp/43.248.3.161/20043' && echo "  TCP 20043 可连" || echo "  TCP 20043 不可连"

echo
echo "=== 4. 现有隧道进程与连接 ==="
pm2 list 2>/dev/null | grep -E 'tunnel' | head -6
ss -tnp 2>/dev/null | grep ':20043' | head -5
