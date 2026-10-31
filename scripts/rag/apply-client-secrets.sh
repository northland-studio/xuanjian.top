#!/bin/bash
# 轮换 nork 密钥 + 下发 northbooker 密钥，重启并验证
set -u
GUILD=/var/www/xuanjian-guild
cd "$GUILD"

NORK_SECRET=$(cat /root/nork-secret.txt)
NB_SECRET=$(cat /root/northbooker-secret.txt)

echo "=== 1. 更新 OAuth 应用密钥（nork 轮换 / northbooker 保持）==="
node scripts/register-oauth-clients.js /root/rotate-nork.json 2>&1 | grep -v dotenv | head -6

echo
echo "=== 2. 更新 nork 的 .env ==="
for f in /var/www/nork/server/.env H:/chengxuyuanma/Nork/server/.env; do :; done
NORK_ENV=/var/www/nork/server/.env
if [ -f "$NORK_ENV" ]; then
  cp "$NORK_ENV" "$NORK_ENV.bak-oauth-$(date +%Y%m%d-%H%M%S)"
  if grep -q '^XUANJIAN_CLIENT_SECRET=' "$NORK_ENV"; then
    sed -i "s|^XUANJIAN_CLIENT_SECRET=.*|XUANJIAN_CLIENT_SECRET=$NORK_SECRET|" "$NORK_ENV"
  else
    echo "XUANJIAN_CLIENT_SECRET=$NORK_SECRET" >> "$NORK_ENV"
  fi
  echo "  ✓ nork .env 已更新（密钥长度 ${#NORK_SECRET}）"
else
  echo "  ✗ 未找到 nork .env"
fi

echo
echo "=== 3. 更新 northbooker 的 .env ==="
NB_ENV=/var/www/northbooker/server/.env
if [ -f "$NB_ENV" ]; then
  cp "$NB_ENV" "$NB_ENV.bak-oauth-$(date +%Y%m%d-%H%M%S)"
  if grep -q '^OAUTH_CLIENT_SECRET=' "$NB_ENV"; then
    sed -i "s|^OAUTH_CLIENT_SECRET=.*|OAUTH_CLIENT_SECRET=$NB_SECRET|" "$NB_ENV"
  else
    echo "OAUTH_CLIENT_SECRET=$NB_SECRET" >> "$NB_ENV"
  fi
  grep -q '^OAUTH_CLIENT_ID=' "$NB_ENV" || echo "OAUTH_CLIENT_ID=northbooker" >> "$NB_ENV"
  grep -q '^OAUTH_PROVIDER_URL=' "$NB_ENV" || echo "OAUTH_PROVIDER_URL=https://www.xuanjian.top" >> "$NB_ENV"
  echo "  ✓ northbooker .env 已更新"
else
  echo "  ✗ 未找到 northbooker .env"
fi

echo
echo "=== 4. 重启受影响服务 ==="
pm2 restart nork --update-env >/dev/null 2>&1 && echo "  ✓ nork 已重启" || echo "  ✗ nork 重启失败"
pm2 restart northbooker --update-env >/dev/null 2>&1 && echo "  ✓ northbooker 已重启" || echo "  ✗ northbooker 重启失败"
sleep 4

echo
echo "=== 5. 健康检查 ==="
for u in https://nork.xuanjian.top/ https://northbooker.xuanjian.top/; do
  echo -n "  $u -> "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 "$u"
done

echo
echo "=== 6. nork OAuth 入口连通性（应 302 到玄剑授权页）==="
curl -s -o /dev/null -w '  /api/auth/oauth/xuanjian/start -> %{http_code} %{redirect_url}\n' --max-time 12 https://nork.xuanjian.top/api/auth/oauth/xuanjian/start

echo
echo "=== 7. northbooker OAuth 入口 ==="
NB_ENTRY=$(grep -rhoE "'/[a-z/]*login[a-z/]*'" /var/www/northbooker/server/src/routes/auth.js 2>/dev/null | head -3 | tr '\n' ' ')
echo "  路由候选: $NB_ENTRY"

echo
echo "=== 8. 注册表最终状态 ==="
sqlite3 data/guild.db "SELECT client_id, name, is_confidential, is_active, redirect_uris, allowed_scopes FROM oauth_clients ORDER BY id;"
