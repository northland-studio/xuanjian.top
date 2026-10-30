#!/bin/bash
# beiyu 项目报错诊断
set -u
APP=/var/www/beiyu-website

echo "=== 1. 进程状态 ==="
pm2 list 2>/dev/null | grep -E 'beiyu|name' | head -3
pm2 describe beiyu 2>/dev/null | grep -E 'status|restarts|uptime|script path|exec cwd|error log' | head -8

echo
echo "=== 2. 错误按类型归类（最近 500 行）==="
pm2 logs beiyu --err --lines 500 --nostream 2>/dev/null | grep -a '⨯\|Error:\|error' \
  | sed -E 's/^4\|beiyu +\| +//' \
  | sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}[^ ]*//g' \
  | cut -c1-110 | sort | uniq -c | sort -rn | head -12

echo
echo "=== 3. 图片错误：具体哪些文件 ==="
pm2 logs beiyu --err --lines 500 --nostream 2>/dev/null | grep -aoE "for /[^ ]+\.(png|jpg|jpeg|webp|svg)" | sort | uniq -c | head -10

echo
echo "=== 4. 图片文件实际是否存在（public 目录）==="
for f in $(pm2 logs beiyu --err --lines 500 --nostream 2>/dev/null | grep -aoE "for /[^ ]+\.(png|jpg|jpeg|webp|svg)" | sed 's|for /||' | sort -u | head -8); do
  # 尝试 URL 解码
  decoded=$(printf '%b' "$(echo "$f" | sed 's/%/\\x/g')" 2>/dev/null)
  if [ -f "$APP/public/$decoded" ]; then
    echo "  ✓ 存在: $decoded ($(stat -c%s "$APP/public/$decoded" 2>/dev/null) 字节)"
  elif [ -f "$APP/public/$f" ]; then
    echo "  ✓ 存在(原名): $f"
  else
    echo "  ✗ 缺失: $decoded"
  fi
done
echo "  --- public 下含「北域抠图」的文件 ---"
ls -la "$APP/public/" 2>/dev/null | grep -a '抠图' | head -5 || echo "  无匹配"

echo
echo "=== 5. 邮件错误：SMTP 配置与连通性 ==="
if [ -f "$APP/.env" ]; then
  grep -aE '^(SMTP|MAIL|EMAIL)' "$APP/.env" 2>/dev/null | sed -E 's/(PASS|PASSWORD|SECRET)=.*/\1=****/' | head -8
fi
[ -f "$APP/.env.local" ] && grep -aE '^(SMTP|MAIL|EMAIL)' "$APP/.env.local" 2>/dev/null | sed -E 's/(PASS|PASSWORD)=.*/\1=****/' | head -8

echo
echo "=== 6. 邮件错误出现频次（按小时）==="
pm2 logs beiyu --err --lines 2000 --nostream 2>/dev/null | grep -ac 'authentication failed' | sed 's/^/  535 认证失败次数（最近 2000 行）: /'

echo
echo "=== 7. 最近 20 行原始错误（保留时间戳）==="
pm2 logs beiyu --err --lines 20 --nostream 2>/dev/null | tail -20 | sed -E 's/^4\|beiyu +\| +//' | cut -c1-140
