#!/bin/bash
# 用 curl 完成一次真实直传，验证「签发→上传→CDN 可访问→删除」
set -u
APP=/var/www/xuanjian-guild
cd "$APP"

TOKEN=$(node -e "
process.chdir('/var/www/xuanjian-guild');
require('/var/www/xuanjian-guild/node_modules/dotenv').config({ path: '/var/www/xuanjian-guild/.env', quiet: true });
const jwt=require('/var/www/xuanjian-guild/node_modules/jsonwebtoken');
process.stdout.write(jwt.sign({userId:2, level:1}, process.env.JWT_SECRET, {expiresIn:'10m'}));
" 2>/dev/null)

META=$(curl -s -X POST http://127.0.0.1:3000/api/upload/token \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  --data-binary '{"kind":"wiki","filename":"smoke.png"}')

UPLOAD_TOKEN=$(echo "$META" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).uploadToken))")
KEY=$(echo "$META" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).key))")
UPLOAD_URL=$(echo "$META" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).uploadUrl))")
URL=$(echo "$META" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).url))")

echo "  key=$KEY"
echo "  uploadUrl=$UPLOAD_URL"

# 生成 1x1 PNG
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > /tmp/smoke.png

echo -n "  七牛直传: "
curl -s -o /tmp/up-resp.json -w '%{http_code}\n' -X POST "$UPLOAD_URL" \
  -F "token=$UPLOAD_TOKEN" -F "key=$KEY" -F "file=@/tmp/smoke.png;type=image/png"

echo -n "  CDN 可访问: "
curl -s -o /dev/null -w '%{http_code}\n' --max-time 15 "$URL"

echo -n "  删除对象(自己的): "
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE http://127.0.0.1:3000/api/upload/object \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  --data-binary "{\"key\":\"$KEY\"}"

echo -n "  删除后 CDN: "
curl -s -o /dev/null -w '%{http_code}\n' --max-time 15 "$URL"
