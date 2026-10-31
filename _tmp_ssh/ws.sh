#!/bin/bash
D=/opt/napcat-admin/qq/napcat/config
F=$D/onebot11_1365146774.json
TOKEN=$(openssl rand -hex 10)
cp "$F" "$F.bak-$(date +%Y%m%d-%H%M%S)"
cat > "$F" <<JSON
{
  "network": {
    "httpServers": [],
    "httpSseServers": [],
    "httpClients": [],
    "websocketServers": [
      {
        "enable": true,
        "name": "xuanjian-admin",
        "host": "127.0.0.1",
        "port": 3002,
        "reportSelfMessage": false,
        "enableForcePushEvent": true,
        "messagePostFormat": "array",
        "token": "$TOKEN",
        "debug": false,
        "heartInterval": 30000
      }
    ],
    "websocketClients": [],
    "plugins": []
  },
  "musicSignUrl": "",
  "enableLocalFile2Url": false,
  "parseMultMsg": false,
  "imageDownloadProxy": "",
  "timeout": { "baseTimeout": 10000, "uploadSpeedKBps": 256, "downloadSpeedKBps": 256, "maxTimeout": 1800000 }
}
JSON
echo "  已写入配置，token=$TOKEN"
echo "$TOKEN" > /opt/napcat-admin/onebot-token.txt
chmod 600 /opt/napcat-admin/onebot-token.txt

echo "=== 重启实例生效 ==="
pm2 restart napcat-admin >/dev/null 2>&1
sleep 20
echo -n "  3002 监听: "; ss -lnt 2>/dev/null | grep -c ':3002 ' || true
echo -n "  get_login_info: "
curl -s --max-time 8 -X POST "http://127.0.0.1:3002/get_login_info" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{}' | head -c 250
echo
echo -n "  进程: "; pm2 list 2>/dev/null | grep -c 'napcat-admin'