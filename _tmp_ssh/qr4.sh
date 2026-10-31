#!/bin/bash
pm2 restart napcat-admin >/dev/null 2>&1
sleep 12
date "+服务器时间: %H:%M:%S"
base64 -w0 /opt/napcat-admin/qq/napcat/cache/qrcode.png 2>/dev/null