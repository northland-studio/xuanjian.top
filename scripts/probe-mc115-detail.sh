#!/bin/bash
cd /var/www/xuanjian-guild
TOK=$(node - <<'JS'
require('dotenv').config({ quiet: true });
const jwt = require('jsonwebtoken');
const s = require('sqlite3');
const db = new s.Database('data/guild.db');
db.get("SELECT id, level FROM users WHERE level >= 1 AND username <> 'guild_treasury' ORDER BY level DESC LIMIT 1", (e, u) => {
  process.stdout.write(jwt.sign({ userId: u.id, level: u.level }, process.env.JWT_SECRET));
  db.close();
});
JS
)
echo "--- 管理员明细（RCON：list / tps / whitelist）---"
curl -s -H "Authorization: Bearer $TOK" 'http://127.0.0.1:3000/api/mc/status-detail?server=s115' | python3 -m json.tool 2>/dev/null | head -30
echo "--- 缓存命中测试（连续两次应走缓存，115 侧只被打一次）---"
for i in 1 2; do curl -s -o /dev/null -w "  第 $i 次 %{time_total}s\n" -H "Authorization: Bearer $TOK" 'http://127.0.0.1:3000/api/mc/status-detail?server=s115'; done
