#!/bin/bash
# 在 HK 上建立到 115 的 RCON 只读隧道（pm2 常驻），并把 rcon 指向隧道本地端口
set -e
cd /var/www/xuanjian-guild

echo "[1/4] 配置 .env（RCON 走隧道本地端口）"
python3 - <<'PY'
import re
p = '/var/www/xuanjian-guild/.env'
text = open(p, encoding='utf-8').read()
def setkv(text, key, val):
    if re.search(rf'^{key}=.*$', text, flags=re.M):
        return re.sub(rf'^{key}=.*$', f'{key}={val}', text, flags=re.M)
    return text.rstrip('\n') + f'\n{key}={val}\n'
text = setkv(text, 'MC_RCON_HOST_S115', '127.0.0.1')
text = setkv(text, 'MC_RCON_PORT_S115', '25585')
open(p, 'w', encoding='utf-8').write(text)
print('  已设置 MC_RCON_HOST_S115=127.0.0.1 MC_RCON_PORT_S115=25585')
PY

echo "[2/4] 建立/复用 pm2 隧道进程 mc115-rcon-tunnel"
if pm2 describe mc115-rcon-tunnel >/dev/null 2>&1; then
  pm2 restart mc115-rcon-tunnel >/dev/null 2>&1 || true
  echo "  已重启既有隧道"
else
  pm2 start ssh --name mc115-rcon-tunnel -- \
    -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
    -o StrictHostKeyChecking=no -L 127.0.0.1:25585:127.0.0.1:25575 root@115.190.153.44 >/dev/null 2>&1
  echo "  已创建隧道进程"
fi
pm2 save >/dev/null 2>&1 || true
sleep 3
ss -ltnp 2>/dev/null | grep 25585 || echo "  (!) 本地 25585 未监听"

echo "[3/4] 通过隧道自测 RCON"
node - <<'JS'
require('dotenv').config({ quiet: true });
const mc = require('/var/www/xuanjian-guild/lib/mc-status');
(async () => {
  const r = await mc.rconExec({ host: '127.0.0.1', port: 25585, password: process.env.MC_RCON_PASSWORD_S115, command: 'list' });
  console.log('  RCON list ->', r.ok ? r.body : '失败：' + r.error);
  process.exit(0);
})();
JS

echo "[4/4] 重启官网并复验明细接口"
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1
sleep 6
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
curl -s -H "Authorization: Bearer $TOK" 'http://127.0.0.1:3000/api/mc/status-detail?server=s115' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('  online=%s version=%s players=%s' % (d.get('online'), d.get('version'), d.get('players'))); print('  rcon.list   =', d.get('rcon',{}).get('list') or d.get('rcon',{}).get('listError')); print('  tps         =', d.get('tps') or d.get('tpsError')); print('  whitelist   =', (d.get('whitelist') or d.get('whitelistError') or '')[:120])"
