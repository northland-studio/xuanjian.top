#!/bin/bash
# 从国庆主题回滚到普通主题（客户端产物 + SSR 产物一起回，并按普通主题重建 SSG 静态页）
#
# 三件事必须一起做，否则会混搭：
#   ① frontend/dist      → 换成普通版（否则还是红金配色）
#   ② frontend/dist-ssr  → 换成普通版（否则 SSR/SSG HTML 里还烤着国庆横幅）
#   ③ frontend/prerender → 清空重建（SSG 静态页里写死了生成时的 CSS 文件名）
#
# 用法：bash /var/www/xuanjian-guild/themes/rollback-national-day.sh
# 自动回滚：systemd xuanjian-theme-rollback.timer（2026-10-07 16:00 UTC = 10-08 00:00 CST）
set -e
SITE=/var/www/xuanjian-guild
FRONT=$SITE/frontend
LOG=$SITE/themes/swap.log

say() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

if [ ! -f "$FRONT/dist/.national-day" ]; then
  say "当前不是国庆主题，无需回滚"
  exit 0
fi

say "[1/4] 客户端产物回滚（恢复最近一次普通版留档 dist-normal）"
if [ ! -d "$FRONT/dist-normal" ]; then
  say "错误：$FRONT/dist-normal 不存在，请先重新构建并部署普通主题前端再回滚"
  exit 1
fi
rm -rf "$FRONT/dist"
mv "$FRONT/dist-normal" "$FRONT/dist"

say "[2/4] SSR 产物回滚（恢复 dist-ssr-normal）"
if [ -d "$FRONT/dist-ssr-normal" ]; then
  rm -rf "$FRONT/dist-ssr"
  mv "$FRONT/dist-ssr-normal" "$FRONT/dist-ssr"
else
  say "      警告：$FRONT/dist-ssr-normal 不存在，SSR/SSG 仍会渲染国庆横幅（下次普通主题部署会自动修正）"
fi

say "[3/4] 按普通主题重建 SSG 静态页"
rm -rf "$FRONT/prerender"
if (cd "$SITE" && node scripts/prerender.js >/tmp/theme-prerender.log 2>&1); then
  say "      SSG 已重建：$(ls "$FRONT/prerender" 2>/dev/null | wc -l) 个"
else
  say "      警告：SSG 重建失败（见 /tmp/theme-prerender.log），缺的页面会由中间件按需生成"
fi

say "[4/4] 重启服务"
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1

say "已回滚到普通主题 ✓"
