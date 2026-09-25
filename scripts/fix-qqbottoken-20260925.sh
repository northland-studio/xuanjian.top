#!/bin/bash
# 修复生产 .env：QQBOT_TOKEN 被写在注释行里导致 dotenv 读不到（所有 /api/qqbot/* 恒 401）
set -e
ENV=/var/www/xuanjian-guild/.env
cd /var/www/xuanjian-guild

echo "--- 修复前 ---"
python3 - <<'PY'
import re
p='/var/www/xuanjian-guild/.env'
lines=open(p,encoding='utf-8').read().split('\n')
for i,l in enumerate(lines,1):
    if 'QQBOT_TOKEN' in l:
        m=re.search(r'QQBOT_TOKEN\s*=\s*(\S+)',l)
        print(f"  行 {i}: 注释行={l.lstrip().startswith('#')} token长度={len(m.group(1)) if m else 0}")
PY

cp "$ENV" "$ENV.bak-20260925-qqbottoken"
python3 - <<'PY'
import re
p='/var/www/xuanjian-guild/.env'
text=open(p,encoding='utf-8').read()
lines=text.split('\n')
out=[]; fixed=0
for l in lines:
    s=l.strip()
    if s.startswith('#') and 'QQBOT_TOKEN' in l:
        m=re.search(r'QQBOT_TOKEN\s*=\s*(\S+)',l)
        if m:
            out.append('# QQ 群机器人接口鉴权 token（xuanjian-group-bot 调用，与机器人 .env 的 OFFICIAL_BOT_TOKEN 一致）')
            out.append('QQBOT_TOKEN=' + m.group(1))
            fixed+=1
            continue
    out.append(l)
open(p,'w',encoding='utf-8').write('\n'.join(out))
print(f'  已拆分为独立赋值行: {fixed} 处')
PY

echo "--- 修复后 ---"
python3 - <<'PY'
import re
p='/var/www/xuanjian-guild/.env'
lines=open(p,encoding='utf-8').read().split('\n')
for i,l in enumerate(lines,1):
    if 'QQBOT_TOKEN' in l:
        m=re.search(r'QQBOT_TOKEN\s*=\s*(\S+)',l)
        print(f"  行 {i}: 注释行={l.lstrip().startswith('#')} token长度={len(m.group(1)) if m else 0}")
PY
node -e "require('dotenv').config();const v=process.env.QQBOT_TOKEN||'';console.log('  dotenv 读到 len='+v.length)"

echo "--- 重启并复验 ---"
pm2 restart xuanjian-guild --update-env >/dev/null 2>&1
sleep 6

TOKEN=$(node -e "require('dotenv').config();process.stdout.write(process.env.QQBOT_TOKEN||'')")
QQ=$(sqlite3 data/guild.db "SELECT qq FROM users WHERE qq IS NOT NULL AND qq <> '' LIMIT 1")
MAXID=$(sqlite3 data/guild.db "SELECT COALESCE(MAX(id),0) FROM pay_intents")
echo "  绑定 QQ: $QQ"
echo "  无 token: $(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3000/api/qqbot/pay/receive-code -H 'Content-Type: application/json' -d "{\"qq\":\"$QQ\"}")（应 401）"
echo "  有 token: $(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3000/api/qqbot/pay/receive-code -H "X-Bot-Token: $TOKEN" -H 'Content-Type: application/json' -d "{\"qq\":\"$QQ\"}")（应 200）"
echo "  原有接口 /api/qqbot/me: $(curl -s -o /dev/null -w '%{http_code}' -H "X-Bot-Token: $TOKEN" "http://127.0.0.1:3000/api/qqbot/me?qq=$QQ")（应 200）"
sqlite3 data/guild.db "DELETE FROM pay_intents WHERE id > $MAXID AND kind='receive';"
echo "  探针二维码已清理"
