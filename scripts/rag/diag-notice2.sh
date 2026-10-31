#!/bin/bash
set -u
APP=/opt/xuanjian-notice
cd "$APP"

echo "=== 1. HTTP 路由（routes.mjs）==="
grep -oE "['\"]/[a-zA-Z0-9_/:-]+['\"]" src/routes.mjs 2>/dev/null | tr -d "'\"" | sort -u | head -40

echo
echo "=== 2. 其余模块职责 ==="
for f in src/*.mjs; do
  echo "  --- $(basename "$f") ($(wc -l < "$f") 行) ---"
  head -4 "$f" | grep -E '^\s*\*|^//' | head -3 | sed 's/^/    /'
done 2>/dev/null | head -60

echo
echo "=== 3. 审计与数据 ==="
ls -la data 2>/dev/null | head -8
echo -n "  体积: "; du -sh data 2>/dev/null | cut -f1
find data -name 'audit-*.jsonl' 2>/dev/null | wc -l | sed 's/^/  审计文件数: /'
find data -name 'audit-*.jsonl' 2>/dev/null | sort | tail -3 | sed 's/^/    /'

echo
echo "=== 4. 最近日志 ==="
pm2 logs xuanjian-notice --lines 12 --nostream 2>/dev/null | tail -12 | cut -c1-130
