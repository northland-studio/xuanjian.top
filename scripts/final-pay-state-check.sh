#!/bin/bash
echo "=== HK 官网 ==="
curl -s -o /dev/null -w "首页 %{http_code} | " https://xuanjian.top/
curl -s -o /dev/null -w "/pay %{http_code} | " https://xuanjian.top/pay
curl -s -o /dev/null -w "qr.png %{http_code} | " "https://xuanjian.top/api/pay/qr.png?text=https%3A%2F%2Fxuanjian.top%2Fpay%2Fabcdefghijklmnop"
curl -s -o /dev/null -w "records(未登录) %{http_code}\n" https://xuanjian.top/api/pay/records
cd /var/www/xuanjian-guild
sqlite3 data/guild.db "SELECT 'pay 表: ' || COUNT(*) FROM sqlite_master WHERE type='table' AND name LIKE 'pay_%';"
sqlite3 data/guild.db "SELECT '流水/意图/名单: ' || (SELECT COUNT(*) FROM pay_transactions) || '/' || (SELECT COUNT(*) FROM pay_intents) || '/' || (SELECT COUNT(*) FROM pay_charges);"
sqlite3 data/guild.db "SELECT '金库: ' || nickname || ' = ' || contribution FROM users WHERE username='guild_treasury';"
sqlite3 data/guild.db "SELECT '测试账号残留: ' || COUNT(*) FROM users WHERE username LIKE 'paytest%';"
sqlite3 data/guild.db "SELECT 'user2 余额: ' || contribution FROM users WHERE id=2;"
pm2 list | grep xuanjian-guild | sed 's/│/|/g' | awk -F'|' '{print "  pm2:", $4, $10}'
