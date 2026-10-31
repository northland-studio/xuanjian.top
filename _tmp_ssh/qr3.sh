#!/bin/bash
date "+服务器时间: %H:%M:%S"
ls -la /opt/napcat-admin/qq/napcat/cache/qrcode.png
base64 -w0 /opt/napcat-admin/qq/napcat/cache/qrcode.png