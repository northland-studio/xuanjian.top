#!/bin/bash
# notice.xuanjian.top 现状盘点
set -u
APP=/opt/xuanjian-notice
cd "$APP" || exit 1

echo "=== 1. .env 配置项（值打码）==="
grep -E '^[A-Z_]+=' .env 2>/dev/null | sed -E 's/=(.{4}).*/=\1****/' | head -40

echo
echo "=== 2. 目录结构 ==="
ls -1 src webui tools 2>/dev/null
echo "  --- 文件大小 ---"
ls -la standalone.mjs package.json 2>/dev/null | awk '{print "  "$5" "$9}'

echo
echo "=== 3. HTTP 路由 ==="
grep -oE "'(/[a-zA-Z0-9_/-]*)'" standalone.mjs 2>/dev/null | sort -u | head -25

echo
echo "=== 4. 功能关键词 ==="
for kw in 群发 私聊 broadcast 通知 模板 审计 audit 配额 熔断 回执 定时 schedule; do
  n=$(grep -c "$kw" standalone.mjs 2>/dev/null || echo 0)
  [ "$n" != "0" ] && echo "  $kw : $n 处"
done

echo
echo "=== 5. 数据目录 ==="
ls -la data 2>/dev/null | head -10
du -sh data 2>/dev/null

echo
echo "=== 6. 最近日志 ==="
pm2 logs xuanjian-notice --lines 15 --nostream 2>/dev/null | tail -15 | cut -c1-140
