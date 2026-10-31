#!/bin/bash
# 机器人服务器：探查 NapCat 运行方式与资源余量
echo "=== 1. napcat/qq 进程 ==="
ps -eo pid,etime,rss,cmd 2>/dev/null | grep -iE 'napcat|/qq|qq ' | grep -v grep | head -8 | cut -c1-140

echo
echo "=== 2. systemd 单元 ==="
systemctl list-units --type=service --state=running 2>/dev/null | grep -iE 'napcat|qq' | head -5
systemctl list-unit-files 2>/dev/null | grep -iE 'napcat|qq' | head -5

echo
echo "=== 3. pm2 ==="
command -v pm2 >/dev/null && pm2 list 2>/dev/null | head -10 || echo "  无 pm2"

echo
echo "=== 4. docker ==="
command -v docker >/dev/null && docker ps -a --format '{{.Names}}  {{.Image}}  {{.Ports}}  {{.Status}}' 2>/dev/null | head -8 || echo "  无 docker"

echo
echo "=== 5. 监听端口 3000-3010 ==="
ss -lntp 2>/dev/null | grep -E ':(300[0-9]|3010)' | head -8

echo
echo "=== 6. NapCat 安装目录线索 ==="
ls -d /root/napcat* /opt/napcat* /root/NapCat* /opt/QQ* /root/QQ* 2>/dev/null | head -8
find / -maxdepth 3 -name 'napcat*' -not -path '/proc/*' 2>/dev/null | head -8

echo
echo "=== 7. 资源 ==="
free -m | head -2
df -h / | tail -1
nproc

echo
echo "=== 8. 现有 NapCat 版本与配置 ==="
for d in /root/napcat /opt/napcat /root/NapCat; do
  [ -d "$d" ] && { echo "  --- $d ---"; ls "$d" | head -9; }
done
