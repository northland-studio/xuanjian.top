#!/bin/bash
P=/plugin/napcat-plugin-xuanjian-broadcast/api
B=http://127.0.0.1:3910
echo -n "  公网首页: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 https://notice.xuanjian.top/
echo -n "  前端护栏开关: "; curl -s --max-time 12 https://notice.xuanjian.top/ | grep -c 'guards-switch'
echo -n "  前端旁路横幅: "; curl -s --max-time 12 https://notice.xuanjian.top/ | grep -c 'guards-banner'
echo -n "  /guards 鉴权: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 "$B$P/guards"
echo -n "  /guards/bypass 鉴权: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 -X POST "$B$P/guards/bypass" -H 'Content-Type: application/json' -d '{"on":true}'
echo -n "  当前 bypass 状态: "; cat /opt/xuanjian-notice/data/bypass.json 2>/dev/null | tr -d '\n '
echo
echo "  进程: "; pm2 list 2>/dev/null | grep xuanjian-notice | head -1
echo "  最近日志: "; pm2 logs xuanjian-notice --lines 8 --nostream 2>/dev/null | grep -aE '护栏|bypass' | tail -3
