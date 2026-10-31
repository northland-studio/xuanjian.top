#!/bin/bash
# 第二步：HK 隧道 13004 → 3002，并把管理员号接进 notice 账号池
set -u
TOKEN_FILE=/root/admin-onebot-token.txt

echo "=== 1. 取管理员号 OneBot token（从机器人服务器读取）==="
timeout 25 ssh -i /root/.ssh/id_napcat -p 20043 -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
  -o IPQoS=throughput -o BatchMode=yes root@43.248.3.161 \
  'cat /opt/napcat-admin/onebot-token.txt' > "$TOKEN_FILE" 2>/dev/null || true
TOKEN=$(tr -d '\r\n' < "$TOKEN_FILE")
if [ -z "$TOKEN" ]; then echo "  ✗ 取 token 失败（SSH 不通），稍后重试"; else echo "  ✓ token 已取到（${#TOKEN} 位）"; fi

echo
echo "=== 2. 重启管理号隧道（带 IPQoS）==="
pm2 restart napcat-admin-tunnel >/dev/null 2>&1 || true
sleep 10
echo -n "  13004 监听: "; ss -lnt 2>/dev/null | grep -c ':13004 ' || true

echo
echo "=== 3. 更新 NOTICE_ACCOUNTS（两个账号）==="
cd /opt/xuanjian-notice
cp .env ".env.bak-accounts-$(date +%Y%m%d-%H%M%S)"
XJJ_TOKEN=$(grep '^ONEBOT_ACCESS_TOKEN=' .env | cut -d= -f2-)
python3 - "$XJJ_TOKEN" "$TOKEN" <<'PY'
import json, re, sys
xjj, admin = sys.argv[1], sys.argv[2]
p = '/opt/xuanjian-notice/.env'
s = open(p).read()
accounts = [
    {"id": "xjj", "name": "玄剑姬", "port": 13003, "token": xjj, "enabled": True},
]
if admin:
    accounts.append({"id": "admin", "name": "Morzane（管理员）", "port": 13004, "token": admin, "enabled": True})
line = 'NOTICE_ACCOUNTS=' + json.dumps(accounts, ensure_ascii=False).replace('\n', '')
if re.search(r'^NOTICE_ACCOUNTS=.*$', s, re.M):
    s = re.sub(r'^NOTICE_ACCOUNTS=.*$', line, s, flags=re.M)
else:
    s += '\n' + line + '\n'
open(p, 'w').write(s)
print('  账号数：' + str(len(accounts)))
PY
grep '^NOTICE_ACCOUNTS=' .env | sed -E 's/"token":"[^"]*"/"token":"****"/g'

echo
echo "=== 4. 重启 notice ==="
pm2 restart xuanjian-notice --update-env >/dev/null 2>&1
sleep 8
echo "  账号启动日志："
pm2 logs xuanjian-notice --lines 30 --nostream 2>/dev/null | grep -aE '已启动账号|账号 ' | tail -4

echo
echo "=== 5. 健康检查 ==="
echo -n "  首页: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 10 http://127.0.0.1:3910/
echo -n "  公网: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 https://notice.xuanjian.top/
