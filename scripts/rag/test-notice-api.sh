#!/bin/bash
P=/plugin/napcat-plugin-xuanjian-broadcast/api
B=http://127.0.0.1:3910

echo -n "  /health      : "
curl -s --max-time 10 "$B$P/health" | head -c 180
echo
echo -n "  /accounts    : "
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 "$B$P/accounts"
echo -n "  /status      : "
curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 "$B$P/status"
echo -n "  /accounts 响应体: "
curl -s --max-time 10 "$B$P/accounts" | head -c 200
echo
echo -n "  公网首页     : "
curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 https://notice.xuanjian.top/
echo -n "  公网切换器   : "
curl -s --max-time 12 https://notice.xuanjian.top/ | grep -c 'account-switcher'
