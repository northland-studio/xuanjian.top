#!/bin/bash
# 在 HK 上：尝试直连 115，读取 RCON 配置并写入官网 .env（不打印密码）
echo "=== HK → 115 直连测试 ==="
if ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=6 root@115.190.153.44 'hostname' 2>/dev/null; then
  echo "  直连可用"
  ssh -o BatchMode=yes -o StrictHostKeyChecking=no root@115.190.153.44 'grep -E "^rcon\.|^enable-rcon" /opt/minecraft/server.properties; echo "--- 内存 ---"; free -m | head -2; echo "--- java 启动参数 ---"; ps -eo rss,args | grep -E "[j]ava .*\.jar" | head -3' > /tmp/mc115.txt 2>&1
  cat /tmp/mc115.txt
  PW=$(grep -E '^rcon\.password=' /tmp/mc115.txt | cut -d= -f2-)
  ENABLED=$(grep -E '^enable-rcon=' /tmp/mc115.txt | cut -d= -f2-)
  if [ -n "$PW" ] && [ "$ENABLED" = "true" ]; then
    cd /var/www/xuanjian-guild
    cp .env .env.bak-20260925-mc
    python3 - "$PW" <<'PY'
import sys, re
pw = sys.argv[1]
p = '/var/www/xuanjian-guild/.env'
text = open(p, encoding='utf-8').read()
if 'MC_SERVERS=' not in text:
    text += '\n# Minecraft 服务器只读对接（115）\nMC_SERVERS=s115=115.190.153.44:25565\nMC_LABEL_S115=十一服·历史展览馆\nMC_RCON_PORT_S115=25575\n'
text = re.sub(r'^MC_RCON_PASSWORD_S115=.*$', f'MC_RCON_PASSWORD_S115={pw}', text, flags=re.M)
if 'MC_RCON_PASSWORD_S115=' not in text:
    text += f'MC_RCON_PASSWORD_S115={pw}\n'
open(p, 'w', encoding='utf-8').write(text)
print('  已写入 MC_SERVERS / MC_LABEL_S115 / MC_RCON_PASSWORD_S115（密码长度 %d）' % len(pw))
PY
  else
    echo "  RCON 未启用或未读到密码（enable-rcon=$ENABLED）"
  fi
else
  echo "  HK 无法直连 115（需要单独配置密钥；稍后用本机中转）"
fi
