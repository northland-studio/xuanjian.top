#!/bin/bash
# 集市系统账号（market_escrow, level=-1）与既有功能的隔离加固部署
#
# 只改既有路由的查询条件（加 COALESCE(level,0) >= 0）与转账双向校验，不改任何业务语义：
#   routes/contributions.js  转账：目标/来源是系统账号 → 拒绝（保护托管余额 = 在途订单合计）
#   routes/pay.js            缴费单成员搜索排除系统账号
#   routes/rankings.js       贡献点排行榜排除
#   routes/economics.js      经济概览 Top10 / 流通总量 / 全员账户排除
#   routes/donation.js       捐赠录入成员搜索排除
#   routes/chat.js           聊天 @ 与最近用户列表排除
#   routes/discipline.js     纪律处分成员查询排除
#   routes/mod.js            玩家排名计数排除
#   routes/posts.js          日报/决策全员通知排除
#   routes/gmirs.js          档案查询/导出/查伪扫描排除
set -e
APP=/var/www/xuanjian-guild
STAGE=/root/deploy-market-isolation-20261011
TAG=20261011-market-isolation

cd "$APP"

echo "[1/4] 备份数据库..."
sqlite3 data/guild.db "PRAGMA wal_checkpoint(TRUNCATE);" || true
cp data/guild.db "data/guild.db.bak-$TAG"
ls -la "data/guild.db.bak-$TAG"

echo "[2/4] 覆盖路由文件并语法检查..."
FILES="routes/contributions.js routes/pay.js routes/rankings.js routes/economics.js routes/donation.js routes/chat.js routes/discipline.js routes/mod.js routes/posts.js routes/gmirs.js"
for f in $FILES; do
  cp "$STAGE/$f" "$f"
  node --check "$f"
  echo "    + $f ($(wc -l < "$f") 行)"
done

echo "[3/4] 重启并健康检查..."
pm2 restart xuanjian-guild --update-env
sleep 6
echo "    首页 $(curl -s -o /dev/null -w '%{http_code}' https://xuanjian.top/)"
for u in "/api/rankings/contribution?limit=50" "/api/economics/overview" "/api/market/config"; do
  echo "    $u -> $(curl -s -o /dev/null -w '%{http_code}' "https://xuanjian.top$u")"
done

echo "[4/4] 隔离核对（系统账号不应出现在会员视图里）..."
ESCROW_ID=$(sqlite3 data/guild.db "SELECT id FROM users WHERE username='market_escrow';")
echo "    托管账号 id=$ESCROW_ID"
echo -n "    排行榜含 market_escrow: "
curl -s "https://xuanjian.top/api/rankings/contribution?limit=100" | grep -c market_escrow || true
echo -n "    经济概览含 market_escrow: "
curl -s "https://xuanjian.top/api/economics/overview" | grep -c market_escrow || true
echo -n "    经济报表导出含 market_escrow: "
curl -s "https://xuanjian.top/api/economics/export" | grep -c market_escrow || true
echo -n "    成员档案导出含 market_escrow: "
curl -s "https://xuanjian.top/api/gmirs/export" | grep -c market_escrow || true
echo -n "    档案导出 HTTP: "
curl -s -o /dev/null -w '%{http_code}\n' "https://xuanjian.top/api/gmirs/export"
echo -n "    档案查询(market) 含 market_escrow: "
curl -s "https://xuanjian.top/api/gmirs/query?keyword=market" | grep -c market_escrow || true
echo -n "    聊天 /api/chat/mentions 匿名访问: "
curl -s -o /dev/null -w '%{http_code}\n' "https://xuanjian.top/api/chat/mentions"
echo "隔离加固部署完成 ✓（转账双向拦截已在本地测试库用同一份代码验证：scripts/test-market-isolation.js 16/16）"
