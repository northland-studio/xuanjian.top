#!/bin/bash
# 修正：nork 密钥被写成空值；从 rotate-nork.json 取回真实值并写入
set -u
cd /var/www/xuanjian-guild

NORK_SECRET=$(node -e "const j=require('/root/rotate-nork.json'); process.stdout.write(j[0].secret)" 2>/dev/null)
echo "nork 密钥长度: ${#NORK_SECRET}"

if [ -z "$NORK_SECRET" ]; then echo "无法读取密钥，退出"; exit 1; fi

echo "=== 修正 nork .env ==="
NORK_ENV=/var/www/nork/server/.env
sed -i "s|^XUANJIAN_CLIENT_SECRET=.*|XUANJIAN_CLIENT_SECRET=$NORK_SECRET|" "$NORK_ENV"
grep -E '^XUANJIAN_(CLIENT_ID|REDIRECT_URI)=' "$NORK_ENV"
grep -c '^XUANJIAN_CLIENT_SECRET=' "$NORK_ENV" | sed 's/^/  CLIENT_SECRET 行数: /'
node -e "
const fs=require('fs');
const line=fs.readFileSync('$NORK_ENV','utf8').split('\n').find(l=>l.startsWith('XUANJIAN_CLIENT_SECRET='));
const v=line.split('=').slice(1).join('=');
console.log('  实际值长度: ' + v.length + '，前缀: ' + v.slice(0,6));
"

echo
echo "=== 校验 northbooker 密钥 ==="
NB_ENV=/var/www/northbooker/server/.env
node -e "
const fs=require('fs');
const env=fs.readFileSync('$NB_ENV','utf8');
const line=env.split('\n').find(l=>l.startsWith('OAUTH_CLIENT_SECRET='));
console.log('  OAUTH_CLIENT_SECRET: ' + (line? ('长度 ' + line.split('=').slice(1).join('=').length):'缺失'));
"

echo
echo "=== 重启并验证 ==="
pm2 restart nork --update-env >/dev/null 2>&1
pm2 restart northbooker --update-env >/dev/null 2>&1
sleep 4
echo -n "  nork 首页: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 https://nork.xuanjian.top/
echo -n "  northbooker 首页: "; curl -s -o /dev/null -w '%{http_code}\n' --max-time 12 https://northbooker.xuanjian.top/
curl -s -o /dev/null -w '  nork OAuth 入口: %{http_code}\n' --max-time 12 https://nork.xuanjian.top/api/auth/oauth/xuanjian/start

echo
echo "=== 端到端：用 nork 真实密钥换令牌（机密客户端）==="
TOKEN=$(node -e "
process.chdir('/var/www/xuanjian-guild');
require('/var/www/xuanjian-guild/node_modules/dotenv').config({ path: '/var/www/xuanjian-guild/.env', quiet: true });
const jwt=require('/var/www/xuanjian-guild/node_modules/jsonwebtoken');
process.stdout.write(jwt.sign({userId:2, level:1}, process.env.JWT_SECRET, {expiresIn:'10m'}));
" 2>/dev/null)

CODE=$(curl -s -X POST http://127.0.0.1:3000/api/oauth/authorize \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  --data-binary "{\"client_id\":\"nork\",\"redirect_uri\":\"https://nork.xuanjian.top/api/auth/oauth/xuanjian/callback\",\"decision\":\"allow\"}" \
| node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const u=new URL(j.redirect);console.log(u.searchParams.get('code'))})")

RESP=$(curl -s -X POST http://127.0.0.1:3000/api/oauth/token \
  -H 'Content-Type: application/json' \
  --data-binary "{\"grant_type\":\"authorization_code\",\"code\":\"$CODE\",\"client_id\":\"nork\",\"redirect_uri\":\"https://nork.xuanjian.top/api/auth/oauth/xuanjian/callback\",\"client_secret\":\"$NORK_SECRET\"}")

echo "$RESP" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);if(j.access_token){console.log('  ✓ nork 真实密钥可换令牌，scope='+j.scope)}else{console.log('  ✗ 失败: '+JSON.stringify(j))}})"
