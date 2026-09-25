#!/bin/bash
# 生产：验证机器人视角的 charge-poster 与 mc status（用真实 token，跑完清理临时缴费单）
cd /var/www/xuanjian-guild
B=http://127.0.0.1:3000
TOKEN=$(python3 - <<'PY'
import re
for l in open('/var/www/xuanjian-guild/.env', encoding='utf-8'):
    m = re.match(r'\s*QQBOT_TOKEN\s*=\s*(\S+)', l)
    if m: print(m.group(1)); break
PY
)
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

echo "=== 建临时缴费单并查 charge-poster ==="
CT=$(curl -s -X POST $B/api/pay/charge -H 'Content-Type: application/json' -H "Authorization: Bearer $TOK" \
  -d '{"title":"机器人海报接口自检","amount":3,"targets":[{"userId":2}]}' | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])")
curl -s -H "X-Bot-Token: $TOKEN" "$B/api/qqbot/pay/charge-poster?token=$CT" | python3 -m json.tool
echo "=== 海报图 URL 是否真能取到 PNG ==="
URL=$(curl -s -H "X-Bot-Token: $TOKEN" "$B/api/qqbot/pay/charge-poster?token=$CT" | python3 -c "import json,sys;print(json.load(sys.stdin)['url'])")
LOCAL=${URL/https:\/\/xuanjian.top/$B}
curl -s -o /tmp/poster-check.png -w "  %{http_code} %{content_type} %{size_download}B\n" "$LOCAL"
echo "=== 机器人「服务器」指令依赖的接口 ==="
curl -s "$B/api/mc/status?server=s115" | python3 -c "import json,sys; d=json.load(sys.stdin); print('  online=%s version=%s players=%s/%s latency=%sms' % (d.get('online'), d.get('version'), d.get('players',{}).get('online'), d.get('players',{}).get('max'), d.get('latencyMs')))"

echo "=== 清理 ==="
ID=$(sqlite3 data/guild.db "SELECT id FROM pay_intents WHERE token='$CT'")
sqlite3 data/guild.db "DELETE FROM pay_charges WHERE intent_id=$ID; DELETE FROM pay_intents WHERE id=$ID;"
sqlite3 data/guild.db "DELETE FROM pay_payees WHERE type='event' AND id NOT IN (SELECT DISTINCT payee_id FROM pay_intents);"
sqlite3 data/guild.db "SELECT '意图=' || COUNT(*) FROM pay_intents;"
