#!/bin/bash
# 部署 NapCat 群发插件到 NapCat 主机（HK 上执行；两跳到 NapCat 主机）
set -e
STAGE=/root/deploy-napcat-plugin-20260930
BOTHOST=43.248.3.161
PORT=20043
KEY=/root/.ssh/id_napcat
SSH="ssh -i $KEY -o StrictHostKeyChecking=no -p $PORT root@$BOTHOST"
SCP="scp -i $KEY -o StrictHostKeyChecking=no -P $PORT"
PLUGDIR=/opt/napcat/squashfs-root/napcat/plugins/napcat-plugin-xuanjian-broadcast

echo "[1/5] 准备 OP 名单与 SMTP 凭据（HK 侧读取，不打印明文）"
mkdir -p "$STAGE"
cp /var/www/monitor/operators.json "$STAGE/operators.json" 2>/dev/null && echo "  ✓ 已取 monitor OP 名单（$(python3 -c "import json;print(len(json.load(open('$STAGE/operators.json'))))" 2>/dev/null || echo '?') 人）" || echo "  (!) 未找到 /var/www/monitor/operators.json"

python3 - <<'PY'
import re
env = {}
try:
    for l in open('/var/www/xuanjian-guild/.env', encoding='utf-8'):
        m = re.match(r'\s*([A-Z_]+)\s*=\s*(.+)$', l)
        if m: env[m.group(1)] = m.group(2).strip()
except Exception as e:
    print('  读取官网 .env 失败:', e)
# 也尝试 monitor 的 .env（若存在就用它的 SMTP）
try:
    for l in open('/var/www/monitor/.env', encoding='utf-8'):
        m = re.match(r'\s*(SMTP_[A-Z_]+)\s*=\s*(.+)$', l)
        if m and m.group(1) not in env: env[m.group(1)] = m.group(2).strip()
except Exception:
    pass
user = env.get('SMTP_USER', '')
pwd = env.get('SMTP_PASS', '')
open('/root/deploy-napcat-plugin-20260930/smtp.txt', 'w', encoding='utf-8').write(f"{user}\n{pwd}\n")
print(f'  SMTP 用户: {user[:6]}****（长度 {len(user)}），密码长度 {len(pwd)}')
PY

echo "[2/5] 上传插件到 NapCat 主机"
$SSH "mkdir -p $PLUGDIR/data"
$SCP "$STAGE/plugin.tar.gz" "root@$BOTHOST:/tmp/plugin.tar.gz"
$SCP "$STAGE/operators.json" "root@$BOTHOST:/tmp/operators.json" 2>/dev/null || true
$SCP "$STAGE/smtp.txt" "root@$BOTHOST:/tmp/smtp.txt"

echo "[3/5] 解包并写 .env（含 SMTP 与 OP 名单路径，密码不落日志）"
$SSH "bash -s" <<REMOTE
set -e
PLUGDIR=$PLUGDIR
mkdir -p \$PLUGDIR
tar -xzf /tmp/plugin.tar.gz -C \$PLUGDIR
cp /tmp/operators.json \$PLUGDIR/data/operators.json 2>/dev/null || true
SMTP_USER=\$(sed -n 1p /tmp/smtp.txt)
SMTP_PASS=\$(sed -n 2p /tmp/smtp.txt)
python3 - "\$PLUGDIR" "\$SMTP_USER" "\$SMTP_PASS" <<'PY'
import sys, re, os
plug, user, pwd = sys.argv[1], sys.argv[2], sys.argv[3]
src = os.path.join(plug, '.env.example')
dst = os.path.join(plug, '.env')
text = open(src, encoding='utf-8').read()
def setkv(t, k, v):
    if re.search(rf'^{k}=.*$', t, flags=re.M):
        return re.sub(rf'^{k}=.*$', f'{k}={v}', t, flags=re.M)
    return t.rstrip('\n') + f'\n{k}={v}\n'
settings = {
    'BROADCAST_PLUGIN_ENABLE': 'on',
    'DEV_MODE': 'false',
    'OPERATORS_FILE': os.path.join(plug, 'data', 'operators.json'),
    'SMTP_USER': user,
    'SMTP_PASS': pwd,
    'CONFIRM_MODE': 'email',
    'COOKIE_SECURE': 'auto',
}
for k, v in settings.items():
    text = setkv(text, k, v)
open(dst, 'w', encoding='utf-8').write(text)
os.chmod(dst, 0o600)
print('  .env 已写入并 600：', ', '.join(settings.keys()))
PY
rm -f /tmp/smtp.txt /tmp/operators.json
echo "  插件目录："; ls \$PLUGDIR
echo "  src 文件数：\$(ls \$PLUGDIR/src | wc -l)"
node --check \$PLUGDIR/index.mjs && echo "  index.mjs 语法 OK"
REMOTE

echo "[4/5] 检查 NapCat 是否已识别插件（是否需要重启）"
$SSH "ls -la /opt/napcat/squashfs-root/napcat/plugins/ ; pgrep -a -f 'napcat|qq' | head -3"

echo "[5/5] 完成（重启 NapCat 由使用者决定，避免影响 QQ 登录）"
echo "  插件页面地址（NapCat WebUI 内）：/plugin/napcat-plugin-xuanjian-broadcast/page/broadcast"
echo "  本机可达：http://127.0.0.1:6099/plugin/napcat-plugin-xuanjian-broadcast/page/broadcast"
