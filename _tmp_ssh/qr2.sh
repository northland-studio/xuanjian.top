#!/bin/bash
ls -la /opt/napcat-admin/qq/napcat/cache/qrcode.png
date "+现在: %H:%M:%S"
base64 -w0 /opt/napcat-admin/qq/napcat/cache/qrcode.png