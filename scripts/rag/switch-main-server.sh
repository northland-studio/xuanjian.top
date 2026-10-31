#!/bin/bash
# 切换主服到 play.hetaomc.cn，并验证在线人数
set -u
cd /var/www/xuanjian-guild || exit 1

echo "=== 1. DNS ==="
getent hosts play.hetaomc.cn || echo "  A 记录解析失败"
command -v dig >/dev/null && dig +short SRV _minecraft._tcp.play.hetaomc.cn || echo "  （无 dig，跳过 SRV 查询）"

echo
echo "=== 2. 直连测试（25565）==="
node - <<'EOF' 2>&1 | grep -v dotenv
const net = require('net');
const host = 'play.hetaomc.cn';
const port = 25565;
const s = net.connect({ host, port, timeout: 6000 });
const t = Date.now();
s.on('connect', () => { console.log('  TCP 连接成功 ' + (Date.now() - t) + 'ms'); s.destroy(); });
s.on('timeout', () => { console.log('  TCP 连接超时'); s.destroy(); });
s.on('error', (e) => console.log('  TCP 失败: ' + e.message));
EOF

echo
echo "=== 3. 备份并更新 .env ==="
cp .env ".env.bak-mc-$(date +%Y%m%d-%H%M%S)"
sed -i "s|^MC_SERVERS=.*|MC_SERVERS=s115=play.hetaomc.cn:25565|" .env
sed -i "s|^MC_LABEL_S115=.*|MC_LABEL_S115=核桃服务器·主服|" .env
# RCON 保留原有行但清空密码（新服未启用 RCON，明细接口会优雅失败而不是挂住）
sed -i "s|^MC_RCON_PASSWORD_S115=.*|MC_RCON_PASSWORD_S115=|" .env
sed -i "s|^MC_RCON_PORT_S115=.*|MC_RCON_PORT_S115=25575|" .env
grep -E '^MC_' .env | sed -E 's/(PASSWORD[^=]*=).*/\1****/'

echo
echo "=== 4. 重启并查询 ==="
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1
sleep 7
curl -s --max-time 25 "http://127.0.0.1:3000/api/mc/status?server=s115" -o /tmp/mcs.json
node -e "
const j = require('/tmp/mcs.json');
console.log('  server: ' + JSON.stringify(j.server));
console.log('  online: ' + j.online + '  version: ' + (j.version || '?'));
console.log('  players: ' + (j.players ? j.players.online + '/' + j.players.max : '?'));
if (j.players && j.players.sample && j.players.sample.length) {
  console.log('  在线名单: ' + j.players.sample.map(p => p.name).join(', '));
}
console.log('  motd: ' + String(j.motd || '').replace(/\n/g, ' / ').slice(0, 120));
if (j.error) console.log('  error: ' + j.error);
"
