#!/bin/bash
# 「网站教程」分类 wiki 上线（20261011）
#
# 写入 20 篇教程：集市交易流程、集市店铺说明、售后、贡献点、扫码支付、商城与库存、互转与申报、
# 任务、签到、捐赠、GMIRS、GDARS、排行榜、队伍公示、聊天与社交、Wiki 投稿、模组与投影、账号安全、经济看板、总览
#
# 前置：$STAGE/wiki-site-guide.js（本脚本用它写入，署名默认 1 号公会官方账号）
# 步骤：备份数据库 → 写入（幂等，已存在的按 slug 更新）→ 重建 SSG → 重启 → 核对
set -e
APP=/var/www/xuanjian-guild
STAGE=/root/deploy-wiki-site-guide-20261011
TAG=20261011-wiki-site-guide

cd "$APP"

echo "[1/5] 备份数据库..."
sqlite3 data/guild.db "PRAGMA wal_checkpoint(TRUNCATE);" || true
cp data/guild.db "data/guild.db.bak-$TAG"
ls -la "data/guild.db.bak-$TAG"

echo "[2/5] 写入「网站教程」页面..."
cp "$STAGE/wiki-site-guide.js" scripts/wiki-site-guide.js
node --check scripts/wiki-site-guide.js
node scripts/wiki-site-guide.js

echo "[3/5] 重建 SSG 静态页（含新增的 wiki 词条）..."
rm -rf frontend/prerender
node scripts/prerender.js --clean >/tmp/wiki-guide-prerender.log 2>&1 || { echo "    (!) prerender 失败"; tail -5 /tmp/wiki-guide-prerender.log; }
tail -2 /tmp/wiki-guide-prerender.log
echo -n "    wiki 词条静态产物: "; ls frontend/prerender | grep -c '^wiki__' || true

echo "[4/5] 重启..."
pm2 restart xuanjian-guild --update-env
sleep 6

echo "[5/5] 核对..."
sqlite3 data/guild.db "SELECT '分类页数: ' || COUNT(*) FROM wiki_pages p JOIN wiki_categories c ON c.id = p.category_id WHERE c.slug = 'wang-zhan-jiao-cheng' AND p.status = 'published';"
sqlite3 data/guild.db "SELECT '  · ' || p.id || ' /wiki/' || p.slug || '  ' || p.title FROM wiki_pages p JOIN wiki_categories c ON c.id = p.category_id WHERE c.slug = 'wang-zhan-jiao-cheng' ORDER BY p.id;"
sqlite3 data/guild.db "SELECT '内链未创建数（应为 0）: ' || COUNT(*) FROM wiki_pages p JOIN wiki_categories c ON c.id = p.category_id WHERE c.slug = 'wang-zhan-jiao-cheng' AND p.content LIKE '%wiki-link-missing%';"
echo "--- HTTP ---"
for u in "/wiki" "/wiki/category/wang-zhan-jiao-cheng" "/wiki/ji-shi-jiao-yi-liu-cheng" "/wiki/ji-shi-dian-pu-shuo-ming" "/wiki/wang-zhan-gong-neng-zong-lan"; do
  echo "  $u -> $(curl -s -o /dev/null -w '%{http_code}' "https://xuanjian.top$u")"
done
echo -n "  交易流程页含「托管」字样: "; curl -s https://xuanjian.top/wiki/ji-shi-jiao-yi-liu-cheng | grep -c "托管" || true
echo -n "  店铺说明页含「续期费」字样: "; curl -s https://xuanjian.top/wiki/ji-shi-dian-pu-shuo-ming | grep -c "续期费" || true
echo "上线完成 ✓"
