#!/bin/bash
# 在 NapCat 主机上为机器人写入支付播报相关 env（幂等）
# 用法（在 HK 上）：bash /root/deploy-bot-20260925/setup-bot-env.sh
set -e
BOTHOST=43.248.3.161
PORT=20043
KEY=/root/.ssh/id_napcat
SSH="ssh -i $KEY -o StrictHostKeyChecking=no -p $PORT root@$BOTHOST"

$SSH 'bash -s' <<'REMOTE'
set -e
cd /var/www/xuanjian-group-bot
cp .env ".env.bak-$(date +%Y%m%d-%H%M%S)"
python3 - <<'PY'
import re
p = '/var/www/xuanjian-group-bot/.env'
text = open(p, encoding='utf-8').read()

def setkv(text, key, val):
    if re.search(rf'^{key}=.*$', text, flags=re.M):
        return re.sub(rf'^{key}=.*$', f'{key}={val}', text, flags=re.M)
    return text.rstrip('\n') + f'\n{key}={val}\n'

for k, v in [
    ('PAY_BROADCAST', 'on'),          # 打开定时播报与审批轮询
    ('BROADCAST_GROUP_ID', '860336849'),  # 主群：财务月报图 + 周报文字
    ('APPROVAL_GROUP_ID', '860336849'),   # 审批推送群（默认同播报群）
]:
    text = setkv(text, k, v)

open(p, 'w', encoding='utf-8').write(text)
for line in text.split('\n'):
    if re.match(r'^(PAY_BROADCAST|BROADCAST_GROUP_ID|APPROVAL_GROUP_ID|OFFICIAL_API_BASE|OFFICIAL_BOT_TOKEN)=', line):
        k, _, v = line.partition('=')
        print('  ' + k + '=' + (v[:6] + '****' if 'TOKEN' in k else v))
PY
REMOTE
echo "机器人 env 已更新（旧文件已备份为 .env.bak-*）"
