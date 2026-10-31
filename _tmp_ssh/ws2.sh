#!/bin/bash
echo "=== 最近日志 ==="
pm2 logs napcat-admin --lines 30 --nostream 2>/dev/null | tail -16 | cut -c1-160
echo
echo "=== 端口 ==="
ss -lntp 2>/dev/null | grep -E ':(3002|6100)' | head -3 || echo "  无"
echo
echo "=== 配置是否被 NapCat 重写（校验 websocketServers）==="
python3 -c "
import json
p='/opt/napcat-admin/qq/napcat/config/onebot11_1365146774.json'
d=json.load(open(p))
print(json.dumps(d.get('network',{}).get('websocketServers',[]), ensure_ascii=False)[:400])
" 2>/dev/null || echo "  解析失败"