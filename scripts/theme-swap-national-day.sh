#!/bin/bash
# 切换到国庆主题（安全版：主题产物始终留在 themes/national-day/dist，绝不搬走，避免被前端部署覆盖）
# 用法：bash /var/www/xuanjian-guild/themes/swap-national-day.sh
set -e
FRONT=/var/www/xuanjian-guild/frontend
THEME=/var/www/xuanjian-guild/themes/national-day
LOG=/var/www/xuanjian-guild/themes/swap.log

echo "[$(date '+%F %T')] SWAP start" >> "$LOG"

if [ -f "$FRONT/dist/.national-day" ]; then
  echo "[$(date '+%F %T')] already national-day, skip" >> "$LOG"
  echo "已经是国庆主题，无需重复切换"
  exit 0
fi
if [ ! -d "$THEME/dist" ]; then
  echo "[$(date '+%F %T')] ERROR: theme dir missing" >> "$LOG"
  echo "错误：$THEME/dist 不存在（主题产物丢失，需先重新构建）"
  exit 1
fi
[ -f "$THEME/dist/.national-day" ] || touch "$THEME/dist/.national-day"

# 当前普通产物先留档（每次切换都刷新留档，便于回滚到最近一次普通前端）
rm -rf "$FRONT/dist-normal"
mv "$FRONT/dist" "$FRONT/dist-normal"

# 从主题仓库「复制」出主题产物：主题产物原地不动，前端部署只影响 frontend/dist
cp -a "$THEME/dist" "$FRONT/dist"
touch "$FRONT/dist/.national-day"

echo "[$(date '+%F %T')] switched to national-day（dist-normal 已留档）" >> "$LOG"
echo "已切换到国庆主题；回滚：bash /var/www/xuanjian-guild/themes/rollback-national-day.sh"
