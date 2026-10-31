#!/bin/bash
cd /var/www/xuanjian-guild || exit 1
sqlite3 data/guild.db "UPDATE tasks SET is_active=0 WHERE title='测试-权重股任务';"
echo "--- 最近任务 ---"
sqlite3 data/guild.db "SELECT id, title, is_active, stock_id FROM tasks ORDER BY id DESC LIMIT 3;"
echo "--- 结算流水 ---"
sqlite3 data/guild.db "SELECT stock_id, task_id, reward, finish_count, price_before, price_after, delta FROM stock_settlements ORDER BY id DESC LIMIT 3;"
echo "--- 收盘快照 ---"
sqlite3 data/guild.db "SELECT stock_id, day, close_price FROM stock_daily_snapshots ORDER BY id DESC LIMIT 3;"
echo "--- 持仓 ---"
sqlite3 data/guild.db "SELECT user_id, stock_id, shares FROM stock_holdings;"
