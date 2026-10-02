#!/bin/bash
# 切换到国庆主题（客户端产物 + SSR 产物一起换，并按新主题重建 SSG 静态页）
#
# 为什么必须一起换：三层渲染下，SSG/SSR 的 HTML 是服务端渲染 + 构建时写死 CSS 文件名的——
#   ① SSG 静态页里引用的 CSS hash 属于生成时的主题，只换 frontend/dist 会导致 SSG 页面丢样式；
#   ② 国庆横幅是 Layout.jsx 渲染进 SSR/SSG HTML 的，只换客户端产物会出现「新 CSS + 旧横幅」混搭。
#
# 用法：bash /var/www/xuanjian-guild/themes/swap-national-day.sh
# 依赖目录（常驻，不被前端部署覆盖）：
#   themes/national-day/dist      主题客户端产物
#   themes/national-day/dist-ssr  主题 SSR 产物
set -e
SITE=/var/www/xuanjian-guild
FRONT=$SITE/frontend
THEME=$SITE/themes/national-day
LOG=$SITE/themes/swap.log

say() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

if [ -f "$FRONT/dist/.national-day" ]; then
  say "已经是国庆主题，无需重复切换"
  exit 0
fi
[ -d "$THEME/dist" ] || { say "错误：主题客户端产物缺失 $THEME/dist（需先在该分支构建并同步）"; exit 1; }
[ -d "$THEME/dist-ssr" ] || { say "错误：主题 SSR 产物缺失 $THEME/dist-ssr"; exit 1; }

say "[1/4] 切换客户端产物（普通版留档 dist-normal）"
rm -rf "$FRONT/dist-normal"
mv "$FRONT/dist" "$FRONT/dist-normal"
cp -a "$THEME/dist" "$FRONT/dist"
touch "$FRONT/dist/.national-day"

say "[2/4] 切换 SSR 产物（普通版留档 dist-ssr-normal）"
if [ -d "$FRONT/dist-ssr" ]; then
  rm -rf "$FRONT/dist-ssr-normal"
  mv "$FRONT/dist-ssr" "$FRONT/dist-ssr-normal"
fi
cp -a "$THEME/dist-ssr" "$FRONT/dist-ssr"

say "[3/4] 按国庆主题重建 SSG 静态页"
rm -rf "$FRONT/prerender"
if (cd "$SITE" && node scripts/prerender.js >/tmp/theme-prerender.log 2>&1); then
  say "      SSG 已重建：$(ls "$FRONT/prerender" 2>/dev/null | wc -l) 个"
else
  say "      警告：SSG 重建失败（见 /tmp/theme-prerender.log），缺的页面会由中间件按需生成"
fi

say "[4/4] 重启服务（清掉内存里的模板与 SSR 渲染器缓存）"
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1

say "已切换到国庆主题 ✓（回滚：bash $SITE/themes/rollback-national-day.sh）"
