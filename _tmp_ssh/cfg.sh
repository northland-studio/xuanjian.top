#!/bin/bash
echo "=== 1. 找 NapCat 配置目录 ==="
find /opt/napcat-admin -maxdepth 6 -type d -name 'NapCat' 2>/dev/null | head -5
find /opt/napcat-admin -maxdepth 7 -name 'onebot11*.json' 2>/dev/null | head -5
find /opt/napcat-admin -maxdepth 7 -name 'napcat*.json' 2>/dev/null | head -5
echo
echo "=== 2. 参考：现有玄剑姬实例的配置位置 ==="
find /root/.config/QQ -maxdepth 6 -name 'onebot11*.json' 2>/dev/null | head -5
find / -maxdepth 6 -name 'onebot11_*.json' 2>/dev/null | head -5
echo
echo "=== 3. admin 实例 HOME 下结构 ==="
ls -la /opt/napcat-admin/.config/QQ/ 2>/dev/null | head -12
echo
echo "=== 4. 6100 WebUI 是否可用 ==="
curl -s -o /dev/null -w '  6100: %{http_code}\n' --max-time 8 http://127.0.0.1:6100/