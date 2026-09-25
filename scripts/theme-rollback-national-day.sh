#!/bin/bash
# 从国庆主题回滚到普通主题
# 用法：bash /var/www/xuanjian-guild/themes/rollback-national-day.sh
set -e
FRONT=/var/www/xuanjian-guild/frontend
THEME=/var/www/xuanjian-guild/themes/national-day
LOG=/var/www/xuanjian-guild/themes/swap.log

echo "[$(date '+%F %T')] ROLLBACK start" >> "$LOG"

if [ ! -f "$FRONT/dist/.national-day" ]; then
  echo "[$(date '+%F %T')] not national-day, skip" >> "$LOG"
  echo "当前不是国庆主题，无需回滚"
  exit 0
fi

# 主题产物一直在 themes/ 下，这里只需移除当前这份副本
rm -rf "$FRONT/dist"
if [ -d "$FRONT/dist-normal" ]; then
  mv "$FRONT/dist-normal" "$FRONT/dist"
  echo "[$(date '+%F %T')] rolled back to normal（恢复最近一次普通前端留档）" >> "$LOG"
  echo "已回滚到普通主题"
else
  echo "[$(date '+%F %T')] WARN: dist-normal missing，需要重新构建前端" >> "$LOG"
  echo "警告：$FRONT/dist-normal 不存在，请重新构建并部署前端"
  exit 1
fi
