#!/bin/bash
# 1) 清理测试造成的数据波动  2) 两个存量任务绑定玄剑人力
set -u
cd /var/www/xuanjian-guild || exit 1

echo "=== 清理前 ==="
sqlite3 data/guild.db "SELECT id,name,current_price FROM stocks ORDER BY id;"
sqlite3 data/guild.db "SELECT id,task_id,price_before,price_after,delta FROM stock_settlements ORDER BY id;"

echo
echo "=== 1. 删除测试任务及其领取/结算/价格点 ==="
sqlite3 data/guild.db <<'SQL'
DELETE FROM stock_settlements WHERE task_id IN (SELECT id FROM tasks WHERE title = '测试-权重股任务');
DELETE FROM task_claims WHERE task_id IN (SELECT id FROM tasks WHERE title = '测试-权重股任务');
DELETE FROM tasks WHERE title = '测试-权重股任务';
DELETE FROM stock_prices WHERE volume = 0 AND stock_id = 15;
DELETE FROM stock_holdings WHERE shares <= 0;
SQL

echo "=== 2. 恢复三板块股价为基准价 5 ==="
sqlite3 data/guild.db "UPDATE stocks SET current_price = 5, updated_at = CURRENT_TIMESTAMP WHERE symbol IN ('XJ-HEAVY','XJ-BUILD','XJ-LABOR');"

echo "=== 3. 返还测试期间消耗/获得的贡献点给用户 2（净 +1.7：奖励+2，手续费+印花税共-0.3）==="
sqlite3 data/guild.db "UPDATE users SET contribution = COALESCE(contribution,0) - 1.7 WHERE id = 2;"
sqlite3 data/guild.db "DELETE FROM contribution_logs WHERE user_id = 2 AND note LIKE '%测试%' OR user_id = 2 AND note LIKE '%玄剑重工%';"

echo "=== 4. 今日快照同步为 5（避免昨日收盘虚高）==="
sqlite3 data/guild.db "UPDATE stock_daily_snapshots SET close_price = 5 WHERE day = date('now');"

echo "=== 5. 两个存量任务绑定玄剑人力(id=17) ==="
sqlite3 data/guild.db "UPDATE tasks SET stock_id = (SELECT id FROM stocks WHERE symbol='XJ-LABOR') WHERE id IN (32,33);"

echo
echo "=== 清理后 ==="
sqlite3 data/guild.db "SELECT id,name,current_price FROM stocks ORDER BY id;"
echo "--- 任务绑定 ---"
sqlite3 data/guild.db "SELECT id,title,is_active,stock_id FROM tasks ORDER BY id DESC LIMIT 5;"
echo "--- 结算/持仓/测试任务残留 ---"
sqlite3 data/guild.db "SELECT 'settlements',COUNT(*) FROM stock_settlements UNION ALL SELECT 'holdings',COUNT(*) FROM stock_holdings UNION ALL SELECT 'test_tasks',COUNT(*) FROM tasks WHERE title='测试-权重股任务' UNION ALL SELECT 'snapshots',COUNT(*) FROM stock_daily_snapshots;"
echo "--- 用户 2 贡献点 ---"
sqlite3 data/guild.db "SELECT id,nickname,contribution FROM users WHERE id=2;"
