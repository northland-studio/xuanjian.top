#!/bin/bash
cd /opt/xuanjian-notice || exit 1
echo "=== checkQuota 尾部 ==="
sed -n '145,178p' src/guards.mjs
echo "=== initGuards ==="
sed -n '22,42p' src/guards.mjs
echo "=== /guards 路由 ==="
grep -n -A12 "guards" src/routes.mjs | sed -n '1,30p'
