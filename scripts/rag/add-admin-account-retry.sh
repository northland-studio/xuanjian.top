#!/bin/bash
# 1) 直接把两个账号写进 NOTICE_ACCOUNTS（token 已知，不依赖 SSH）
# 2) 隧道加重试（IPQoS + 快速重连），直到 13004 绑上
set -u
ADMIN_TOKEN=65153794255ae233009f
cd /opt/xuanjian-notice
XJJ_TOKEN=$(grep '^ONEBOT_ACCESS_TOKEN=' .env | cut -d= -f2-)

echo "=== 1. 写入两个账号 ==="
cp .env ".env.bak-accounts2-$(date +%Y%m%d-%H%M%S)"
python3 - "$XJJ_TOKEN" "$ADMIN_TOKEN" <<'PY'
import json, re, sys
xjj, admin = sys.argv[1], sys.argv[2]
p = '/opt/xuanjian-notice/.env'
s = open(p).read()
accounts = [
    {"id": "xjj", "name": "玄剑姬", "port": 13003, "token": xjj, "enabled": True},
    {"id": "admin", "name": "Morzane（管理员）", "port": 13004, "token": admin, "enabled": True},
]
line = 'NOTICE_ACCOUNTS=' + json.dumps(accounts, ensure_ascii=False)
s = re.sub(r'^NOTICE_ACCOUNTS=.*$', line, s, flags=re.M) if re.search(r'^NOTICE_ACCOUNTS=', s, re.M) else s + '\n' + line + '\n'
open(p, 'w').write(s)
print('  已写入 ' + str(len(accounts)) + ' 个账号')
PY
grep '^NOTICE_ACCOUNTS=' .env | sed -E 's/"token": "[^"]*"/"token": "****"/g'

echo
echo "=== 2. 重启 notice ==="
pm2 restart xuanjian-notice --update-env >/dev/null 2>&1
sleep 8
pm2 logs xuanjian-notice --lines 40 --nostream 2>/dev/null | grep -aE '已启动账号|账号 ' | tail -5

echo
echo "=== 3. 隧道重试（最多 8 次，每次 12 秒）==="
cat > /opt/napcat-admin-tunnel.sh <<'EOS'
#!/bin/bash
while true; do
  ssh -i /root/.ssh/id_napcat -p 20043 \
      -o StrictHostKeyChecking=no -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes -o ConnectTimeout=12 -o IPQoS=throughput -o TCPKeepAlive=yes -N \
      -L 13004:127.0.0.1:3002 root@43.248.3.161
  echo "[$(date '+%F %T')] 断开，10 秒后重连" >> /tmp/napcat-admin-tunnel.log
  sleep 10
done
EOS
chmod +x /opt/napcat-admin-tunnel.sh
pm2 restart napcat-admin-tunnel >/dev/null 2>&1 || pm2 start /opt/napcat-admin-tunnel.sh --name napcat-admin-tunnel --interpreter none >/dev/null

for i in $(seq 1 8); do
  sleep 12
  if ss -lnt 2>/dev/null | grep -q ':13004 '; then
    echo "  ✓ 第 $i 次尝试：13004 已建立"
    break
  fi
  echo "  · 第 $i 次：尚未建立"
done
echo -n "  13004 监听: "; ss -lnt 2>/dev/null | grep -c ':13004 ' || true

echo
echo "=== 4. 最终状态 ==="
pm2 list 2>/dev/null | grep -E 'napcat-admin-tunnel|xuanjian-notice' | head -3
echo -n "  公网首页: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 https://notice.xuanjian.top/
