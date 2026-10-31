#!/bin/bash
D=/opt/napcat-admin/qq/napcat/config
echo "=== 1. 配置目录按时间排序 ==="
ls -lat "$D" | head -10
echo
echo "=== 2. 从日志找登录账号 UIN ==="
pm2 logs napcat-admin --lines 300 --nostream 2>/dev/null | grep -aoE '(登录|账号|uin|UIN)[^0-9]{0,6}[0-9]{5,12}' | tail -5
pm2 logs napcat-admin --lines 300 --nostream 2>/dev/null | grep -aoE 'Morzane[^ ]*' | head -2
echo
echo "=== 3. 各 onebot11 文件修改时间 ==="
stat -c '%y  %n' "$D"/onebot11_*.json 2>/dev/null
echo
echo "=== 4. napcat_*.json 里的 uin 字段 ==="
for f in "$D"/napcat_*.json; do echo "--- $(basename "$f")"; grep -oE '"(uin|qq|account)"[^,]{0,30}' "$f" | head -2; done 2>/dev/null | head -20